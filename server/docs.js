// API del almacén de documentos con reglas de acceso por empresa y por rol.
const express = require("express");
const db = require("./db");

const ADMIN = ["admin"], MANAGERS = ["admin", "supervisor"];
const seg = (p) => p.split("/");

// ¿Puede leer esta ruta (doc o colección)?
function canRead(u, path) {
  if (u.staff) return true;
  const s = seg(path);
  if (s[0] === "tenants") return s.length === 1 || s[1] === u.tid;     // la colección se filtra después
  if (s[0] === "platform") return s[1] === "settings" || s.length === 1;
  if (s[0] === "staff") return true;                                     // solo nombres, sin secretos
  if (s[0] === "billing" || s[0] === "tickets") return true;             // se filtra por tid
  return false;
}
// ¿Puede escribir? data = documento nuevo (para validar tid en billing/tickets)
function canWrite(u, path, data) {
  if (u.staff) return true;
  const s = seg(path);
  if (s[0] === "tickets") return !data || data.tid === u.tid;
  if (s[0] !== "tenants" || s[1] !== u.tid) return false;
  if (s.length === 2) return true;                                       // campos protegidos se conservan abajo
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
  if (colPath === "billing" || colPath === "tickets") return docs.filter((d) => d.data && d.data.tid === u.tid);
  return docs;
};

// Ganchos al guardar (se registran desde index.js)
const hooks = [];
const onWrite = (fn) => hooks.push(fn);

async function guardedWrite(u, path, data) {
  const s = seg(path);
  const prev = await db.getDoc(path);
  // Empresa: solo el proveedor cambia plan, estado y datos de facturación
  if (s[0] === "tenants" && s.length === 2 && !u.staff) {
    if (!prev.exists) throw Object.assign(new Error("No permitido"), { status: 403 });
    const keep = ["plan", "status", "nit", "razon", "feMail", "name", "createdAt", "paidUntil"];
    for (const k of keep) data[k] = prev.data[k];
  }
  // Configuración: solo el administrador; los demás solo pueden mover el turno del reparto
  if (s[2] === "config" && !u.staff && !ADMIN.includes(u.role)) {
    if (!prev.exists) throw Object.assign(new Error("No permitido"), { status: 403 });
    const a = JSON.parse(JSON.stringify(prev.data)), b = JSON.parse(JSON.stringify(data));
    if (a.biz) delete a.biz.rr; if (b.biz) delete b.biz.rr;
    if (JSON.stringify(a) !== JSON.stringify(b)) throw Object.assign(new Error("Solo el administrador puede cambiar la configuración."), { status: 403 });
  }
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
    const lastIn = [...data.messages].reverse().find((m) => m.from === "cliente");
    if (lastIn && lastIn.at > (data.lastInboundAt || 0)) { data.lastInboundAt = lastIn.at; const lastAny = data.messages[data.messages.length - 1]; if (lastAny.from === "cliente") data.awaiting = "empresa"; }
  }
  const keepD = (arrNew, arrOld) => { const old = new Map((arrOld || []).map((r) => [String(r.at), r])); for (const r of arrNew || []) { const o = old.get(String(r.at)); if (o && o.d && !r.d) r.d = o.d; } };
  if (prev.exists && ((s[2] === "invoices" && s.length === 4) || (s[0] === "billing" && s.length === 2))) keepD(data.reminders, prev.data.reminders);
  const version = await db.setDoc(path, data);
  for (const h of hooks) { try { await h({ path, data, prev: prev.exists ? prev.data : null, user: u }); } catch (e) { console.error("hook", e.message); } }
  return version;
}

function router() {
  const r = express.Router();
  r.get("/doc", async (req, res) => {
    const p = String(req.query.path || "");
    if (!db.validPath(p, true)) return res.status(400).json({ error: "Ruta inválida", code: "invalid_argument" });
    if (!canRead(req.user, p)) return res.json({ exists: false });
    const mv = db.mem.doc.get(p);
    if (req.query.v && mv && String(req.query.v) === String(mv)) return res.json({ same: true, v: mv });
    const d = await db.getDoc(p);
    d.v = d.exists ? d.version + ":" + d.updatedAt : "del"; db.mem.doc.set(p, d.v);
    if (d.exists && !req.user.staff && (seg(p)[0] === "billing" || seg(p)[0] === "tickets") && d.data.tid !== req.user.tid) return res.json({ exists: false });
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
    await db.delDoc(p); res.json({ ok: true });
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

module.exports = { router, onWrite, guardedWrite };
