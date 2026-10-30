// Regla de cobro de SkyNet Genesis para las empresas clientes (directiva del 17 y 19 oct 2026).
// - "Pagado hasta" (paidUntil) por empresa, siempre a fin de mes. Sin mora, sin aviso previo ni cuenta regresiva.
// - Si no ha pagado, el día 5 del mes siguiente se CIERRA el acceso (el servidor lo aplica).
// - Prueba gratis de 15 días (trialUntil), sin renovación: al terminar sin pago se cierra.
// - Solo se paga con Bold de SkyNet Genesis, mes a mes. Primer pago: "resto del mes gratis".
const HOY = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const addD = (f, n) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const finMes = (f) => { const d = new Date(f.slice(0, 7) + "-01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };
const sigMes = (f) => { const d = new Date(f.slice(0, 7) + "-01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
const diaDe = (f) => Number(String(f).slice(8, 10));
const enPrueba = (t, hoy = HOY()) => !!(t && !t.interna && t.trialUntil && !t.paidOnce && String(t.trialUntil).slice(0, 10) >= hoy);
function pagadoHasta(t) {
  if (t && t.paidUntil) return String(t.paidUntil).slice(0, 10);
  if (t && t.trialUntil) return String(t.trialUntil).slice(0, 10);
  const c = t && t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : HOY();
  return finMes(c);
}
function estado(t, hoy = HOY()) {
  if (t && t.demo) return { k: "activa", hasta: "2099-12-31" };
  // Empresa interna de SkyNet Genesis (POLIANDES, Clínica Reina Elizabeth, Anglocolombiano, SkyNet Genesis): activa siempre, sin prueba ni cobros
  if (t && t.interna) return { k: "activa", hasta: "2099-12-31", interna: true };
  const ph = pagadoHasta(t);
  if (enPrueba(t, hoy)) return { k: "prueba", hasta: ph, dias: Math.round((Date.parse(ph) - Date.parse(hoy)) / 864e5) + 1 };
  if (ph >= hoy) return { k: "activa", hasta: ph };
  // Prueba vencida sin pago: se cierra de inmediato (la prueba no se renueva)
  if (t && t.trialUntil && !t.paidOnce && !t.paidUntil) return { k: "cerrada", hasta: ph, cierre: addD(ph, 1), prueba: true };
  const cierre = addD(ph, 5);
  if (hoy >= cierre) return { k: "cerrada", hasta: ph, cierre };
  return { k: "activa", hasta: ph, pendiente: true, cierre };
}
const cerrada = (t) => !!t && estado(t).k === "cerrada";
// Hasta dónde queda al día con UN pago mensual hecho hoy (lo que dice la pantalla antes de pagar)
function trasPago(t, hoy = HOY()) {
  if (!t || !t.paidOnce) {
    // Primer pago: el primer día pagado es hoy, o el día siguiente al fin de la prueba si todavía está en prueba
    const primer = enPrueba(t, hoy) ? addD(String(t.trialUntil).slice(0, 10), 1) : hoy;
    return diaDe(primer) <= 5 ? finMes(primer) : finMes(sigMes(primer));
  }
  // Pagos siguientes: un mes más; si estuvo cerrada, se paga desde el mes actual (no se acumulan los meses cerrados)
  const ph = pagadoHasta(t), finAnterior = addD(hoy.slice(0, 7) + "-01", -1);
  const base = ph > finAnterior ? ph : finAnterior;
  return finMes(addD(base, 1));
}
const MSG = "El acceso de su empresa está cerrado por falta de pago de la mensualidad. Pague en línea desde esta pantalla o escriba a SkyNet Genesis (WhatsApp 304 437 5758).";
module.exports = { HOY, addD, finMes, sigMes, pagadoHasta, estado, cerrada, enPrueba, trasPago, MSG };
