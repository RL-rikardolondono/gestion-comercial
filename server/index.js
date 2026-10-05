// Gestión ComercIAl — servidor
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

const app = express();
app.disable("x-powered-by");
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
  const r = await auth.login(req.body?.email, req.body?.password);
  if (!r) return res.status(401).json({ error: "Correo o contraseña incorrectos." });
  res.json(r);
});
app.use("/api", auth.middleware);
app.get("/api/auth/me", (req, res) => res.json({ user: req.user }));
// Regla de cobro: el día 10 sin pago la empresa queda cerrada; no puede registrar ni cambiar nada (la app muestra la pantalla de cierre)
app.use("/api", async (req, res, next) => {
  try {
    const u = req.user; if (!u || u.staff || !u.tid || req.method === "GET" || req.path.startsWith("/auth/")) return next();
    const t = await db.getDoc("tenants/" + u.tid);
    if (t.exists && cobro.cerrada(t.data)) return res.status(402).json({ error: cobro.MSG, code: "cerrada" });
  } catch (e) { /* si falla la revisión no se bloquea */ }
  next();
});
app.post("/api/auth/password", async (req, res) => {
  const { current, password } = req.body || {};
  const r = await db.pool.query("SELECT email FROM auth_users WHERE id=$1", [req.user.id]);
  if (!r.rows[0] || !(await auth.login(r.rows[0].email, current))) return res.status(400).json({ error: "La contraseña actual no es correcta." });
  if (!password || String(password).length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
  await auth.upsertUser({ id: req.user.id, password }); res.json({ ok: true });
});
// Crear o editar el acceso de un usuario (administrador de la empresa o proveedor)
app.post("/api/auth/users", async (req, res) => {
  const u = req.user, b = req.body || {};
  const tid = u.staff ? b.tid : u.tid;
  if (!u.staff && u.role !== "admin") return res.status(403).json({ error: "Solo el administrador crea usuarios." });
  if (!tid || !b.id || !["admin", "supervisor", "asesor"].includes(b.role)) return res.status(400).json({ error: "Datos incompletos." });
  if (b.password && String(b.password).length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  const ex = await db.pool.query("SELECT tenant_id FROM auth_users WHERE id=$1", [b.id]);
  if (ex.rows[0] && ex.rows[0].tenant_id !== tid) return res.status(403).json({ error: "No permitido." });
  try {
    if (b.email) await auth.upsertUser({ id: b.id, email: b.email, password: b.password, tid, role: b.role, staff: false, active: b.active !== false });
    const doc = { name: b.name, email: b.email || "", role: b.role, active: b.active !== false, createdAt: b.createdAt || Date.now(), ...(b.sede !== undefined ? { sede: b.sede } : {}), ...(b.goal !== undefined ? { goal: b.goal } : {}) };
    await docs.guardedWrite({ ...u, tid, staff: true }, `tenants/${tid}/users/${b.id}`, doc);
    res.json({ ok: true, access: !!b.email });
  } catch (e) { res.status(400).json({ error: /duplicate|unique/i.test(e.message) ? "Ese correo ya tiene una cuenta." : e.message }); }
});

// Documentos (la app los usa igual que en la versión de prueba)
app.use("/api", docs.router());

// IA para la app (Probar como cliente, sugerencias, análisis)
app.post("/api/ai", async (req, res) => {
  if (process.env.AI_ENABLED !== "true") return res.status(503).json({ error: "La inteligencia artificial está desactivada.", code: "sampling_disabled" });
  const { input, json, tier } = req.body || {};
  try {
    if (json) { const data = await ai.askJSON(input, { tier: tier || "quick", tid: req.user.tid, maxTokens: 1200 }); return res.json({ data }); }
    const r = await ai.ask(input, { tier: tier || "quick", tid: req.user.tid, maxTokens: tier === "default" ? 1500 : 900 });
    res.json({ text: r.text, truncated: r.truncated });
  } catch (e) { res.status(e.code === "rate_limited" ? 429 : 503).json({ error: e.message, code: e.code || "upstream_error", text: e.text }); }
});

// Credenciales de canales (solo el proveedor). Nunca se devuelven a la app.
app.post("/api/secrets", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el proveedor." });
  const { tid, values } = req.body || {};
  if (!tid || typeof values !== "object") return res.status(400).json({ error: "Datos incompletos." });
  const allowed = ["wa_phone_id", "wa_token", "wa_template", "wa_template_lang", "page_id", "page_token", "ig_id"];
  for (const [k, v] of Object.entries(values)) if (allowed.includes(k) && v !== undefined) await db.setSecret(tid, k, String(v).trim());
  res.json({ ok: true, has: Object.keys(await db.getSecrets(tid)) });
});
app.get("/api/secrets/:tid", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el proveedor." });
  res.json({ has: Object.keys(await db.getSecrets(req.params.tid)) });
});
app.post("/api/secrets/:tid/apikey", async (req, res) => {
  if (!req.user.staff) return res.status(403).json({ error: "Solo el proveedor." });
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
  await db.init(); await auth.bootstrap();
  app.listen(PORT, () => console.log("Gestión ComercIAl escuchando en", PORT));
  // Revisión interna cada 5 minutos mientras el servidor esté despierto (solo usa la base si hay algo pendiente)
  setInterval(() => engine.tick().catch((e) => console.error("tick", e.message)), 5 * 60000);
})().catch((e) => { console.error(e); process.exit(1); });

module.exports = app;
