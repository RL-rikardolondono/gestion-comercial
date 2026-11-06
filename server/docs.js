// API del almacén de documentos con reglas de acceso por empresa y por rol.
const express = require("express");
const db = require("./db");

const ADMIN = ["admin"], MANAGERS = ["admin", "supervisor"];
// Usuario interno del motor del servidor: se reconoce por ser ESTE objeto (nunca por un id que alguien pueda crear)
const SYSTEM = Object.freeze({ id: "system", staff: true, role: "proveedor" });
const isSys = (u) => u === SYSTEM;
const seg = (p) => p.split("/");

// ¿Puede leer esta ruta (doc o colección)?
// Datos de trabajo de cada empresa (conversaciones, cobros a sus clientes, citas, archivo, bitácora):
// el Superadministrador administra la plataforma pero NO los ve (directiva). El motor del servidor sí (usuario "system").
const WORK = ["leads", "invoices", "appts", "archive", "invarchive", "audit", "locks"];
const isWork = (s) => s[0] === "tenants" && s.length >= 3 && WORK.includes(s[2]);
function canRead(u, path) {
  const s = seg(path);
  if (u.staff) return isSys(u) || !isWork(s);
  if (s[0] === "tenants") return s.length === 1 || s[1] === u.tid;     // la colección se filtra después
  if (s[0] === "platform") return s[1] === "settings" || s.length === 1;
  if (s[0] === "boldpagos") return s.length <= 2;                        // recibos de pagos con Bold: se filtran por empresa
  if (s[0] === "_") return false;
  if (s[0] === "staff") return true;                                     // solo nombres, sin secretos
  if (s[0] === "billing" || s[0] === "tickets") return true;             // se filtra por tid
  return false;
}
// ¿Puede escribir? data = documento nuevo (para validar tid en billing/tickets)
function canWrite(u, path, data) {
  const s = seg(path);
  if (u.staff) return isSys(u) || !isWork(s);
  if (s[0] === "tickets") return s.length === 2 && !!data && data.tid === u.tid; // el dueño se revisa al guardar; borrar es solo del proveedor
  if (s[0] !== "tenants" || s[1] !== u.tid) return false;
  if (s.length === 2) return true;                                       // datos de la empresa: se limitan abajo según el rol
  const sub = s[2];
  if (sub === "users") return ADMIN.includes(u.role);
  if (sub === "config") return true;                                     // config/main: se valida abajo
  if (sub === "invoices") return MANAGERS.includes(u.role);
  if (sub === "sedes") return ADMIN.includes(u.role);
  return ["leads", "appts", "audit", "usage", "locks"].includes(sub);
}
const filterList = (u, colPath, docs) => {
  if (u.staff) return docs;
  if (colPath === "tenants") return docs.filter((d) => d.id === u.tid);
  if (colPath === "billing" || colPath === "tickets" || colPath === "boldpagos") return docs.filter((d) => d.data && d.data.tid === u.tid);
  return docs;
};

// El número de sedes lo cuenta el servidor (de él depende la mensualidad del plan Empresarial).
// Se cobra el mayor número de sedes que tuvo la empresa en el mes: borrar sedes antes de pagar no baja el precio.
async function syncSedes(tid) {
  const n = (await db.listCol(`tenants/${tid}/sedes`)).length;
  const t = await db.getDoc("tenants/" + tid); if (!t.exists) return;
  const m = require("./cobro").HOY().slice(0, 7), old = t.data.sedesPeak || null;
  const cur = old && old.m === m ? old : { m, n: 0, prev: old ? { m: old.m, n: old.n } : (old && old.prev) || null };
  await db.patchDoc("tenants/" + tid, { sedes: n, sedesPeak: { ...cur, n: Math.max(cur.n || 0, n) } });
}
// Pruebas locales (selftest y simulación, solo con base en localhost): el Superadministrador puede fijar el estado de cobro
const TEST_BILL = () => process.env.SIMULACION_LOCAL === "1" && /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");
// Ganchos al guardar (se registran desde index.js)
const hooks = [];
const onWrite = (fn) => hooks.push(fn);

