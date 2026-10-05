// Regla de cobro de SkyNet Genesis para las empresas clientes.
// "Pagado hasta" (paidUntil, por defecto el fin del mes en que se creó la empresa).
// Sin pago: días 1 a 4 activa; desde el día 5, aviso con cuenta regresiva; el día 10 se cierra el acceso.
const HOY = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const addD = (f, n) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const finMes = (f) => { const d = new Date(f.slice(0, 7) + "-01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };
function pagadoHasta(t) { if (t && t.paidUntil) return String(t.paidUntil).slice(0, 10); const c = t && t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : HOY(); return finMes(c); }
function estado(t, hoy = HOY()) {
  const ph = pagadoHasta(t);
  if (ph >= hoy) return { k: "activa", hasta: ph };
  const d10 = addD(ph, 10);
  if (hoy >= d10) return { k: "cerrada", hasta: ph, cierre: d10 };
  if (hoy >= addD(ph, 5)) return { k: "aviso", hasta: ph, cierre: d10, dias: Math.round((Date.parse(d10) - Date.parse(hoy)) / 864e5) };
  return { k: "activa", hasta: ph, pendiente: true };
}
const cerrada = (t) => !!t && estado(t).k === "cerrada";
const MSG = "El acceso de su empresa está cerrado por falta de pago de la mensualidad. Pague con Bold o escriba a SkyNet Genesis (WhatsApp 304 437 5758) para reactivarlo.";
module.exports = { HOY, addD, finMes, pagadoHasta, estado, cerrada, MSG };
