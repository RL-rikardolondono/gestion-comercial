// Cambio de plan desde la app (lo hace el administrador de la empresa, sin escribirle a SkyNet Genesis).
// - En prueba, sin pagos todavía, cerrada por pago o empresa interna: el plan cambia de inmediato y la próxima
//   mensualidad sale con el plan nuevo.
// - Subir de plan con el mes ya pagado: se paga con Bold solo la diferencia por los días que faltan del periodo
//   pagado (redondeada a miles); al confirmarse el pago, el plan cambia. Si la diferencia es menor de $1.000, cambia gratis.
// - Bajar de plan con el mes ya pagado: sigue con su plan hasta el fin de lo pagado y desde ahí paga el plan nuevo
//   (no se devuelve dinero, no se pierde lo pagado).
const db = require("./db");
const cobro = require("./cobro");
const mant = require("./mantenimiento");
const LABEL = { basico: "Básico", pro: "Profesional", empresarial: "Empresarial" };
const ORDEN = { basico: 1, pro: 2, empresarial: 3 };
const DAY = 864e5;

const diasEntre = (a, b) => Math.max(0, Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY));
// Lo que se paga por subir: (precio nuevo − precio actual) × días que faltan del periodo pagado / 30, en miles
async function diferencia(t, tid, nuevo) {
  const hoy = cobro.HOY(), hasta = cobro.pagadoHasta(t);
  const dias = diasEntre(hoy, hasta) + 1; // todos los días ya pagados con el plan anterior (aunque haya pagado meses por adelantado)
  const ahora = await mant.feeOf(t, tid), luego = await mant.feeOf({ ...t, plan: nuevo }, tid);
  const dif = Math.max(0, luego - ahora) * dias / 30;
  return { dias, ahora, luego, dif: Math.ceil(dif / 1000) * 1000, hasta };
}
function modo(t) {
  const hoy = cobro.HOY();
  if (t.interna) return "libre";
  if (cobro.enPrueba(t, hoy) || !t.paidOnce) return "libre"; // en prueba o sin haber pagado nunca
  if (cobro.pagadoHasta(t) < hoy) return cobro.cerrada(t) ? "libre" : "debe"; // cerrada: el próximo pago ya es con el plan nuevo
  return "pagado";
}
const MSG_DEBE = "Primero pague la mensualidad de este mes (ya está generada con su plan actual). Apenas quede al día, puede cambiar de plan aquí mismo.";

function routes(app) {
  // Lo que pasaría al cambiar a cada plan (para mostrarlo antes de confirmar)
  app.get("/api/plan/opciones", async (req, res) => {
    const u = req.user; if (u.staff || u.role !== "admin") return res.status(403).json({ error: "Solo el administrador de la empresa cambia el plan." });
    const t = await db.getDoc("tenants/" + u.tid); if (!t.exists) return res.status(404).json({ error: "Empresa no encontrada." });
    const m = modo(t.data), out = {};
    for (const k of Object.keys(ORDEN)) {
      if (k === t.data.plan) continue;
      const o = { plan: k, label: LABEL[k], precio: await mant.feeOf({ ...t.data, plan: k }, u.tid) };
      if (m === "debe") o.bloqueo = MSG_DEBE;
      else if (m === "libre") o.como = "inmediato";
      else if (ORDEN[k] > ORDEN[t.data.plan]) { const d = await diferencia(t.data, u.tid, k); o.como = d.dif >= 1000 ? "pagar" : "inmediato"; o.dif = d.dif; o.dias = d.dias; }
      else { o.como = "proximo"; o.desde = cobro.addD(cobro.pagadoHasta(t.data), 1); }
      out[k] = o;
    }
    res.json({ actual: t.data.plan, pendiente: t.data.planNext ? { plan: t.data.planNext, desde: t.data.planNextDesde } : null, opciones: out });
  });

  app.post("/api/plan/cambiar", async (req, res) => {
    const u = req.user; if (u.staff || u.role !== "admin") return res.status(403).json({ error: "Solo el administrador de la empresa cambia el plan." });
    if (u.tid === require("./auth").DEMO_TID) return res.status(400).json({ error: "En la demostración no se cambia el plan." });
    const nuevo = String(req.body?.plan || ""); if (!ORDEN[nuevo]) return res.status(400).json({ error: "Ese plan no existe." });
    const tid = u.tid, t = await db.getDoc("tenants/" + tid); if (!t.exists) return res.status(404).json({ error: "Empresa no encontrada." });
    // Cancelar un cambio programado (volver a su plan actual)
    if (nuevo === t.data.plan) {
      if (!t.data.planNext) return res.status(400).json({ error: "Ese ya es su plan." });
      await db.patchDoc("tenants/" + tid, { planNext: null, planNextDesde: null }); return res.json({ ok: true, cancelado: true });
    }
    const m = modo(t.data), log = { at: Date.now(), by: u.id, de: t.data.plan, a: nuevo };
    if (m === "debe") return res.status(400).json({ error: MSG_DEBE });
    if (m === "libre") {
      await db.patchDoc("tenants/" + tid, { plan: nuevo, planNext: null, planNextDesde: null, planLog: [...(t.data.planLog || []), { ...log, como: "inmediato" }].slice(-20) });
      return res.json({ ok: true, aplicado: true, plan: nuevo });
    }
    if (ORDEN[nuevo] < ORDEN[t.data.plan]) {
      const desde = cobro.addD(cobro.pagadoHasta(t.data), 1);
      await db.patchDoc("tenants/" + tid, { planNext: nuevo, planNextDesde: desde, planLog: [...(t.data.planLog || []), { ...log, como: "programado", desde }].slice(-20) });
      return res.json({ ok: true, programado: true, plan: nuevo, desde });
    }
    const d = await diferencia(t.data, tid, nuevo);
    if (d.dif < 1000) {
      await db.patchDoc("tenants/" + tid, { plan: nuevo, planNext: null, planNextDesde: null, planLog: [...(t.data.planLog || []), { ...log, como: "inmediato" }].slice(-20) });
      return res.json({ ok: true, aplicado: true, plan: nuevo });
    }
    // Subir con el mes pagado: se pide la firma del pago de la diferencia; el plan cambia cuando Bold lo confirme
    const pedido = "pc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await db.setDoc("planpend/" + pedido, { tid, de: t.data.plan, a: nuevo, valor: d.dif, dias: d.dias, hasta: d.hasta, at: Date.now(), by: u.id, estado: "pendiente" });
    try { res.json({ pagar: true, valor: d.dif, dias: d.dias, ...(await require("./bold").firmar(`agente-ia:paq_dif-x${d.dif / 1000}`, `${tid}__${pedido}`, d.dif)) }); }
    catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });
}