async function guardedWrite(u, path, data) {
  const s = seg(path);
  const prev = await db.getDoc(path);
  // Un soporte solo lo puede modificar la empresa que lo creó
  if (s[0] === "tickets" && !u.staff && prev.exists && prev.data.tid !== u.tid) throw Object.assign(new Error("No permitido"), { status: 403 });
  // Logo: solo una imagen en datos (png, jpg, webp o gif; sin SVG), para que nadie pueda meter código en la pantalla de otros
  if (s[0] === "tenants" && s[2] === "config" && s[3] === "logo" && data && data.data && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(String(data.data))) throw Object.assign(new Error("El logo debe ser una imagen PNG, JPG, WEBP o GIF."), { status: 400 });
  // Empresa: solo el proveedor cambia plan, estado y datos de facturación
  // Cobro: «Pagado hasta», la prueba, los pagos y el número de sedes los pone SOLO el servidor (Bold y el conteo real de sedes).
  // Ni la empresa ni el Superadministrador los cambian desde la app: así nadie regala meses ni baja su precio.
  if (s[0] === "tenants" && s.length === 2 && !isSys(u) && !(u.staff && TEST_BILL())) {
    const BILL = ["paidUntil", "trialUntil", "paidOnce", "lastPay", "credit", "sedes", "sedesPeak", "ia", "interna"]; /* ia: créditos de IA, solo los pone el pago de Bold */
    if (prev.exists) { for (const k of BILL) { if (k in prev.data) data[k] = prev.data[k]; else delete data[k]; } }
    else { for (const k of BILL) delete data[k]; if (u.staff) data.trialUntil = require("./cobro").addD(require("./cobro").HOY(), 14); }
  }
  // Bajar de plan: primero hay que dejar los usuarios activos dentro del límite del plan nuevo
  if (s[0] === "tenants" && s.length === 2 && u.staff && prev.exists && data.plan && data.plan !== prev.data.plan) {
    const MAXU = { basico: 2, pro: 5, empresarial: 50 }; const lim = MAXU[data.plan] || 5;
    const act = (await db.listCol(`tenants/${s[1]}/users`)).filter((x) => x.data.active !== false).length;
    if (act > lim) throw Object.assign(new Error(`Antes de cambiar a ese plan hay que desactivar ${act - lim} usuario(s): el plan permite ${lim} y la empresa tiene ${act} activos.`), { status: 400 });
  }
  if (s[0] === "tenants" && s.length === 2 && !u.staff) {
    if (!prev.exists) throw Object.assign(new Error("No permitido"), { status: 403 });
    const keep = ["plan", "status", "nit", "razon", "feMail", "name", "createdAt", "demo"];
    for (const k of keep) data[k] = prev.data[k];
    // Supervisores y asesores solo actualizan las estadísticas de uso; el resto lo cambia el administrador
    if (!ADMIN.includes(u.role)) data = { ...prev.data, stats: data.stats };
  }
  // Configuración: solo el administrador; los demás solo pueden mover el turno del reparto
  if (s[2] === "config" && !u.staff && !ADMIN.includes(u.role)) {
    if (!prev.exists) throw Object.assign(new Error("No permitido"), { status: 403 });
    // Se guarda solo el turno del reparto; cualquier otro cambio se ignora (sin error, para no frenar el trabajo)
    const rr = data.biz && data.biz.rr;
    data = JSON.parse(JSON.stringify(prev.data)); if (rr !== undefined) data.biz = { ...(data.biz || {}), rr };
  }
  // Toda edición de una persona marca la hora en el servidor (así el motor sabe que su copia quedó vieja)
  if (s[0] === "tenants" && s[2] === "leads" && s.length === 4 && data && !isSys(u)) { delete data._base; data.updatedAt = Math.max(Date.now(), ((prev.exists && prev.data.updatedAt) || 0) + 1); }
  // El motor trabaja con una copia leída al empezar su ronda: si alguien de la empresa guardó la ficha mientras tanto
  // (por ejemplo, la marcó «Ganado»), el motor solo aporta sus propios campos y no devuelve la ficha a como estaba.
  if (s[0] === "tenants" && s[2] === "leads" && s.length === 4 && data && "_base" in data) {
    const base = Number(data._base) || 0; delete data._base;
    if (isSys(u) && prev.exists && (prev.data.updatedAt || 0) > base) {
      const ENGINE = ["messages", "lastInboundAt", "lastOutboundAt", "awaiting", "followStep", "handoff", "optOut", "followPaused", "consent", "consentAt", "consentAsked", "careLog", "careDay", "awaitSurvey", "lastSurveyAt", "csat", "csatAt", "csatLog", "cases", "score", "extKey", "owner", "surveySent", "updatedAt", "bot", "stageLog"];
      const mine = {}; for (const k of ENGINE) if (k in data) mine[k] = data[k];
      if (!prev.data.interest && data.interest) mine.interest = data.interest;
      if (!prev.data.name && data.name) mine.name = data.name; if (!prev.data.phone && data.phone) mine.phone = data.phone; if (!prev.data.email && data.email) mine.email = data.email;
      if (prev.data.owner) delete mine.owner; // la asignación que hizo una persona manda
      data = { ...prev.data, ...mine };
    }
  }
  // Ley 1581: sin autorización no se guardan datos de la familia (incluidos menores de edad)
  if (s[0] === "tenants" && s[2] === "leads" && s.length === 4 && data && !data.famOk && Array.isArray(data.family) && data.family.length) data.family = [];
  // Conversaciones: nunca se pierde un mensaje aunque dos personas guarden al tiempo,
  // y se conservan las marcas de entrega para no enviar dos veces.
  if (s[0] === "tenants" && s[2] === "leads" && s.length === 4 && prev.exists && Array.isArray(prev.data.messages)) {
    const key = (m) => `${m.from}|${m.at}`;
    const mine = new Map((data.messages || []).map((m) => [key(m), m]));
    for (const m of prev.data.messages) {
      const k = key(m), cur = mine.get(k);
      if (!cur) mine.set(k, m); else if (m.d && !cur.d) { cur.d = m.d; cur.dAt = m.dAt; }
    }
    data.messages = [...mine.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-60);
    // Si el cliente pidió BAJA, una copia vieja del motor no puede dejar mensajes automáticos posteriores
    const ob = prev.data.optOut || data.optOut;
    if (ob) { data.optOut = ob; data.followPaused = true; data.messages = data.messages.filter((m) => !(m.from === "auto" && m.at > ob + 5 && !/No le enviaremos más/.test(m.text || ""))); }
    const lastIn = [...data.messages].reverse().find((m) => m.from === "cliente");
    if (lastIn && lastIn.at > (data.lastInboundAt || 0)) { data.lastInboundAt = lastIn.at; const lastAny = data.messages[data.messages.length - 1]; if (lastAny.from === "cliente") data.awaiting = "empresa"; }
    // Posventa: una copia vieja tampoco borra los saludos ya enviados (no se repiten) ni los casos abiertos por SofIA
    const o = prev.data;
    if (o.careLog) data.careLog = { ...o.careLog, ...(data.careLog || {}) };
    if (o.careDay && String(o.careDay) > String(data.careDay || "")) data.careDay = o.careDay;
    if ((o.lastSurveyAt || 0) > (data.lastSurveyAt || 0)) { data.lastSurveyAt = o.lastSurveyAt; data.awaitSurvey = o.awaitSurvey; }
    if ((o.csatAt || 0) > (data.csatAt || 0)) { data.csat = o.csat; data.csatAt = o.csatAt; data.csatLog = o.csatLog; if ((o.csatAt || 0) > (data.lastSurveyAt || 0)) data.awaitSurvey = false; }
    if (Array.isArray(o.cases) && o.cases.length) { const res = new Map(o.cases.filter((c) => c.status !== "abierto").map((c) => [c.id, c])); data.cases = (data.cases || []).map((c) => (c.status === "abierto" && res.has(c.id) ? res.get(c.id) : c)); const ids = new Set((data.cases || []).map((c) => c.id)); const lost = o.cases.filter((c) => !ids.has(c.id)); if (lost.length) { data.cases = [...(data.cases || []), ...lost].sort((x, y) => (x.at || 0) - (y.at || 0)).slice(-20); if (lost.some((c) => c.status === "abierto")) data.handoff = true; } }
  }
  const keepD = (arrNew, arrOld) => { const old = new Map((arrOld || []).map((r) => [String(r.at), r])); for (const r of arrNew || []) { const o = old.get(String(r.at)); if (o && o.d && !r.d) r.d = o.d; } };
  if (prev.exists && ((s[2] === "invoices" && s.length === 4) || (s[0] === "billing" && s.length === 2))) keepD(data.reminders, prev.data.reminders);
  const keepBill = s[0] === "tenants" && s.length === 2 && !isSys(u) && prev.exists && !(u.staff && TEST_BILL());
  const version = keepBill ? await db.setDocKeep(path, data, ["paidUntil", "trialUntil", "paidOnce", "lastPay", "credit", "sedes", "sedesPeak", "ia", "interna"]) : await db.setDoc(path, data);
  if (s[0] === "tenants" && s[2] === "sedes") await syncSedes(s[1]);
  for (const h of hooks) { try { await h({ path, data, prev: prev.exists ? prev.data : null, user: u }); } catch (e) { console.error("hook", e.message); } }
  return version;
}

