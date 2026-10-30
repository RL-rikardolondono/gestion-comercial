// Posventa y fidelización: SofIA acompaña al cliente después de la compra.
// Felicita en cumpleaños (del cliente y de su familia), celebra el aniversario de la compra y otras fechas,
// hace el plan de posventa, pregunta la satisfacción de vez en cuando y abre un caso de soporte cuando hay un problema.
const DAY = 864e5, TZ = -5;
const pad = (n) => String(n).padStart(2, "0");
const local = (ts) => { const d = new Date(ts + TZ * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), wd: d.getUTCDay() }; };
const dayKey = (ts) => { const l = local(ts); return `${l.y}-${pad(l.m + 1)}-${pad(l.d)}`; };
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const first = (s) => String(s || "").trim().split(/\s+/)[0] || "";

const CARE_DEFAULT = {
  on: true, hourFrom: 9, hourTo: 19,
  bday: { on: true, text: "¡Feliz cumpleaños, {nombre}! Todo el equipo de {empresa} le desea un día maravilloso. 🎉" },
  family: { on: true, text: "Hola {nombre}, hoy está de cumpleaños {familiar}. ¡Muchas felicitaciones de parte de todo el equipo de {empresa}!" },
  anniv: { on: true, text: "Hola {nombre}, hoy cumple {anos} con {empresa}. Gracias por su confianza; aquí seguimos para lo que necesite." },
  dates: { on: true, text: "Hola {nombre}, hoy es una fecha especial: {fecha}. Le enviamos un saludo de parte de {empresa}." },
  steps: [
    { days: 3, text: "Hola {nombre}, ¿cómo le ha ido con {compra}? Si tiene cualquier duda, aquí estamos para ayudarle." },
    { days: 30, text: "Hola {nombre}, ya pasó un mes desde que adquirió {compra}. ¿Todo va bien? Cuéntenos si podemos ayudarle en algo." },
    { days: 180, text: "Hola {nombre}, han pasado seis meses con {compra}. Si necesita una revisión, un mantenimiento o una cita, con gusto se la agendamos." },
    { days: 365, text: "Hola {nombre}, hoy cumple un año con {compra}. Gracias por elegir a {empresa}." }],
  survey: { on: true, days: 120, text: "Hola {nombre}, en {empresa} queremos atenderle cada vez mejor. ¿Cómo calificaría nuestro servicio de 1 a 5? Responda solo con el número." },
  caseText: "Lamentamos el inconveniente, {nombre}. Ya registramos su caso y una persona de {empresa} lo atenderá muy pronto.",
  coldDays: 180, caseDays: 3,
};
function careCfg(config) {
  const c = (config && config.care) || {};
  return { ...CARE_DEFAULT, ...c, bday: { ...CARE_DEFAULT.bday, ...(c.bday || {}) }, family: { ...CARE_DEFAULT.family, ...(c.family || {}) }, anniv: { ...CARE_DEFAULT.anniv, ...(c.anniv || {}) },
    dates: { ...CARE_DEFAULT.dates, ...(c.dates || {}) }, survey: { ...CARE_DEFAULT.survey, ...(c.survey || {}) }, steps: Array.isArray(c.steps) ? c.steps : CARE_DEFAULT.steps };
}
const fill = (t, l, company, extra = {}) => {
  const nm = first(l.name);
  let s = String(t || "");
  s = nm ? s.replaceAll("{nombre}", nm) : s.replace(/,?\s*\{nombre\}/g, "");
  s = s.replaceAll("{empresa}", company || "").replaceAll("{compra}", l.purchase || l.interest || "su compra");
  for (const [k, v] of Object.entries(extra)) s = s.replaceAll("{" + k + "}", v);
  return s.replace(/Hola ,/g, "Hola,").replace(/,\s*([.!?])/g, "$1").replace(/\s+([,.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
};
const md = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date).slice(5) : /^\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : "");

// Qué mensaje le toca hoy a un cliente (máximo uno por día). Devuelve null si nada.
// back: días hacia atrás que se revisan (domingos y festivos no se escribe; el saludo sale el siguiente día hábil)
const stepKey = (s, l) => "s" + (Number(s.days) || 0) + "@" + dayKey(l.wonAt);
const surveyPending = (l, now) => !!l.awaitSurvey && now - (l.lastSurveyAt || l.surveySent || 0) < 7 * DAY;
function careFor(c, l, company, now = Date.now(), back = 0, soloFechas = false) {
  const L = local(now), y = L.y, log = l.careLog || {};
  const leap = (yy) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  // 29 de febrero se celebra el 28 en los años que no son bisiestos
  const lateOf = (m) => { if (!m) return -1; for (let k = 0; k <= back; k++) { const d = local(now - k * DAY), md2 = `${pad(d.m + 1)}-${pad(d.d)}`; if (m === md2 || (m === "02-29" && !leap(d.y) && md2 === "02-28")) return k; } return -1; };
  // Saludo atrasado (domingo, festivo o dos fechas el mismo día): se ajusta el tiempo verbal
  const when = (txt, k) => { if (k <= 0) return txt; const w = k === 1 ? "ayer" : "hace unos días";
    return txt.replace(/\bhoy está/, w + " estuvo").replace(/\bhoy es\b/, w + " fue").replace(/\bhoy cumple\b/, w + " cumplió").replace(/\bhoy\b/, w); };
  back = Math.min(6, back + 2);
  let k;
  if (c.bday.on && (k = lateOf(md(l.birthday))) >= 0 && !log["b" + y]) return { k: "b" + y, text: fill(c.bday.text, l, company) };
  if (c.family.on && l.famOk) for (const f of l.family || []) { const key = "f:" + norm(f.name) + y; if (f.name && (k = lateOf(md(f.bday))) >= 0 && !log[key]) return { k: key, text: when(fill(c.family.text, l, company, { familiar: `${f.rel ? "su " + String(f.rel).trim().toLowerCase() + " " : ""}${f.name}`.trim() }), k) }; }
  const near365 = (s) => Math.abs((Number(s.days) || 0) - 365) <= 10;
  if (c.anniv.on && l.wonAt) { const w = local(l.wonAt), n = y - w.y, key = "a" + y;
    if (n >= 1 && (k = lateOf(`${pad(w.m + 1)}-${pad(w.d)}`)) >= 0 && !log[key]) { const marks = Object.fromEntries(c.steps.filter(near365).map((s) => [stepKey(s, l), 1])); return { k: key, marks, text: when(fill(c.anniv.text, l, company, { anos: n === 1 ? "un año" : n + " años" }), k) }; } }
  if (c.dates.on) for (const d of l.dates || []) { const key = "d:" + norm(d.label) + y; if (d.label && (k = lateOf(md(d.date))) >= 0 && !log[key]) return { k: key, text: when(fill(c.dates.text, l, company, { fecha: d.label }), k) }; }
  if (l.wonAt && !soloFechas) {
    const due = c.steps.filter((s) => !log[stepKey(s, l)] && now >= l.wonAt + (Number(s.days) || 0) * DAY).sort((a, b) => (Number(a.days) || 0) - (Number(b.days) || 0));
    if (due.length) {
      const last = due[due.length - 1], marks = Object.fromEntries(due.map((s) => [stepKey(s, l), 1]));
      // Si el paso ya pasó hace más de una semana (cliente antiguo), se marca sin escribir: el mensaje ya no tendría sentido
      if (now - (l.wonAt + (Number(last.days) || 0) * DAY) > 7 * DAY || (near365(last) && c.anniv.on)) return { k: stepKey(last, l), marks, text: null };
      return { k: stepKey(last, l), marks, text: fill(last.text, l, company) };
    }
    const since = Math.max(l.lastSurveyAt || 0, l.surveySent || 0, l.wonAt);
    if (c.survey.on && now - l.wonAt > 14 * DAY && now - since >= (Number(c.survey.days) || 120) * DAY && !surveyPending(l, now) && !(l.cases || []).some((x) => x.status === "abierto"))
      return { k: "q" + dayKey(now), survey: true, text: fill(c.survey.text, l, company) };
  }
  return null;
}

// Riesgo de perder al cliente (para alertas y el tablero)
function riskOf(l, c, now = Date.now()) {
  if (l.stage !== "ganado") return null;
  const r = [];
  const open = (l.cases || []).filter((x) => x.status === "abierto");
  if (open.some((x) => now - x.at > (Number(c.caseDays) || 3) * DAY)) r.push("caso sin resolver");
  if (l.csat && l.csat <= 3 && now - (l.csatAt || 0) < 120 * DAY) r.push("calificó " + l.csat + " de 5");
  const last = Math.max(l.lastInboundAt || 0, l.wonAt || 0);
  if (now - last > (Number(c.coldDays) || 180) * DAY) r.push("sin contacto hace " + Math.round((now - last) / (30 * DAY)) + " meses");
  return r.length ? r : null;
}

const PROBLEM_RE = /\b(problema|problemas|falla|fallas|fallando|fallo|dano|danado|danada|no funciona|no sirve|no prende|garantia|reclamo|queja|devolucion|devolver|reembolso|mal servicio|mala atencion|insatisfech\w*|inconforme|molest[oa]s?|molesto|estafa|nadie me (responde|contesta|atiende)|no me han (respondido|contestado|llamado|entregado|llegado|solucionado|resuelto))\b/;
// Frases negadas («ningún problema», «sin quejas», «no es molestia») no abren casos
const NEG_RE = /\b(ningun|ninguna|sin|cero|no hay|ni un|ni una|tampoco|no tengo|no tuve|no he tenido|no es|no fue|nada de)\s+(\w+\s+)?(problema|problemas|falla|fallas|queja|quejas|reclamo|reclamos|molestia|molestias|inconveniente|inconvenientes|dano)\b|\bno me (ha|han) fallado\b|\bsin novedad\b/g;
const isProblem = (text) => PROBLEM_RE.test(norm(text).replace(NEG_RE, " "));

module.exports = { CARE_DEFAULT, careCfg, careFor, riskOf, isProblem, fill, dayKey, local, surveyPending, stepKey };
