// Agente-IA — servidor
const express = require("express");
const path = require("path");
const db = require("./db");
const auth = require("./auth");
const docs = require("./docs");
const ai = require("./ai");
const engine = require("./engine");
const pub = require("./public");
const cobro = require("./cobro");
const crypto = require("crypto");
const ch = require("./channels");
const bold = require("./bold");

// En Render las claves se generan solas; sin ellas el servidor no arranca (no se usan claves por defecto)
if (process.env.RENDER && (!process.env.JWT_SECRET || !process.env.SECRET_KEY)) { console.error("Faltan JWT_SECRET o SECRET_KEY"); process.exit(1); }
process.on("unhandledRejection", (e) => console.error("promesa sin manejar", e && e.message));
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // Render pone un proxy delante: la IP real es la última que agrega ese proxy
app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

// CORS para la app publicada en GitHub Pages (APP_ORIGIN, varios separados por coma)
const origins = (process.env.APP_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use("/api", (req, res, next) => {
  const o = req.headers.origin;
  if (o && (origins.includes(o) || origins.includes("*"))) { res.set("Access-Control-Allow-Origin", o); res.set("Vary", "Origin"); res.set("Access-Control-Allow-Headers", "Content-Type, Authorization"); res.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS"); }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Salud: no toca la base de datos (para que Neon pueda dormir). Con ?db=1 sí la revisa.
app.get("/salud", async (req, res) => {
  try { if (req.query.db) await db.pool.query("SELECT 1"); res.json({ ok: true, ia: process.env.AI_ENABLED === "true", correo: !!(process.env.BREVO_API_KEY || process.env.SMTP_URL), meta: !!process.env.META_VERIFY_TOKEN }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// Despertador: un servicio gratuito (cron-job.org) llama esta dirección cada 10 minutos.
// Mantiene despierto el servidor y revisa si hay seguimientos, cobros o citas por enviar.
app.get("/api/cron", async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.key !== process.env.CRON_SECRET) return res.status(403).json({ error: "Clave inválida" });
  try { const r = await engine.tick(); res.json({ ok: true, ...r, nextDue: r && r.nextDue ? new Date(r.nextDue).toISOString() : null }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Entradas públicas (webhooks, chat web, formulario, API)
app.use(pub.router());

// Sesión
app.post("/api/auth/login", async (req, res) => {
  const r = await auth.login(req.body?.email, req.body?.password, req.ip);
  if (r && r.blocked) return res.status(429).json({ error: "Demasiados intentos fallidos. Espere 15 minutos e intente de nuevo." });
  if (!r) return res.status(401).json({ error: "Correo o contraseña incorrectos." });
  res.json(r);
});
app.post("/api/auth/demo", async (req, res) => {
  const r = await auth.demoLogin(String(req.body?.role || "admin"));
  if (!r) return res.status(404).json({ error: "La demostración no está activa." });
  res.json(r);
});
app.post("/api/auth/olvido", async (req, res) => {
  const origin = (process.env.APP_ORIGIN || "").split(",")[0].trim() || "https://agente-ia.skynetgenesis.com";
  try { await auth.forgot(req.body?.email, origin, (to, sub, txt) => ch.sendEmail(to, sub, txt, { sistema: true })); } catch (e) { console.error("olvido", e.message); }
  res.json({ ok: true, msg: "Si el correo está registrado, le enviamos un enlace para cambiar la contraseña. Revise también la carpeta de spam." });
});
app.post("/api/auth/reset", async (req, res) => {
  const r = await auth.resetPassword(req.body?.token, req.body?.password);
  if (r.error) return res.status(400).json(r); res.json(r);
});
bold.routes(app); // aviso del sistema central de pagos (sin sesión; se confirma con el verificador)
app.use("/api", auth.middleware);
app.get("/api/auth/me", (req, res) => res.json({ user: req.user }));
// Estado de cierre en memoria por 60 s (las consultas frecuentes de la app no despiertan la base de datos)
const cierreMem = new Map();
async function cerradaCache(tid) {
  const c = cierreMem.get(tid), ver = db.mem.doc.get("tenants/" + tid);
  if (c && Date.now() - c.at < 60000 && c.ver === ver) return c.v;
  const t = await db.getDoc("tenants/" + tid); const v = t.exists && cobro.cerrada(t.data);
  cierreMem.set(tid, { v, at: Date.now(), ver: db.mem.doc.get("tenants/" + tid) }); if (cierreMem.size > 5000) cierreMem.clear();
  return v;
}
// Regla de cobro: el día 5 sin pago (o al terminar la prueba) la empresa queda cerrada; no puede registrar ni cambiar nada (la app muestra la pantalla de cierre)
app.use("/api", async (req, res, next) => {
  try {
    const u = req.user; if (!u || u.staff || !u.tid || req.path === "/auth/me" || req.path === "/auth/password" || req.path.startsWith("/bold/")) return next();
    // Cerrada: solo puede ver su pantalla de pago (datos de la empresa y sus recibos), no trabajar ni descargar
    if (req.method === "GET" && (/^\/(doc|col)$/.test(req.path) && /^(tenants\/[^/]+|tenants|platform\/settings|boldpagos|billing|staff|tenants\/[^/]+\/(config\/main|config\/logo|config\/connections|users|sedes)|tenants\/[^/]+\/usage\/[\w-]+)$/.test(String(req.query.path || "")))) return next();
    if (await cerradaCache(u.tid)) return res.status(402).json({ error: cobro.MSG, code: "cerrada" });
  } catch (e) { console.error("revisión de cierre", e.message); return res.status(503).json({ error: "No se pudo revisar el estado de la empresa. Intente de nuevo." }); }
  next();
});
app.post("/api/auth/password", async (req, res) => {
  if (req.user.demo || req.user.tid === auth.DEMO_TID) return res.status(403).json({ error: "En la demostración no se cambia la contraseña." });
  const { current, password } = req.body || {};
  const r = await db.pool.query("SELECT email FROM auth_users WHERE id=$1", [req.user.id]);
  if (!r.rows[0] || !((await auth.login(r.rows[0].email, current)) || {}).token) return res.status(400).json({ error: "La contraseña actual no es correcta." });
  if (!password || String(password).length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
  await auth.upsertUser({ id: req.user.id, password }); res.json({ ok: true });
});
// Crear o editar el acceso de un usuario (administrador de la empresa o proveedor)
app.post("/api/auth/users", async (req, res) => {
  const u = req.user, b = req.body || {};
  const tid = u.staff ? b.tid : u.tid;
  if (!u.staff && u.role !== "admin") return res.status(403).json({ error: "Solo el administrador crea usuarios." });
  if (!u.staff && u.tid === auth.DEMO_TID) return res.status(403).json({ error: "En la demostración no se crean usuarios con acceso." });
  if (!tid || !b.id || !["admin", "supervisor", "asesor"].includes(b.role)) return res.status(400).json({ error: "Datos incompletos." });
  // Identificadores reservados (usuario interno del motor, demostración, Superadministrador) no se pueden crear
  if (!/^u[A-Za-z0-9_-]{2,40}$/.test(String(b.id)) || /^u-demo/.test(String(b.id))) return res.status(400).json({ error: "Identificador de usuario no válido." });
  if (b.password && String(b.password).length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  if (!u.staff && b.id === u.id) return res.status(403).json({ error: "Su propia contraseña y su correo se cambian en «Cambiar contraseña», con la contraseña actual." });
  // Límite de usuarios del plan (también en el servidor)
  const exists = await db.getDoc(`tenants/${tid}/users/${b.id}`);
  // El administrador no cambia el correo ni la contraseña de OTRO administrador (cada uno cambia la suya con la actual)
  if (!u.staff && exists.exists && exists.data.role === "admin" && (b.password || (b.email && b.email !== exists.data.email))) return res.status(403).json({ error: "El correo y la contraseña de otro administrador solo los cambia él mismo (o SkyNet Genesis)." });
  if ((!exists.exists || exists.data.active === false) && b.active !== false) { const tn = await db.getDoc("tenants/" + tid); const MAXU = { basico: 2, pro: 5, empresarial: 50 }; const n = (await db.listCol(`tenants/${tid}/users`)).filter((x) => x.data.active !== false).length;
    if (tn.exists && n >= (MAXU[tn.data.plan] || 5)) return res.status(403).json({ error: `El plan permite hasta ${MAXU[tn.data.plan] || 5} usuarios activos. Desactive uno o cambie de plan.` }); }
  const ex = await db.pool.query("SELECT tenant_id FROM auth_users WHERE id=$1", [b.id]);
  if (ex.rows[0] && ex.rows[0].tenant_id !== tid) return res.status(403).json({ error: "No permitido." });
  if (b.email && (await db.pool.query("SELECT 1 FROM bloqueos WHERE email=$1", [String(b.email).trim().toLowerCase()])).rows[0]) return res.status(403).json({ error: "Ese correo está bloqueado por SkyNet Genesis. Escríbanos por WhatsApp (304 437 5758)." });
  try {
    if (b.email) await auth.upsertUser({ id: b.id, email: b.email, password: b.password, tid, role: b.role, staff: false, active: b.active !== false });
    const doc = { name: b.name, email: b.email || "", role: b.role, active: b.active !== false, createdAt: b.createdAt || Date.now(), ...(b.sede !== undefined ? { sede: b.sede } : {}), ...(b.goal !== undefined ? { goal: b.goal } : {}) };
    await docs.guardedWrite({ ...u, tid, staff: true }, `tenants/${tid}/users/${b.id}`, doc);
    res.json({ ok: true, access: !!b.email });
  } catch (e) { res.status(400).json({ error: /duplicate|unique/i.test(e.message) ? "Ese correo ya tiene una cuenta." : e.message }); }
});


// 🔐 Cuentas y accesos (solo el Superadministrador). Las contraseñas están cifradas: nadie puede verlas (Ley 1581 de 2012).
// Se ve quién tiene acceso, si ya creó su contraseña y su último ingreso; se puede enviar el enlace de contraseña y bloquear con motivo.
app.get("/api/sa/cuentas", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
  const rows = (await db.pool.query("SELECT id, email, tenant_id, role, staff, active, created_at, last_login, pass_set FROM auth_users ORDER BY tenant_id NULLS FIRST, email")).rows;
  const bl = new Map((await db.pool.query("SELECT email, motivo, at FROM bloqueos")).rows.map((x) => [x.email, x]));
  const tn = new Map((await db.listCol("tenants")).map((x) => [x.id, x.data]));
  const nombres = new Map();
  for (const tid of new Set(rows.map((r) => r.tenant_id).filter(Boolean))) for (const u of await db.listCol(`tenants/${tid}/users`)) nombres.set(u.id, u.data.name);
  for (const s of await db.listCol("staff")) nombres.set(s.id, s.data.name);
  res.json({ cuentas: rows.map((r) => { const t = tn.get(r.tenant_id) || {}; const b = bl.get(String(r.email).toLowerCase());
    return { id: r.id, email: r.email, nombre: nombres.get(r.id) || "", empresa: r.staff ? "SkyNet Genesis" : t.name || r.tenant_id || "", tid: r.tenant_id, perfil: r.staff ? "Superadministrador" : r.role,
      activo: r.active && !b, clave: r.pass_set !== false, creado: Number(r.created_at) || null, ultimo: Number(r.last_login) || null, bloqueo: b ? { motivo: b.motivo, at: Number(b.at) } : null,
      dueno: auth.esDueno(r), demo: r.tenant_id === auth.DEMO_TID, interna: !!t.interna }; }) });
});
app.post("/api/sa/cuentas/enlace", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
  const r = (await db.pool.query("SELECT id, email, active, tenant_id, role, staff FROM auth_users WHERE id=$1", [String(req.body?.id || "")])).rows[0];
  if (!r) return res.status(404).json({ error: "No existe esa cuenta." });
  if (r.tenant_id === auth.DEMO_TID) return res.status(400).json({ error: "Las cuentas de la demostración no usan enlace." });
  if (!r.active) return res.status(400).json({ error: "La cuenta está desactivada o bloqueada. Desbloquéela primero." });
  const origin = (process.env.APP_ORIGIN || "").split(",")[0].trim() || "https://agente-ia.skynetgenesis.com";
  try { const x = await auth.enviarEnlace(r, origin, (to, sub, txt) => ch.sendEmail(to, sub, txt, { sistema: true }), "sa");
    await db.setDoc("bitacora/" + Date.now().toString(36), { at: Date.now(), by: req.user.id, accion: "enviar enlace de contraseña", cuenta: r.email });
    res.json({ ok: true, msg: x.dueno ? "Enlace enviado a rikardolondono@gmail.com (cuenta del dueño)." : "Enlace enviado a " + r.email + "." }); }
  catch (e) { res.status(503).json({ error: "No se pudo enviar el correo: " + e.message }); }
});
app.post("/api/sa/cuentas/bloquear", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
  const id = String(req.body?.id || ""), bloquear = req.body?.bloquear !== false, motivo = String(req.body?.motivo || "").trim().slice(0, 300);
  const r = (await db.pool.query("SELECT id, email, staff, tenant_id FROM auth_users WHERE id=$1", [id])).rows[0];
  if (!r) return res.status(404).json({ error: "No existe esa cuenta." });
  if (r.staff) return res.status(400).json({ error: "La cuenta del Superadministrador no se bloquea desde aquí." });
  if (r.tenant_id === auth.DEMO_TID) return res.status(400).json({ error: "Las cuentas de la demostración no se bloquean." });
  const em = String(r.email).toLowerCase();
  if (bloquear) {
    if (!motivo) return res.status(400).json({ error: "Escriba el motivo del bloqueo." });
    await db.pool.query("INSERT INTO bloqueos(email, motivo, por, at) VALUES($1,$2,$3,$4) ON CONFLICT (email) DO UPDATE SET motivo=$2, por=$3, at=$4", [em, motivo, req.user.id, Date.now()]);
    await db.pool.query("UPDATE auth_users SET active=false WHERE id=$1", [id]);
  } else {
    await db.pool.query("DELETE FROM bloqueos WHERE email=$1", [em]);
    const ud = r.tenant_id ? await db.getDoc(`tenants/${r.tenant_id}/users/${id}`) : null;
    await db.pool.query("UPDATE auth_users SET active=$2 WHERE id=$1", [id, !ud || !ud.exists || ud.data.active !== false]);
  }
  auth.forget(id);
  await db.setDoc("bitacora/" + Date.now().toString(36), { at: Date.now(), by: req.user.id, accion: bloquear ? "bloquear cuenta" : "desbloquear cuenta", cuenta: r.email, motivo });
  res.json({ ok: true });
});
// Empresas propias del dueño (POLIANDES, Clínica Reina Elizabeth, Anglocolombiano, SkyNet Genesis): «Hacer interna» = activa siempre, sin prueba ni cobros.
// Es la única excepción a «no regalar» (directiva 30 oct 2026). Solo el Superadministrador, con motivo y bitácora.
app.post("/api/sa/interna", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
  const tid = String(req.body?.tid || ""), on = req.body?.interna !== false, motivo = String(req.body?.motivo || "").trim().slice(0, 300);
  if (!db.validPath("tenants/" + tid, true) || tid === auth.DEMO_TID) return res.status(400).json({ error: "Empresa no válida." });
  if (!motivo) return res.status(400).json({ error: "Escriba el motivo (por ejemplo: empresa propia de Ricardo Londoño)." });
  const t = await db.getDoc("tenants/" + tid); if (!t.exists) return res.status(404).json({ error: "Empresa no encontrada." });
  await db.patchDoc("tenants/" + tid, on ? { interna: true, internaMotivo: motivo, internaAt: Date.now() } : { interna: false, internaMotivo: motivo, internaAt: Date.now() });
  await db.setDoc("bitacora/" + Date.now().toString(36), { at: Date.now(), by: req.user.id, accion: on ? "hacer interna" : "quitar interna", tid, empresa: t.data.name, motivo });
  res.json({ ok: true });
});

// Pagos: solo con el Bold de SkyNet Genesis (ver server/bold.js). Sin llave, sin «Ya pagué», sin desbloqueo provisional.
bold.firmaRoute(app);
bold.corregirRoutes(app);
const mant = require("./mantenimiento");
// Generar ahora las mensualidades del mes en curso (las mismas reglas del día 1: no se factura a empresas en prueba ni pagadas por adelantado)
app.post("/api/mensualidades/generar", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
  try { res.json({ n: await mant.genMonth(Date.now(), true) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
// Pagos de Bold que no cuadraron (quedan para el Superadministrador) y recibos
app.get("/api/bold/recibos", async (req, res) => {
  const u = req.user; const tid = u.staff ? String(req.query.tid || "") : u.tid;
  const all = (await db.listCol("boldpagos")).map((x) => x.data).filter((x) => (u.staff && !tid) || x.tid === tid).sort((a, b) => b.at - a.at).slice(0, 60);
  const rev = u.staff ? (await db.listCol("boldrevisar")).map((x) => ({ id: x.id, ...x.data })).filter((x) => x.estado === "pendiente") : [];
  res.json({ recibos: all, revisar: rev });
});
// Prospectos y cobros archivados (más de 6 meses sin actividad) en CSV, para el administrador
app.get("/api/archivo/:tid", async (req, res) => {
  const u = req.user, tid = req.params.tid;
  if (u.staff || !(u.tid === tid && ["admin", "supervisor"].includes(u.role))) return res.status(403).json({ error: "Solo el administrador o el supervisor de la empresa descargan sus datos." });
  const tipo = req.query.tipo === "cobros" ? "invarchive" : "archive";
  if (!db.validPath(`tenants/${tid}/${tipo}`, false)) return res.status(400).json({ error: "Ruta inválida" });
  const list = (await db.listCol(`tenants/${tid}/${tipo}`)).map((x) => x.data);
  const q = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  const f = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");
  const rows = tipo === "archive"
    ? [["nombre", "telefono", "correo", "canal", "interes", "etapa", "valor", "creado", "ultima_actividad", "archivado"], ...list.map((l) => [l.name, l.phone, l.email, l.channel, l.interest, l.stage, l.value, f(l.createdAt), f(l.updatedAt), f(l.archivedAt)])]
    : [["numero", "cliente", "concepto", "valor", "pagado", "vence", "archivado"], ...list.map((i) => [i.number, i.client, i.concept, i.amount, (i.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0), f(i.dueAt), f(i.archivedAt)])];
  res.json({ n: list.length, csv: "\ufeff" + rows.map((r) => r.map(q).join(",")).join("\n") + "\n\n\"Generado con Agente-IA de SkyNet Genesis · contacto@skynetgenesis.com · WhatsApp 304 437 5758\"\n" });
});
// Documentos (la app los usa igual que en la versión de prueba)
app.use("/api", docs.router());

// Módulo «Asesor con IA para su página web»: estado y «Leer la página ahora» (administrador de la empresa)
app.get("/api/asesor/estado", async (req, res) => {
  const u = req.user; const tid = u.staff ? String(req.query.tid || "") : u.tid;
  if (u.staff) return res.status(403).json({ error: "El Superadministrador no ve datos de trabajo de las empresas." });
  const d = await require("./asesor").guardado(tid);
  res.json({ leida: d ? d.at : null, pages: d ? d.pages : [], chars: d && d.text ? d.text.length : 0, tope: require("./asesor").TOPE_PAGINA });
});
app.post("/api/asesor/leer", async (req, res) => {
  const u = req.user; if (u.staff || !["admin", "supervisor"].includes(u.role)) return res.status(403).json({ error: "Solo el administrador o el supervisor." });
  if (u.tid === auth.DEMO_TID) return res.status(403).json({ error: "En la demostración no se lee la página." });
  const t = await db.getDoc("tenants/" + u.tid); if (!t.exists || !["pro", "empresarial"].includes(t.data.plan)) return res.status(403).json({ error: "El asesor con IA está disponible desde el plan Profesional." });
  const k = "asesorlim:" + u.tid + ":" + cobro.HOY(); const n = Number(await db.kvGet(k)) || 0; if (n >= 5) return res.status(429).json({ error: "Ya leyó la página 5 veces hoy. Intente mañana (también se relee sola cada lunes)." }); await db.kvSet(k, n + 1);
  try { res.json(await require("./asesor").leer(u.tid)); } catch (e) { res.status(500).json({ error: "No se pudo leer la página: " + e.message }); }
});

// IA para la app (Probar como cliente, sugerencias, análisis)
// Estado del módulo de IA: la empresa ve sus créditos; el Superadministrador ve el gasto de toda la plataforma
app.get("/api/ia/estado", async (req, res) => {
  const IA = require("./ia"); const u = req.user;
  const base = { on: IA.on(), packs: IA.PACKS, dias: IA.DIAS, planes: IA.PLANES_CON_IA };
  if (u.staff) { const usd = await IA.gastoPlataforma(), ui = await IA.gastoInternas(); return res.json({ ...base, plataforma: { usdMes: Number(usd.toFixed(4)), topeUSD: IA.topeMes(), internasUSD: Number(ui.toFixed(4)), topeInternasUSD: IA.topeInternas() } }); }
  const t = await db.getDoc("tenants/" + u.tid);
  res.json({ ...base, empresa: IA.estado(t.exists ? t.data : null), puede: IA.puedeComprar(t.exists ? t.data : null) || "" });
});
// IA libre desde la app: solo el Superadministrador (las empresas usan la IA únicamente con sus paquetes, en las respuestas de SofIA)
app.post("/api/ai", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "La inteligencia artificial de SofIA se compra por paquetes en Plan y consumo.", code: "sampling_disabled" });
  if (process.env.AI_ENABLED === "false" || !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "La inteligencia artificial está desactivada.", code: "sampling_disabled" });
  const { input, json, tier } = req.body || {};
  try {
    if (json) { const data = await ai.askJSON(input, { tier: tier || "quick", tid: req.user.tid, maxTokens: 1200 }); return res.json({ data }); }
    const r = await ai.ask(input, { tier: tier || "quick", tid: req.user.tid, maxTokens: tier === "default" ? 1500 : 900 });
    res.json({ text: r.text, truncated: r.truncated });
  } catch (e) { res.status(e.code === "rate_limited" ? 429 : 503).json({ error: e.message, code: e.code || "upstream_error", text: e.text }); }
});

// Credenciales de canales (solo el proveedor). Nunca se devuelven a la app.
app.post("/api/secrets", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
  const { tid, values } = req.body || {};
  if (!tid || typeof values !== "object") return res.status(400).json({ error: "Datos incompletos." });
  const allowed = ["page_id", "page_token", "ig_id"];
  for (const [k, v] of Object.entries(values)) if (allowed.includes(k) && v !== undefined) await db.setSecret(tid, k, String(v).trim());
  res.json({ ok: true, has: Object.keys(await db.getSecrets(tid)) });
});
app.get("/api/secrets/:tid", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
  res.json({ has: Object.keys(await db.getSecrets(req.params.tid)) });
});
app.post("/api/secrets/:tid/apikey", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
  const key = "gc_" + crypto.randomBytes(24).toString("base64url");
  await db.setSecret(req.params.tid, "api_key", key); res.json({ key });
});
// Ejecutar ahora los envíos automáticos de una empresa (botones "Enviar ahora")
app.post("/api/engine/run", async (req, res) => {
  const tid = req.user.staff ? req.body?.tid : req.user.tid;
  await engine.tick(tid, true); res.json({ ok: true });
});
app.use("/api", (_req, res) => res.status(404).json({ error: "No encontrado" }));

// La app también se puede servir desde aquí (además de GitHub Pages)
app.use(express.static(path.join(__dirname, "..", "docs"), { index: "index.html" }));

const PORT = process.env.PORT || 3000;
(async () => {
  await db.init(); await auth.bootstrap(); await auth.bootstrapDemo().catch((e) => console.error("demo", e.message));
  app.listen(PORT, () => console.log("Agente-IA escuchando en", PORT));
  // Revisión interna cada 5 minutos mientras el servidor esté despierto (solo usa la base si hay algo pendiente)
  setInterval(() => engine.tick().catch((e) => console.error("tick", e.message)), 5 * 60000);
})().catch((e) => { console.error(e); process.exit(1); });

module.exports = app;
