// Conexión de Facebook (Messenger, formularios de anuncios) e Instagram por cuenta propia de cada empresa.
// El administrador pulsa «Conectar con Facebook», autoriza a Agente-IA en la ventana de Meta y elige su página.
// El servidor guarda (cifrado) el token de la página, suscribe la página a los avisos de Agente-IA y activa los canales.
// Nadie copia ni pega tokens. Variables en Render: META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN y opcional META_CONFIG_ID.
const crypto = require("crypto");
const db = require("./db");

const V = () => process.env.GRAPH_VERSION || "v22.0";
const GRAPH = () => `https://graph.facebook.com/${V()}`;
const API_BASE = () => (process.env.PUBLIC_API || "https://api-comercial.skynetgenesis.com").replace(/\/$/, "");
const APP = () => (process.env.APP_ORIGIN || "").split(",")[0].trim() || "https://agente-ia.skynetgenesis.com";
const listo = () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
const SCOPES = ["pages_show_list", "pages_manage_metadata", "pages_messaging", "pages_read_engagement", "business_management",
  "instagram_basic", "instagram_manage_messages", "leads_retrieval"];
const CAMPOS_PAGINA = "messages,messaging_postbacks,leadgen";

async function g(path, token, method = "GET", body) {
  const url = `${GRAPH()}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j?.error?.message || `Meta ${r.status}`);
  return j;
}

// Estado firmado: lleva la empresa y el usuario por la ventana de Meta sin poder falsificarse
const firma = (s) => crypto.createHmac("sha256", process.env.META_APP_SECRET || "x").update(s).digest("base64url").slice(0, 32);
function estado(tid, uid) { const s = `${tid}.${uid}.${Date.now()}`; return Buffer.from(s).toString("base64url") + "." + firma(s); }
function leerEstado(st) {
  const [b, f] = String(st || "").split("."); if (!b || !f) return null;
  const s = Buffer.from(b, "base64url").toString(); if (firma(s) !== f) return null;
  const [tid, uid, t] = s.split("."); if (Date.now() - Number(t) > 30 * 60000) return null;
  return { tid, uid };
}
const volver = () => `${API_BASE()}/meta/volver`;

function urlDialogo(tid, uid) {
  const p = new URLSearchParams({ client_id: process.env.META_APP_ID, redirect_uri: volver(), state: estado(tid, uid), response_type: "code" });
  if (process.env.META_CONFIG_ID) p.set("config_id", process.env.META_CONFIG_ID); else p.set("scope", SCOPES.join(","));
  return `https://www.facebook.com/${V()}/dialog/oauth?${p}`;
}

// Firma de Meta en las solicitudes de borrado de datos (signed_request)
function leerSigned(sr) {
  const [sig, payload] = String(sr || "").split("."); if (!sig || !payload) return null;
  const esperada = crypto.createHmac("sha256", process.env.META_APP_SECRET || "").update(payload).digest("base64url");
  if (sig.replace(/=+$/, "") !== esperada) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
}

async function activarCanales(tid, pagina, ig) {
  const c = await db.getDoc(`tenants/${tid}/config/connections`); const d = c.exists ? { ...c.data } : {}; const t = Date.now();
  const on = (k, data) => { d[k] = { ...(d[k] || {}), status: "activo", activatedAt: t, data: { ...((d[k] || {}).data || {}), ...data }, via: "meta" }; };
  on("facebook", { page: pagina.name, pageId: pagina.id });
  on("fbleads", { page: pagina.name, pageId: pagina.id });
  if (ig) on("instagram", { user: ig.username ? "@" + ig.username : "", page: pagina.name }); else if (d.instagram && d.instagram.via === "meta") d.instagram = { status: "none", data: {} };
  await db.setDoc(`tenants/${tid}/config/connections`, d);
}
async function apagarCanales(tid) {
  const c = await db.getDoc(`tenants/${tid}/config/connections`); if (!c.exists) return; const d = { ...c.data };
  for (const k of ["facebook", "fbleads", "instagram"]) if (d[k]) d[k] = { ...d[k], status: "none", activatedAt: 0, via: "" };
  await db.setDoc(`tenants/${tid}/config/connections`, d);
}
async function desconectar(tid) {
  const s = await db.getSecrets(tid);
  if (s.page_id && s.page_token) await g(`${s.page_id}/subscribed_apps`, s.page_token, "DELETE").catch(() => {});
  for (const k of ["page_id", "page_token", "ig_id", "page_name", "ig_user", "meta_pend"]) await db.setSecret(tid, k, null);
  await apagarCanales(tid);
}