// Al confirmarse el pago de la diferencia (desde mantenimiento.applyBold)
async function aplicarDiferencia(o, tid, pedido) {
  const p = await db.getDoc("planpend/" + pedido);
  if (!p.exists || p.data.tid !== tid) return { revisar: "pago de cambio de plan sin pedido" };
  if (p.data.estado === "aplicado") return { ok: true, repetido: true };
  if ((Number(o.valor) || 0) < p.data.valor) return { revisar: "el valor no cubre la diferencia del cambio de plan" };
  const t = await db.getDoc("tenants/" + tid); if (!t.exists) return { revisar: "empresa no encontrada" };
  // El pedido solo vale para la situación en que se calculó: mismo plan de partida, mismo «Pagado hasta» y del mismo día
  // (si no, un pedido viejo y barato serviría para tener el plan alto un mes entero)
  if (t.data.plan !== p.data.de || cobro.pagadoHasta(t.data) !== p.data.hasta || Date.now() - p.data.at > 24 * 3600e3)
    return { revisar: "pedido de cambio de plan vencido (cambió el plan, lo pagado o pasó más de un día): devolver o aplicar a mano" };
  await db.patchDoc("tenants/" + tid, { plan: p.data.a, planNext: null, planNextDesde: null, planLog: [...(t.data.planLog || []), { at: Date.now(), de: t.data.plan, a: p.data.a, como: "pagado", pago: String(o.pago_id), valor: Number(o.valor) || 0 }].slice(-20) });
  await db.setDoc("planpend/" + pedido, { ...p.data, estado: "aplicado", pago: String(o.pago_id), aplicadoAt: Date.now() });
  return { ok: true, plan: p.data.a, label: LABEL[p.data.a] };
}

// Bajadas programadas: cuando termina lo pagado, el plan cambia solo (lo llama el mantenimiento diario y el pago)
async function aplicarProgramados() {
  const hoy = cobro.HOY();
  for (const x of await db.listCol("tenants")) {
    const t = x.data; if (!t.planNext || !t.planNextDesde || hoy < t.planNextDesde) continue;
    await db.patchDoc("tenants/" + x.id, { plan: t.planNext, planNext: null, planNextDesde: null, planLog: [...(t.planLog || []), { at: Date.now(), de: t.plan, a: t.planNext, como: "aplicado al terminar lo pagado" }].slice(-20) });
  }
}
module.exports = { routes, aplicarDiferencia, aplicarProgramados, diferencia, modo };
