// Pagos con el Bold de SkyNet Genesis (sistema central en skynetgenesis.com, ver memoria "pagos-bold").
// 1) La app pide la firma al firmador central (bold-firma.php) y abre la pasarela de Bold.
// 2) Bold avisa al receptor central (bold-webhook.php), que llama a POST /api/bold/aplicar de este servidor.
// 3) Este servidor NO confía en lo que llega: confirma cada pago consultando bold-verificar.php y aplica
//    solo la orden que devuelve el verificador, una sola vez por pago_id (sin secreto compartido).
// 4) Respaldo: al volver de Bold la app llama GET /api/bold/volver?ref=<orden>, por si el aviso no llega.
const mant = require("./mantenimiento");
const cobro = require("./cobro");
const db = require("./db");
const APP = "agente-ia";
const UA = "SkyNetGenesis-AgenteIA/1.0"; // SiteGround rechaza llamadas de servidor sin User-Agent
const FIRMA = () => process.env.BOLD_FIRMA || "https://skynetgenesis.com/bold-firma.php";
const VERIF = () => process.env.BOLD_VERIFICAR || "https://skynetgenesis.com/bold-verificar.php";
const PLAN_ID = { basico: "basico", pro: "pro", empresarial: "empresarial" };
const PLAN_SEDES = { empresarial: 1 };