function router() {
  const r = require("./async").proteger(express.Router());
  r.get("/doc", async (req, res) => {
    const p = String(req.query.path || "");
    if (!db.validPath(p, true)) return res.status(400).json({ error: "Ruta inválida", code: "invalid_argument" });
    if (!canRead(req.user, p)) return res.json({ exists: false });
    const mv = db.mem.doc.get(p);
    if (req.query.v && mv && String(req.query.v) === String(mv)) return res.json({ same: true, v: mv });
    const d = await db.getDoc(p);
    d.v = d.exists ? d.version + ":" + d.updatedAt : "del"; db.mem.doc.set(p, d.v);
    if (d.exists && !req.user.staff && ["billing", "tickets", "boldpagos"].includes(seg(p)[0]) && d.data.tid !== req.user.tid) return res.json({ exists: false, v: "x" });
    res.json(d);
  });
  r.put("/doc", async (req, res) => {
    const { path, data } = req.body || {};
    if (!db.validPath(path, true) || typeof data !== "object" || Array.isArray(data)) return res.status(400).json({ error: "Datos inválidos", code: "invalid_argument" });
    if (JSON.stringify(data).length > 262144) return res.status(400).json({ error: "Documento muy grande", code: "invalid_argument" });
    if (!canWrite(req.user, path, data)) return res.status(403).json({ error: "No tiene permiso para guardar esto.", code: "invalid_argument" });
    try { res.json({ version: await guardedWrite(req.user, path, data) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.status === 403 ? "invalid_argument" : "unavailable" }); }
  });
  r.delete("/doc", async (req, res) => {
    const p = String(req.query.path || "");
    if (!db.validPath(p, true) || !canWrite(req.user, p)) return res.status(403).json({ error: "No permitido", code: "invalid_argument" });
    if (!req.user.staff && seg(p)[0] === "tenants" && seg(p).length === 2) return res.status(403).json({ error: "No permitido", code: "invalid_argument" });
    if (!req.user.staff && seg(p)[2] === "leads" && !ADMIN.includes(req.user.role)) return res.status(403).json({ error: "Solo el administrador puede eliminar prospectos.", code: "invalid_argument" });
    await db.delDoc(p); const sp = seg(p); if (sp[0] === "tenants" && sp[2] === "sedes") await syncSedes(sp[1]); res.json({ ok: true });
  });
  r.get("/col", async (req, res) => {
    const p = String(req.query.path || "");
    if (!db.validPath(p, false)) return res.status(400).json({ error: "Ruta inválida", code: "invalid_argument" });
    if (!canRead(req.user, p)) return res.json({ rev: "0", docs: [] });
    let rev = db.mem.col.get(p);
    if (req.query.rev && rev && req.query.rev === rev) return res.json({ same: true, rev });
    const list = await db.listCol(p);
    if (!rev) { db.bumpCol(p); rev = db.mem.col.get(p); }
    res.json({ rev, docs: filterList(req.user, p, list) });
  });
  r.post("/acquire", async (req, res) => {
    const { path, holder, ttlMs } = req.body || {};
    if (!db.validPath(path, true) || !canWrite(req.user, path)) return res.status(403).json({ acquired: false });
    res.json(await db.acquire(path, String(holder || req.user.id), ttlMs));
  });
  return r;
}

module.exports = { SYSTEM, router, onWrite, guardedWrite };