function routes(app) {
  // Meta vuelve aquí después de que el administrador autoriza (no lleva sesión: la empresa va en el estado firmado)
  app.get("/meta/volver", async (req, res) => {
    const ir = (q) => res.redirect(`${APP()}/#conexiones?meta=${q}`);
    const st = leerEstado(req.query.state); if (!st) return ir("vencido");
    if (req.query.error || !req.query.code) return ir("cancelado");
    try {
      const p = new URLSearchParams({ client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: volver(), code: req.query.code });
      const r = await fetch(`${GRAPH()}/oauth/access_token?${p}`); const j = await r.json();
      if (!j.access_token) throw new Error(j?.error?.message || "sin token");
      // Token de larga duración: así los tokens de página no vencen
      const p2 = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, fb_exchange_token: j.access_token });
      const r2 = await fetch(`${GRAPH()}/oauth/access_token?${p2}`); const j2 = await r2.json().catch(() => ({}));
      const ut = j2.access_token || j.access_token;
      const pg = await g("me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100", ut);
      const paginas = (pg.data || []).filter((x) => x.access_token).map((x) => ({ id: x.id, name: x.name, token: x.access_token, ig: x.instagram_business_account ? { id: x.instagram_business_account.id, username: x.instagram_business_account.username || "" } : null }));
      if (!paginas.length) return ir("sinpaginas");
      await db.setSecret(st.tid, "meta_pend", JSON.stringify({ at: Date.now(), paginas }));
      ir(paginas.length === 1 ? "una" : "elegir");
    } catch (e) { console.error("meta volver", e.message); ir("error"); }
  });

  // Solicitud de borrado de datos que Meta envía cuando una persona quita Agente-IA de su Facebook
  app.post("/meta/borrar-datos", require("express").urlencoded({ extended: false }), async (req, res) => {
    const d = leerSigned(req.body?.signed_request); if (!d) return res.status(400).json({ error: "firma inválida" });
    const code = crypto.randomBytes(8).toString("hex");
    await db.kvSet("meta:borrado:" + code, JSON.stringify({ user: d.user_id, at: Date.now() })).catch(() => {});
    res.json({ url: `${APP()}/eliminar-datos.html?codigo=${code}`, confirmation_code: code });
  });
  app.post("/meta/desautorizar", require("express").urlencoded({ extended: false }), (req, res) => { res.sendStatus(leerSigned(req.body?.signed_request) ? 200 : 400); });
}

// Rutas con sesión (solo el administrador de la empresa)
function apiRoutes(app) {
  const soloAdmin = (req, res) => {
    if (req.user.demo) { res.status(403).json({ error: "En la demostración no se conectan redes reales." }); return false; }
    if (req.user.role !== "admin" && !req.user.staff) { res.status(403).json({ error: "Solo el administrador de la empresa." }); return false; }
    return true;
  };
  const tidDe = (req) => (req.user.staff && req.body?.tid) || req.query.tid || req.user.tid;
  const planOk = async (tid) => { const t = await db.getDoc(`tenants/${tid}`); return t.exists && ["pro", "empresarial"].includes(t.data.plan) && !require("./cobro").cerrada(t.data); };

  app.get("/api/meta/estado", async (req, res) => {
    const tid = tidDe(req); const s = await db.getSecrets(tid); let pend = null;
    try { const p = s.meta_pend ? JSON.parse(s.meta_pend) : null; if (p && Date.now() - p.at < 30 * 60000) pend = p.paginas.map((x) => ({ id: x.id, name: x.name, ig: x.ig ? x.ig.username || "sí" : "" })); } catch {}
    res.json({ listo: listo(), plan: await planOk(tid), conectada: !!(s.page_id && s.page_token), pagina: s.page_name || "", instagram: s.ig_user || "", pendientes: pend });
  });
  app.post("/api/meta/conectar", async (req, res) => {
    if (!soloAdmin(req, res)) return;
    if (!listo()) return res.status(503).json({ error: "La conexión con Facebook todavía no está habilitada por SkyNet Genesis." });
    const tid = tidDe(req); if (!(await planOk(tid))) return res.status(403).json({ error: "Messenger e Instagram están en los planes Profesional y Empresarial, con la cuenta al día." });
    res.json({ url: urlDialogo(tid, req.user.id) });
  });
  app.post("/api/meta/elegir", async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const tid = tidDe(req); const s = await db.getSecrets(tid);
    let p; try { p = JSON.parse(s.meta_pend || "null"); } catch {}
    if (!p || Date.now() - p.at > 30 * 60000) return res.status(410).json({ error: "La autorización venció. Pulse otra vez «Conectar con Facebook»." });
    const pag = p.paginas.find((x) => x.id === String(req.body?.page_id || "")) || (p.paginas.length === 1 ? p.paginas[0] : null);
    if (!pag) return res.status(400).json({ error: "Elija una página." });
    const otra = await db.findTenantBySecret("page_id", pag.id);
    if (otra && otra !== tid) return res.status(409).json({ error: "Esa página ya está conectada a otra empresa en Agente-IA." });
    try { await g(`${pag.id}/subscribed_apps`, pag.token, "POST", { subscribed_fields: CAMPOS_PAGINA }); }
    catch (e) { return res.status(502).json({ error: "Meta no dejó conectar la página: " + e.message }); }
    if (s.page_id && s.page_id !== pag.id && s.page_token) await g(`${s.page_id}/subscribed_apps`, s.page_token, "DELETE").catch(() => {});
    await db.setSecret(tid, "page_id", pag.id); await db.setSecret(tid, "page_token", pag.token); await db.setSecret(tid, "page_name", pag.name);
    await db.setSecret(tid, "ig_id", pag.ig ? pag.ig.id : null); await db.setSecret(tid, "ig_user", pag.ig ? pag.ig.username : null);
    await db.setSecret(tid, "meta_pend", null);
    await activarCanales(tid, pag, pag.ig);
    res.json({ ok: true, pagina: pag.name, instagram: pag.ig ? pag.ig.username || "sí" : "" });
  });
  app.post("/api/meta/desconectar", async (req, res) => {
    if (!soloAdmin(req, res)) return;
    await desconectar(tidDe(req)); res.json({ ok: true });
  });
}

module.exports = { routes, apiRoutes, desconectar, urlDialogo, leerEstado, estado, leerSigned, SCOPES };
