// Tareas para años de servicio: mensualidades automáticas, confirmación de pagos en el servidor
// y archivo de lo antiguo (para que la app y la base de datos no crezcan sin límite).
const db = require("./db");
const cobro = require("./cobro");
const DAY = 864e5, TZ = -5;
const PRICE = { basic: 190000, pro: 390000, biz: 790000, sede: 150000 };
const PLAN = { basico: { k: "basic", label: "Básico", sedes: 0 }, pro: { k: "pro", label: "Profesional", sedes: 0 }, empresarial: { k: "biz", label: "Empresarial", sedes: 1 } };
const local = (ts) => { const d = new Date(ts + TZ * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; };
const monthKey = (ts) => { const l = local(ts); return `${l.y}-${String(l.m + 1).padStart(2, "0")}`; };
const paidOf = (i) => (i.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
const balOf = (i) => Math.max(0, (Number(i.amount) || 0) - paidOf(i));
const MES = (m) => { const [y, mm] = String(m).split("-"); return mm ? ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][Number(mm) - 1] + " " + y : ""; };
let docs = null; const D = () => (docs || (docs = require("./docs"))); const dw = (p, d) => D().guardedWrite(D().SYSTEM, p, d);

async function settings() { const s = await db.getDoc("platform/settings"); return s.exists ? s.data : {}; }
function fee(t, pricing) { const p = PLAN[t.plan] || PLAN.pro; const extra = p.sedes ? Math.max(0, (Number(t.sedes) || 0) - p.sedes) : 0; return (Number(pricing[p.k]) || 0) + extra * (Number(pricing.sede) || 0); }

/* ---------- mensualidades: se generan solas el día 1 de cada mes ---------- */
async function genMonth(now = Date.now(), force = false) {
  const st = await settings(); const bc = st.billing || {};
  if (bc.autoGen === false && !force) return 0;
  const per = monthKey(now), key = "gen:" + per;
  if (!force && await db.kvGet(key)) return 0;
  const pricing = { ...PRICE, ...(st.pricing || {}) };
  const bills = (await db.listCol("billing")).map((x) => x.data);
  let n = Math.max(0, ...bills.map((b) => Number(String(b.number || "").match(/(\d+)\s*$/)?.[1]) || 0)) + 1, c = 0;
  const [y, m] = per.split("-").map(Number); const dueDay = 4; // último día para pagar: el día 5 sin pago se cierra
  for (const x of await db.listCol("tenants")) {
    const t = x.data; if (t.status !== "activo" || t.demo || t.interna) continue; // las empresas internas no pagan
    if (bills.some((b) => b.tid === x.id && b.period === per && b.kind === "mensualidad")) continue;
    // Si ya pagó este mes por adelantado («Pagado hasta» cubre el mes), no se le cobra de nuevo
    if (cobro.pagadoHasta(t) >= cobro.finMes(per + "-01")) continue;
    if (cobro.enPrueba(t, cobro.HOY()) || (t.trialUntil && !t.paidOnce)) continue; // en prueba (o prueba vencida sin pago) no se generan mensualidades
    const p = PLAN[t.plan] || PLAN.pro, extra = p.sedes ? Math.max(0, (Number(t.sedes) || 0) - p.sedes) : 0;
    const amount = fee({ ...t, sedes: await sedesOf(x.id, t) }, pricing), cr = 0; // sin saldos a favor: se paga mes a mes
    await dw("billing/bl" + per.replace("-", "") + x.id, { kind: "mensualidad", number: "MEN-" + String(n++).padStart(4, "0"), tid: x.id, tenantName: t.name, period: per, plan: t.plan,
      concept: `Mensualidad plan ${p.label}${extra ? ` + ${extra} sede${extra > 1 ? "s" : ""} adicional${extra > 1 ? "es" : ""}` : ""}`, amount,
      issuedAt: now, dueAt: Date.UTC(y, m - 1, dueDay, 17), payments: cr > 0 ? [{ amount: cr, at: now, method: "Saldo a favor", note: "Abono de pagos anteriores" }] : [], reminders: [], sent: [], createdAt: now, auto: true });
    c++;
  }
  await db.kvSet(key, now);
  return c;
}

/* ---------- pago aprobado por Bold (lo confirma el sistema central de SkyNet Genesis) ---------- */
// plan: agente-ia:<basico|pro|empresarial> o agente-ia:paq_empresarial_sede-xN (sedes adicionales); siempre 1 mes.
const PLAN_KEY = { basico: "basic", pro: "pro", empresarial: "biz" };
function parsePlan(plan) {
  const m = String(plan || "").match(/^agente-ia:(.+)$/); if (!m) return null;
  if (m[1] === "prueba") return { prueba: true };
  if (require("./ia").PACKS[m[1]]) return { ia: m[1] }; // paquete de inteligencia artificial (Market)
  if (PLAN_KEY[m[1]]) return { plan: m[1], sedes: 0 };
  const pq = m[1].match(/^paq_(basico|pro|empresarial)(?:_sede-x(\d{1,3}))?$/); if (!pq) return null;
  return { plan: pq[1], sedes: Number(pq[2] || 0) };
}
// Lo que vale un mes para esta empresa (con sus sedes adicionales)
// Se cobra el mayor número de sedes del mes en curso y, si todavía no ha pagado este mes, también del mes anterior
// (borrar sedes el último día del mes y pagar el 1 no baja el precio)
async function sedesOf(tid, t) {
  const n = (await db.listCol(`tenants/${tid}/sedes`)).length; const m = cobro.HOY().slice(0, 7), pk = (t && t.sedesPeak) || {};
  const prevM = cobro.addD(m + "-01", -1).slice(0, 7), pagoEsteMes = cobro.pagadoHasta(t || {}) >= cobro.finMes(m + "-01");
  const ant = pk.m === prevM ? pk.n : pk.prev && pk.prev.m === prevM ? pk.prev.n : 0;
  return Math.max(n, pk.m === m ? pk.n || 0 : 0, pagoEsteMes ? 0 : ant || 0);
}
async function feeOf(t, tid) {
  const st = await settings(); const sedes = tid ? await sedesOf(tid, t) : Number(t.sedes) || 0;
  return fee({ ...t, sedes }, { ...PRICE, ...(st.pricing || {}) });
}
// Reserva atómica: dos avisos simultáneos (o el aviso y el regreso de la pasarela) no aplican el mismo pago dos veces
async function reservar(k) { const r = await db.pool.query("INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO NOTHING RETURNING k", [k, String(Date.now())]); return r.rowCount === 1; }
let cola = Promise.resolve(); // los pagos se aplican uno a la vez (un solo servidor)
function applyBold(o) { const run = cola.then(() => applyBold1(o)); cola = run.catch(() => {}); return run; }
async function applyBold1(o) {
  if (!o.pago_id) throw Object.assign(new Error("Falta el identificador del pago."), { status: 400 });
  const ref = String(o.referencia || "");
  const ya = await db.kvGet("bold:" + o.pago_id) || (ref && await db.kvGet("boldref:" + ref));
  if (ya) { const rec = await db.getDoc("boldpagos/" + safeId(o.pago_id)); return rec.exists ? { ok: true, repetido: true, paidUntil: rec.data.paidUntil } : { ok: true, repetido: true, revisar: true }; }
  if (!(await reservar("bold:" + o.pago_id))) return { ok: true, repetido: true };
  if (ref && !(await reservar("boldref:" + ref))) { await db.pool.query("DELETE FROM kv WHERE k=$1", ["bold:" + o.pago_id]); return { ok: true, repetido: true }; }
  // Si algo falla después de reservar, se libera la reserva para que el sistema central lo reintente (no se pierde el pago)
  const st = { escrito: false };
  try { return await aplicarReservado(o, ref, st); }
  catch (e) {
    // Antes de cambiar la empresa se libera la reserva (el sistema central reintenta); después NO, para no sumar otro mes
    if (!st.escrito) await db.pool.query("DELETE FROM kv WHERE k = ANY($1)", [["bold:" + o.pago_id, "boldref:" + ref]]);
    else await revisar({ ...o }, "se aplicó a la empresa pero falló el recibo: revisar el recibo").catch(() => {});
    throw e;
  }
}
async function liberar(o) { await db.pool.query("DELETE FROM kv WHERE k = ANY($1)", [["bold:" + o.pago_id, "boldref:" + String(o.referencia || "")]]); }
async function aplicarReservado(o, ref, st = {}) {
  const pp = parsePlan(o.plan);
  if (!pp) { await revisar(o, "plan desconocido"); return { ok: true, revisar: true }; }
  if (pp.prueba) { await db.setDoc("boldpagos/" + safeId(o.pago_id), { ...o, prueba: true, at: Date.now() }); return { ok: true, prueba: true }; }
  const tid = String(o.empresa || "").split("__")[0];
  const t = await db.getDoc("tenants/" + tid);
  if (!t.exists || t.data.demo) { await revisar(o, "empresa no encontrada"); return { ok: true, revisar: true }; }
  // Paquete de IA: suma respuestas y tope de gasto por 30 días; no toca «Pagado hasta»
  if (pp.ia) {
    const IA = require("./ia"), pk = IA.PACKS[pp.ia];
    if ((Number(o.valor) || 0) < pk.price) { await revisar({ ...o, tid, esperado: pk.price }, "el valor no cubre el paquete de IA"); return { ok: true, revisar: true }; }
    const nia = IA.sumarPaquete(t.data, pp.ia, o.valor);
    await db.patchDoc("tenants/" + tid, { ia: nia }); st.escrito = true;
    const rec = { tid, tenantName: t.data.name, pago_id: String(o.pago_id), referencia: ref, plan: o.plan, valor: Number(o.valor) || 0, at: Date.now(), concepto: "Paquete de IA: " + pk.label, iaHasta: nia.until, receiptN: Number((await db.kvGet("boldrecibo")) || 0) + 1 };
    await db.kvSet("boldrecibo", rec.receiptN); await db.setDoc("boldpagos/" + safeId(o.pago_id), rec);
    return { ok: true, ia: true, iaHasta: nia.until, left: nia.left };
  }
  const esperado = await feeOf(t.data, tid);
  if ((Number(o.valor) || 0) < esperado) { await revisar({ ...o, tid, esperado }, "el valor no cubre la mensualidad del plan de la empresa"); return { ok: true, revisar: true }; }
  if (pp.plan !== t.data.plan) { await revisar({ ...o, tid, esperado }, "el plan pagado no es el plan de la empresa"); return { ok: true, revisar: true }; }
  const hoy = cobro.HOY(), nuevo = cobro.trasPago(t.data, hoy), now = Date.now();
  // Solo las mensualidades de los meses cubiertos quedan pagadas (hasta el valor recibido); otros cobros no se tocan
  let queda = Number(o.valor) || 0;
  const bills = (await db.listCol("billing")).map((x) => ({ id: x.id, b: x.data })).filter(({ b }) => b.tid === tid && b.kind === "mensualidad" && balOf(b) > 0 && !b.voided).sort((a, b) => String(a.b.period).localeCompare(String(b.b.period)));
  for (const { id, b } of bills) {
    if (b.period && b.period + "-01" > nuevo) continue;
    // Meses en que estuvo cerrada por pago: no se cobran (se reconecta pagando desde el mes en curso)
    if (b.period && b.period < hoy.slice(0, 7) && t.data.paidOnce && cobro.pagadoHasta(t.data) < b.period + "-01") {
      await dw("billing/" + id, { ...b, originalAmount: b.amount, amount: paidOf(b), voided: true, voidNote: "Mes sin servicio (cerrada por pago): no se cobra" }); continue; }
    const a = Math.min(queda, balOf(b)); if (a <= 0) continue; queda -= a;
    await dw("billing/" + id, { ...b, payments: [...(b.payments || []), { amount: a, at: now, method: "Bold", note: "Pago " + o.pago_id }] });
  }
  const nt = { ...t.data, paidUntil: nuevo, paidOnce: true, lastPay: { at: now, valor: Number(o.valor) || 0, ref, pago: String(o.pago_id) } }; // una empresa suspendida a propósito sigue suspendida
  await db.patchDoc("tenants/" + tid, { paidUntil: nt.paidUntil, paidOnce: true, lastPay: nt.lastPay }); st.escrito = true; /* solo estos campos: no pisa los créditos de IA ni otros cambios */
  const rec = { tid, tenantName: t.data.name, pago_id: String(o.pago_id), referencia: ref, plan: o.plan, valor: Number(o.valor) || 0, at: now, paidUntil: nuevo, receiptN: Number((await db.kvGet("boldrecibo")) || 0) + 1 };
  await db.kvSet("boldrecibo", rec.receiptN);
  await db.setDoc("boldpagos/" + safeId(o.pago_id), rec);
  return { ok: true, paidUntil: nuevo };
}
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "x" + Date.now();
// Un pago que no cuadra no se aplica solo: queda para que el Superadministrador lo revise (nunca se pierde)
async function revisar(o, motivo) {
  await db.setDoc("boldrevisar/" + safeId(o.pago_id || Date.now()), { ...o, motivo, at: Date.now(), estado: "pendiente" });
  const to = process.env.NOTIFY_EMAIL || "contacto@skynetgenesis.com";
  if (to) { try { await require("./channels").sendEmail(to, "Agente-IA · pago de Bold para revisar", `Llegó un pago de Bold que no se pudo aplicar solo (${motivo}).\nEmpresa: ${o.empresa || "—"} · Plan: ${o.plan || "—"} · Valor: $${(Number(o.valor) || 0).toLocaleString("es-CO")} · Pago: ${o.pago_id || "—"}\nRevíselo en Agente-IA › Mensualidades.`, { sistema: true }); } catch {} }
}

async function resetDemo(now) {
  const tid = require("./auth").DEMO_TID; const t = await db.getDoc("tenants/" + tid); if (!t.exists) return;
  for (const col of ["leads", "invoices", "appts", "audit", "archive", "invarchive"]) for (const x of await db.listCol(`tenants/${tid}/${col}`)) if (!x.data.seed && !x.data.demo && now - (x.data.createdAt || x.data.at || 0) > 6 * 3600e3) await db.delDoc(`tenants/${tid}/${col}/${x.id}`);
  const c = await db.getDoc(`tenants/${tid}/config/connections`); if (c.exists && c.data.webhook) { const d = { ...c.data }; delete d.webhook; await db.setDoc(`tenants/${tid}/config/connections`, d); }
}
/* ---------- archivo: lo antiguo sale de la vista diaria pero no se pierde ---------- */
const ACTIVE_DAYS = 180, CLOSED_DAYS = 90;
async function archiveTenant(tid, now = Date.now()) {
  let n = 0;
  // Clientes ganados que se archivaron con la regla anterior vuelven a la lista: SofIA los sigue acompañando
  const back = await db.pool.query("SELECT path, data FROM docs WHERE parent=$1 AND data->>'stage' = 'ganado' LIMIT 200", [`tenants/${tid}/archive`]);
  for (const r of back.rows) { const id = r.path.split("/").pop(), l = { ...r.data }; delete l.archivedAt; delete l.p10; await db.setDoc(`tenants/${tid}/leads/${id}`, { ...l, updatedAt: now }); await db.delDoc(r.path); }
  for (const x of await db.listCol(`tenants/${tid}/leads`)) {
    const l = x.data, last = Math.max(l.updatedAt || 0, l.lastInboundAt || 0, l.lastOutboundAt || 0, l.createdAt || 0);
    // Los clientes ganados no se archivan: SofIA los sigue acompañando (posventa y fidelización)
    if (l.stage === "ganado") { if ((l.messages || []).length > 40 && now - last > ACTIVE_DAYS * DAY) await db.setDoc(`tenants/${tid}/leads/${x.id}`, { ...l, messages: l.messages.slice(-40) }); continue; }
    if (now - last < (l.stage === "perdido" ? CLOSED_DAYS : ACTIVE_DAYS) * DAY) continue;
    await db.setDoc(`tenants/${tid}/archive/${x.id}`, { ...l, messages: (l.messages || []).slice(-20), archivedAt: now, p10: String(l.phone || "").replace(/\D/g, "").slice(-10) });
    await db.delDoc(`tenants/${tid}/leads/${x.id}`); n++;
  }
  for (const x of await db.listCol(`tenants/${tid}/invoices`)) {
    const i = x.data; if (balOf(i) > 0 || now - Math.max(i.updatedAt || 0, i.dueAt || 0) < 365 * DAY) continue;
    await db.setDoc(`tenants/${tid}/invarchive/${x.id}`, { ...i, reminders: (i.reminders || []).slice(-5), archivedAt: now }); await db.delDoc(`tenants/${tid}/invoices/${x.id}`); n++;
  }
  for (const x of await db.listCol(`tenants/${tid}/appts`)) if ((x.data.at || 0) < now - ACTIVE_DAYS * DAY) { await db.delDoc(`tenants/${tid}/appts/${x.id}`); n++; }
  for (const x of await db.listCol(`tenants/${tid}/audit`)) { const d = Date.parse(x.id); if (d && d < now - 90 * DAY) { await db.delDoc(`tenants/${tid}/audit/${x.id}`); n++; } }
  return n;
}
// Prueba gratis: correo diario (desde las 8 a. m.) al administrador con los días que le quedan (directiva: 15 días, sin renovación)
async function trialMorning(now = Date.now()) {
  const h = new Date(now + TZ * 3600e3).getUTCHours(); if (h < 8) return;
  const k = "trialmail:" + new Date(now + TZ * 3600e3).toISOString().slice(0, 10);
  if (await db.kvGet(k)) return; await db.kvSet(k, now);
  await trialMails(now);
}
async function trialMails(now) {
  const ch = require("./channels"); if (!ch.mailOn()) return;
  const hoy = cobro.HOY();
  for (const x of await db.listCol("tenants")) {
    const t = x.data; if (t.demo || t.status === "suspendido") continue;
    const e = cobro.estado(t, hoy);
    if (e.k !== "prueba" && !(e.prueba && e.cierre === hoy)) continue;
    const users = (await db.listCol(`tenants/${x.id}/users`)).map((u) => u.data).filter((u) => u.role === "admin" && u.active !== false && u.email);
    const txt = e.k === "prueba"
      ? `Hola, ${t.name}. ${e.dias === 1 ? "Hoy es el último día" : `Le quedan ${e.dias} días`} de la prueba gratis de Agente-IA (termina el ${e.hasta}).\nPara seguir sin interrupciones, entre a la app y pague la mensualidad en línea (tarjeta, PSE, Nequi o llave Bre-B). Su primera mensualidad empieza a contar al terminar la prueba, así que no pierde ningún día.`
      : `Hola, ${t.name}. La prueba gratis de Agente-IA terminó y el acceso quedó cerrado. Para reactivarlo, entre a la app y pague la mensualidad en línea: se reabre en el momento en que Bold confirma el pago.`;
    for (const u of users) { try { await ch.sendEmail(u.email, e.k === "prueba" ? `Agente-IA · ${e.dias === 1 ? "último día" : e.dias + " días"} de prueba gratis` : "Agente-IA · terminó su prueba gratis", txt, { sistema: true }); } catch {} }
  }
}
async function daily(now = Date.now()) {
  const k = "daily:" + new Date(now + TZ * 3600e3).toISOString().slice(0, 10);
  if (await db.kvGet(k)) return null; await db.kvSet(k, now);
  let archived = 0;
  for (const t of await db.listCol("tenants")) archived += await archiveTenant(t.id, now);
  // Demostración pública: cada día se borra lo que escribieron los visitantes (no se acumulan datos ajenos)
  try { await resetDemo(now); } catch (e) { console.error("demo", e.message); }
  // Marcas de control viejas (mensajes ya recibidos, resúmenes enviados): se guardan 30 días
  const r = await db.pool.query("DELETE FROM kv WHERE (k LIKE 'in:%' OR k LIKE 'digest:%' OR k LIKE 'daily:%') AND v ~ '^[0-9]+$' AND v::bigint < $1", [now - 30 * DAY]);
  await db.pool.query("DELETE FROM leases WHERE expires < $1", [now - DAY]);
  await db.pool.query("DELETE FROM kv WHERE k LIKE 'mail:%' AND right(k, 10) < $1", [new Date(now - 3 * DAY + TZ * 3600e3).toISOString().slice(0, 10)]); // contadores del cupo de correo
  // Recibos de Bold de hace más de 2 años: solo queda el registro de los últimos 24 meses
  for (const x of await db.listCol("boldpagos")) if ((x.data.at || 0) < now - 730 * DAY) await db.delDoc("boldpagos/" + x.id);
  for (const x of await db.listCol("payreports")) await db.delDoc("payreports/" + x.id); // pagos por llave (sistema anterior): ya no se usan

  return { archived, kv: r.rowCount };
}
// Un cliente que vuelve a escribir después de archivado recupera su historial
async function findArchived(tid, key, phone) {
  const dig = String(phone || "").replace(/\D/g, "").slice(-10);
  const r = await db.pool.query(
    `SELECT path, data FROM docs WHERE parent=$1 AND (data->>'extKey' = $2 OR (length($3) >= 7 AND data->>'p10' = $3)) ORDER BY (data->>'archivedAt') DESC NULLS LAST LIMIT 1`,
    [`tenants/${tid}/archive`, key || "-sin-clave-", dig]);
  if (!r.rows[0]) return null;
  const id = r.rows[0].path.split("/").pop(); const l = { ...r.rows[0].data }; delete l.archivedAt; delete l.p10;
  await db.delDoc(r.rows[0].path);
  return { ...l, id };
}
module.exports = { liberar, trialMorning, genMonth, applyBold, parsePlan, feeOf, sedesOf, archiveTenant, daily, findArchived, monthKey };