// Normaliza la respuesta del verificador (acepta {orden}, {order}, {data} o la orden plana)
function norm(j) {
  if (!j || j.ok === false || j.error) return null;
  const o = j.orden || j.order || j.data || j;
  const pago_id = o.pago_id || o.pagoId || o.payment_id || o.transaccion || o.id;
  const plan = o.plan, empresa = o.empresa, valor = Number(o.valor ?? o.amount ?? o.monto ?? o.total);
  if (!pago_id || !plan || !empresa || !(valor > 0)) return null;
  if (o.app && o.app !== APP) return null;
  if (!String(plan).startsWith(APP + ":")) return null;
  // Solo pagos aprobados (el verificador central solo devuelve pagos recibidos; si trae estado, debe ser exactamente aprobado)
  if (o.estado != null && !/^(approved|aprobado|aprobada)$/i.test(String(o.estado).trim())) return null;
  return { pago_id: String(pago_id), plan: String(plan), empresa: String(empresa), valor, meses: Number(o.meses) || 1, referencia: String(o.referencia || o.ref || o.orderId || o.order_id || "") };
}
async function verificar(q) {
  const r = await fetch(VERIF() + "?" + new URLSearchParams({ ...q, app: APP }), { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return null;
  return norm(await r.json().catch(() => null));
}
// Plan que debe pagar esta empresa este mes (lo decide el servidor, no el navegador)
function planDe(t, sedes) {
  const p = PLAN_ID[t.plan] || "pro";
  const extra = PLAN_SEDES[p] ? Math.max(0, (Number(sedes ?? t.sedes) || 0) - PLAN_SEDES[p]) : 0;
  return extra ? `${APP}:paq_${p}_sede-x${extra}` : `${APP}:${p}`;
}

const hits = new Map();
const limit = (req, n) => { const k = req.ip + req.path, now = Date.now(); const h = (hits.get(k) || []).filter((t) => now - t < 60000); h.push(now); hits.set(k, h); if (hits.size > 5000) hits.clear(); return h.length > n; };
function routes(app) {
  // Aviso del receptor central (sin sesión). Siempre se confirma con el verificador antes de aplicar.
  app.post("/api/bold/aplicar", async (req, res) => {
    if (limit(req, 60)) return res.status(429).json({ ok: false, error: "Demasiadas solicitudes." });
    try {
      const b = req.body || {};
      const id = b.pago_id || b.pagoId || b.payment_id || (b.orden && b.orden.pago_id);
      const ref = b.referencia || b.ref || (b.orden && (b.orden.referencia || b.orden.orderId));
      if (!id && !ref) return res.status(400).json({ ok: false, error: "Falta el pago." });
      const o = await verificar(id ? { pago: String(id) } : { ref: String(ref) });
      if (!o) return res.status(409).json({ ok: false, error: "El verificador central no confirma este pago." });
      await mant.applyBold(o);
      res.json({ ok: true });
    } catch (e) { console.error("bold aplicar", e.message); res.status(500).json({ ok: false, error: "No se pudo aplicar; el sistema central lo reintentará." }); }
  });
  // Respaldo al volver de la pasarela (?bold-order-id=...): consulta por la orden
  app.get("/api/bold/volver", async (req, res) => {
    if (limit(req, 20)) return res.status(429).json({ ok: false });
    const ref = String(req.query.ref || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    if (!ref) return res.status(400).json({ ok: false });
    try {
      const o = await verificar({ ref });
      if (!o) return res.json({ ok: false, pendiente: true, msg: "Bold todavía no ha confirmado el pago. En unos minutos se aplica solo." });
      const r = await mant.applyBold(o);
      if (r.revisar) return res.json({ ok: false, revisar: true, msg: "Su pago llegó y SkyNet Genesis lo está revisando. Le avisaremos por correo." });
      if (r.ia || (r.repetido && /:ia\d+$/.test(o.plan))) { const t = await db.getDoc("tenants/" + String(o.empresa).split("__")[0]); return res.json({ ok: true, ia: true, iaHasta: t.exists && t.data.ia ? t.data.ia.until : null }); }
      res.json({ ok: !!r.paidUntil || !!r.prueba, paidUntil: r.paidUntil || null });
    } catch (e) { res.status(500).json({ ok: false }); }
  });
}
// Con sesión (Superadministrador): volver a aplicar un pago que Bold aprobó y no llegó solo. Se confirma con el verificador central:
// no se puede regalar un mes ni registrar un pago que Bold no tenga.
function corregirRoutes(app) {
  app.post("/api/bold/corregir", async (req, res) => {
    if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
    const v = String(req.body?.ref || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80); if (!v) return res.status(400).json({ error: "Escriba el número de la transacción o del pedido de Bold." });
    try {
      const o = (await verificar({ pago: v })) || (await verificar({ ref: v }));
      if (!o) return res.status(404).json({ error: "El sistema central de pagos no tiene ese pago aprobado. Revíselo en el panel de Bold." });
      // Un pago que quedó para revisar (por ejemplo, plan distinto) se puede volver a aplicar después de corregir la empresa;
      // pasa otra vez por todas las revisiones (valor, plan), así que no sirve para regalar nada
      const rid = String(o.pago_id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
      const rv = await db.getDoc("boldrevisar/" + rid); const yaRecibo = await db.getDoc("boldpagos/" + rid);
      if (rv.exists && rv.data.estado === "pendiente" && !yaRecibo.exists) { await mant.liberar(o); await db.setDoc("boldrevisar/" + rid, { ...rv.data, estado: "reintentado", reintentoAt: Date.now() }); }
      const r = await mant.applyBold(o);
      await db.setDoc("bitacora/" + Date.now().toString(36), { at: Date.now(), by: req.user.id, accion: "corregir pago Bold", ref: v, resultado: r });
      res.json(r);
    } catch (e) { res.status(500).json({ error: "No se pudo aplicar." }); }
  });
  // Marcar como revisado un pago que no cuadró (queda la nota; no cambia «Pagado hasta»)
  app.post("/api/bold/revisado", async (req, res) => {
    if (!req.user.staff) return res.status(403).json({ error: "Solo el Superadministrador." });
    const id = String(req.body?.id || ""); const nota = String(req.body?.nota || "").trim().slice(0, 300);
    if (!db.validPath("boldrevisar/" + id, true)) return res.status(400).json({ error: "Ruta inválida" });
    if (!nota) return res.status(400).json({ error: "Escriba qué se hizo con este pago (por ejemplo: devuelto, o aplicado tras corregir el plan)." });
    const d = await db.getDoc("boldrevisar/" + id); if (!d.exists) return res.status(404).json({ error: "No existe." });
    await db.setDoc("boldrevisar/" + id, { ...d.data, estado: "revisado", nota, revisadoAt: Date.now(), by: req.user.id }); res.json({ ok: true });
  });
}
// Con sesión: pide la firma del pedido al firmador central (el navegador no elige el valor)
function firmaRoute(app) {
  app.post("/api/bold/firma", async (req, res) => {
    const u = req.user;
    const tid = u.staff ? String(req.body?.tid || "") : u.tid;
    const prueba = u.staff && req.body?.prueba === true;
    if (!prueba && (!tid || u.tid === require("./auth").DEMO_TID)) return res.status(400).json({ error: "En la demostración no se hacen pagos." });
    if (!prueba && !u.staff && u.role !== "admin") return res.status(403).json({ error: "Solo el administrador de la empresa paga la mensualidad." });
    try {
      let plan = `${APP}:prueba`, empresa = "plataforma", hasta = null, valor = 1000;
      const pack = String(req.body?.pack || "");
      if (!prueba && pack) { // paquete de inteligencia artificial (Market)
        const IA = require("./ia"); const pk = IA.PACKS[pack]; if (!pk) return res.status(400).json({ error: "Ese paquete no existe." });
        const t = await db.getDoc("tenants/" + tid); if (!t.exists) return res.status(404).json({ error: "Empresa no encontrada." });
        const no = IA.puedeComprar(t.data); if (no) return res.status(400).json({ error: no });
        plan = `${APP}:${pack}`; empresa = tid; valor = pk.price; hasta = cobro.addD(cobro.HOY(), IA.DIAS);
      } else if (!prueba) {
        const t = await db.getDoc("tenants/" + tid); if (!t.exists) return res.status(404).json({ error: "Empresa no encontrada." });
        if (t.data.interna) return res.status(400).json({ error: "Empresa interna de SkyNet Genesis: está activa sin cobros y no paga mensualidad." });
        const sedes = await mant.sedesOf(tid, t.data);
        plan = planDe(t.data, sedes); empresa = tid; hasta = cobro.trasPago(t.data); valor = await mant.feeOf(t.data, tid);
      }
      const origin = (process.env.APP_ORIGIN || "").split(",")[0].trim() || "https://agente-ia.skynetgenesis.com";
      const q = new URLSearchParams({ plan, empresa, meses: "1", volver: origin.replace(/\/$/, "") + "/" /* el firmador descarta un volver con "?": la vuelta se reconoce por ?bold-order-id */ });
      const r = await fetch(FIRMA() + "?" + q, { headers: { "User-Agent": UA, Accept: "application/json" } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.error) return res.status(502).json({ error: (j && j.error) || "El sistema de pagos no respondió. Intente de nuevo en unos minutos." });
      // El precio que cobra el firmador central debe ser el mismo que la app muestra y exige
      const amt = Number((j.orden || j.order || j).amount ?? (j.orden || j.order || j).valor);
      if (amt && amt !== valor) { console.error("bold firma: precio distinto", plan, amt, valor); return res.status(409).json({ error: "El precio del plan no coincide con el sistema de pagos. Escríbanos por WhatsApp (304 437 5758) para corregirlo antes de pagar." }); }
      res.json({ ...j, plan, hasta, valor });
    } catch (e) { res.status(502).json({ error: "El sistema de pagos no respondió. Intente de nuevo en unos minutos." }); }
  });
}
module.exports = { routes, firmaRoute, corregirRoutes, norm, planDe, APP };
