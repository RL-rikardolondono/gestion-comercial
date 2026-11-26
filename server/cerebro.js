// «Cerebro externo»: para empresas que ya tienen su propia asesora con IA (POLIANDES → Dayana, en www.poliandes.com),
// SofIA no usa una base de conocimientos aparte: le pasa cada mensaje a esa asesora y responde con lo que ella diga.
// Así hay UNA sola base de conocimientos (la de Dayana, que se actualiza primero) y nunca dos versiones distintas.
// Configuración (solo personal de SkyNet Genesis), en tenants/{tid}/config/main:
//   cerebro: { tipo: "dayana", url: "https://skynetgenesis.com/dayana/chat.php", origen: "https://www.poliandes.com",
//              wa: "573013444422", web: "https://www.poliandes.com/" }
const BOT = require("./bot");

// POLIANDES (empresa interna de SkyNet Genesis) usa a Dayana; otras empresas pueden tenerlo en su configuración (solo personal de SkyNet Genesis lo pone)
const FIJOS = { tmvvjcz5p8snnf: { tipo: "dayana", url: "https://skynetgenesis.com/dayana/chat.php", origen: "https://www.poliandes.com", wa: "573013444422", web: "https://www.poliandes.com/" } };
const URL_OK = /^(https:\/\/(www\.)?skynetgenesis\.com\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/;
const cfgOf = (c, tid) => { if (c && c.cerebro === false) return null; const x = (c && c.cerebro) || FIJOS[tid] || {}; return x.tipo === "dayana" && URL_OK.test(x.url || "") ? x : null; };

// Botones de Dayana → enlaces que sí se ven en Messenger, Instagram y correo
const W = "https://www.poliandes.com/", AC = "https://academia-etdh.skynetgenesis.com/";
const BOTONES = {
  matricula: ["Matrícula para beneficiarios de Becas 500", AC + "?matricula=poliandes"], portal: ["Portal del estudiante", AC + "?portal=poliandes"],
  campus: ["Campus virtual", "https://poliandes.com/campusvirtualpoliandes/my/"], aspirantes: ["Becas 500 y requisitos", W + "aspirantes.html"],
  oferta: ["Oferta académica", W + "oferta.html"], veterinaria: ["Técnico en Veterinaria", W + "veterinaria.html"], preescolar: ["Técnico en Preescolar", W + "preescolar.html"],
  administracion: ["Administración y Finanzas", W + "administracion-finanzas.html"], maquinaria: ["Maquinaria Pesada", W + "maquinaria-pesada.html"],
  biblicos: ["Estudios Bíblicos", W + "estudios-biblicos.html"], "dipl-neurodivergencia": ["Diplomado en Neurodivergencia", W + "diplomado-autismo.html"],
  "dipl-docencia": ["Diplomado en Docencia Universitaria", W + "diplomado-docencia.html"], "dipl-vih": ["Diplomado en VIH", W + "diplomado-vih.html"],
  salud: ["Cursos para profesionales de la salud", W + "profesionales-salud.html"], "documentos-matricula": ["Documentos de matrícula", W + "carpeta-matricula.html"],
  calendario: ["Calendario académico", W + "calendario.html"], estudiantes: ["Servicios para estudiantes", W + "estudiantes.html"], tramites: ["Trámites y valores", W + "tramites.html"],
  documentos: ["Documentos y formatos", W + "documentos.html"], egresados: ["Egresados", W + "egresados.html"], empresas: ["Empresas y convenios", W + "empresas.html"],
  reintegro: ["Solicitar reintegro", "https://forms.gle/L93vJ8pvgagHiUfJ8"], noticias: ["Noticias", W + "noticias.html"],
};
// Lo mismo que adivina el chat de la página para «Le interesa»
const PISTAS = [[/veterin/i, "Veterinaria"], [/preescolar|primera infancia/i, "Preescolar"], [/administra|finanz|contab/i, "Administración y Finanzas"],
  [/maquinaria|retroexcavadora|excavadora|operador/i, "Maquinaria Pesada"], [/b[ií]blic|teolog/i, "Estudios Bíblicos"], [/neurodiver|autismo/i, "Diplomado en Neurodivergencia"],
  [/docencia/i, "Diplomado en Docencia Universitaria"], [/vih/i, "Diplomado en VIH"], [/salud|enfermer|m[eé]dic/i, "Cursos para profesionales de la salud"]];
const adivinar = (textos) => { for (const t of textos) for (const [re, x] of PISTAS) if (re.test(t)) return x; return "Otro / no sé"; };


function convDe(l) { return ("ag" + String(l.id || "").replace(/[^a-z0-9]/gi, "").toLowerCase()).slice(0, 24); }

// Historial en el formato de Dayana: solo cuentan las respuestas que ella misma firmó
function historial(l) {
  const out = [];
  for (const m of (l.messages || []).slice(-30)) {
    if (m.from === "cliente") out.push({ role: "user", content: String(m.text || "").slice(0, 600) });
    else if (m.from === "bot" && m.dsig && m.draw) out.push({ role: "assistant", content: m.draw, sig: m.dsig });
  }
  return out.slice(-12);
}

function traducir(texto, x) {
  const o = { botones: [], wa: null, datos: false };
  let t = String(texto || "");
  t = t.replace(/\[\[BOTON([^\]]*)\]\]/g, (m, a) => { const id = (a.match(/id=([\w-]+)/) || [])[1]; if (id && BOTONES[id]) o.botones.push(id); return ""; });
  t = t.replace(/\[\[WHATSAPP([^\]]*)\]\]/g, () => { o.wa = true; return ""; });
  t = t.replace(/\[\[DATOS\]\]/g, () => { o.datos = true; return ""; });
  t = t.replace(/\[\[[^\]]*\]\]/g, "").replace(/\[\[[^\]]*$/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const ids = [...new Set(o.botones)].slice(0, 3);
  if (ids.length) t += "\n\n" + ids.map((id) => `• ${BOTONES[id][0]}: ${BOTONES[id][1]}`).join("\n");
  return { text: t, ...o, waNum: (x && x.wa) || "573013444422" };
}

// Celular + nombre en el mensaje del cliente («Ana María Pérez 3001234567»)
function datosDe(text, l) {
  const ex = BOT.extract(text || "");
  const sin = String(text || "").replace(/(\+?57)?[\s.-]*3(?:[\s.-]*\d){9}/g, " ").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, " ");
  let nombre = ex.name || "";
  if (!nombre && !/[?¿]/.test(sin)) {
    const w = sin.replace(/\b(me llamo|mi nombre es|soy|nombre|celular|cel|whatsapp|n[uú]mero|y|mi|es)\b/gi, " ").replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, " ").split(/\s+/).filter((p) => p.length >= 2);
    const RARO = /^(hola|buenas?|buenos|dias|días|tardes|noches|quiero|info|informacion|información|gracias|favor|por|para|el|la|los|de|del|que|con|curso|programa|mas|más|ok|si|sí|no)$/i;
    if (w.length >= 1 && w.length <= 5 && !w.some((p) => RARO.test(p))) nombre = w.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(" ");
  }
  return { phone: ex.phone || "", email: ex.email || "", name: nombre || l.name || "" };
}

async function post(x, accion, body) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(x.url + "?a=" + accion, { method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", "X-Agente-Conv": String(body.conv || ""), Origin: x.origen || "https://www.poliandes.com", Referer: (x.web || "https://www.poliandes.com/") + "?canal=agente-ia" },
      body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false }));
  } finally { clearTimeout(tm); }
}

// ---------- Inscripción guiada por el chat (sin IA): nombre → celular → programa → bachiller ----------
// Nadie se va sin dejar sus datos: los datos van a Dayana (?a=prospecto) y de ahí a AcademIA › Inscripciones y matrículas.
const PROGRAMAS = ["Veterinaria", "Preescolar", "Administración y Finanzas", "Maquinaria Pesada", "Estudios Bíblicos", "Cursos para profesionales de la salud", "Otro / no sé"];
const NOMBRE_PROG = { "Veterinaria": "el Técnico en Veterinaria", "Preescolar": "el Técnico en Preescolar", "Administración y Finanzas": "el Técnico en Administración y Finanzas",
  "Maquinaria Pesada": "el Técnico en Maquinaria Pesada", "Estudios Bíblicos": "el Técnico en Estudios Bíblicos", "Cursos para profesionales de la salud": "los cursos para profesionales de la salud",
  "Diplomado en Neurodivergencia": "el Diplomado en Neurodivergencia", "Diplomado en Docencia Universitaria": "el Diplomado en Docencia Universitaria", "Diplomado en VIH": "el Diplomado en VIH" };
const QUIERE_INSCRIBIR = /\b(inscrib|inscripci|matricul|postular|aplicar|solicitar (la )?beca|quiero (la )?beca|quiero (estudiar|entrar|empezar)|como (me )?(inscribo|entro|aplico)|reservar (un )?cupo)/i;
const NO_INTERESA = /\b(no (me )?interesa|no gracias|ya no|despues|después|luego le|lo voy a pensar|lo pienso)\b/i;
const esPregunta = (t) => /[?¿]/.test(t) || /^(cuanto|cuánto|como|cómo|que|qué|cual|cuál|donde|dónde|cuando|cuándo|hay|tienen|puedo)\b/i.test(String(t).trim());
const celularDe = (t) => { const m = String(t).replace(/[\s.()-]/g, "").match(/(?:\+?57)?(3\d{9})\b/); return m ? m[1] : ""; };
function nombreDe(t) {
  if (esPregunta(t)) return "";
  const RARO = /^(hola|buenas?|buenos|dias|días|tardes|noches|quiero|info|informacion|información|gracias|favor|por|para|el|la|los|de|del|que|con|curso|programa|mas|más|ok|si|sí|no|inscribir|inscribirme|beca|becas|estudiar|veterinaria|preescolar)$/i;
  const w = String(t).replace(/\b(me llamo|mi nombre es|mi nombre|soy|nombre|completo)\b/gi, " ").replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, " ").split(/\s+/).filter((p) => p.length >= 2);
  if (w.length < 2 || w.length > 5 || w.some((p) => RARO.test(p))) return "";
  return w.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}
function programaDe(t) {
  const n = String(t).trim().match(/^([1-7])\b/); if (n) return PROGRAMAS[Number(n[1]) - 1];
  for (const [re, x] of PISTAS) if (re.test(t)) return x;
  if (/otro|no s[eé]|ninguno/i.test(t)) return "Otro / no sé";
  return "";
}
const PREG = {
  nombre: "¿Cuál es su nombre completo?",
  celular: "Gracias. ¿Cuál es su número de celular (WhatsApp)?",
  programa: "¿Qué programa le interesa? Responda con el número:\n1. Técnico en Veterinaria\n2. Técnico en Preescolar\n3. Técnico en Administración y Finanzas\n4. Técnico en Maquinaria Pesada\n5. Técnico en Estudios Bíblicos\n6. Cursos para profesionales de la salud\n7. Otro / no estoy seguro",
  bachiller: "Última pregunta: ¿ya es bachiller (tiene diploma o acta de grado 11)? Responda SÍ o NO.",
};
const LEY = "\n\nAl enviarme sus datos autoriza a POLIANDES a tratarlos para contactarlo sobre su inscripción (Ley 1581 de 2012).";
function siguiente(ins) { for (const k of ["nombre", "celular", "programa", "bachiller"]) if (!ins[k]) return k; return null; }
function iniciarInscripcion(st, l, textosCliente) {
  const ins = { nombre: l.name && nombreDe(l.name) ? l.name : "", celular: l.phone ? celularDe(l.phone) : "", programa: "", bachiller: "", at: Date.now() };
  const g = adivinar(textosCliente); if (g !== "Otro / no sé") ins.programa = g;
  st.insc = ins; const k = siguiente(ins); ins.paso = k;
  const n = ["nombre", "celular", "programa", "bachiller"].filter((x) => !ins[x]).length;
  const intro = `Para inscribirlo ahora mismo necesito ${n === 1 ? "un dato" : n + " datos"}.`;
  return k === "nombre" ? intro + " Primero: ¿cuál es su nombre completo?" + LEY : intro + LEY + "\n\n" + PREG[k];
}
async function terminarInscripcion(x, l, st, r) {
  const ins = st.insc; const textos = (l.messages || []).filter((m) => m.from === "cliente").map((m) => String(m.text || ""));
  const contexto = `[${l.channel || "redes"}] Inscripción por chat · Bachiller: ${ins.bachiller} · ` + textos.slice(-4).join(" / ");
  const p = await post(x, "prospecto", { conv: convDe(l), nombre: ins.nombre, celular: ins.celular, correo: l.email || "", interes: ins.programa, acepto: true, web: "", contexto: contexto.slice(0, 300) }).catch(() => ({ ok: false }));
  st.insc = null; st.inscrito = { at: Date.now(), ok: !!(p && p.ok), programa: ins.programa };
  r.name = ins.nombre; r.phone = ins.celular; if (ins.programa !== "Otro / no sé") r.interest = ins.programa; r.stage = "propuesta"; r.score = 85;
  if (!(p && p.ok)) { console.error("cerebro inscripción", p && p.error); r.handoff = true; }
  const prog = NOMBRE_PROG[ins.programa] ? " para " + NOMBRE_PROG[ins.programa] : "";
  const grupo = x.grupo || "https://chat.whatsapp.com/BCBhPReWjUO80nMd9Y4pwS";
  let t = `Listo, ${ins.nombre.split(" ")[0]}: su inscripción${prog} quedó registrada en POLIANDES. Una asesora le escribirá al ${ins.celular} desde la línea oficial 301 344 4422 para la entrevista de Becas 500 y los pasos de matrícula.`;
  if (/^no/i.test(ins.bachiller)) t += " Como todavía no es bachiller, la asesora le explicará sus opciones.";
  else t += `\n\nMientras tanto, únase al grupo de inscripciones para recibir los avisos de la convocatoria: ${grupo}`;
  return t + "\n\n¿Tiene alguna otra pregunta?";
}
// Respuesta a un paso de la inscripción; null si el mensaje no es la respuesta (es una pregunta u otra cosa)
function pasoInscripcion(ins, txt) {
  const k = ins.paso;
  if (k === "nombre") { const cel = celularDe(txt); if (cel && !ins.celular) ins.celular = cel; const n = nombreDe(txt.replace(/(\+?57)?[\s.-]*3(?:[\s.-]*\d){9}/g, " ")); if (n) { ins.nombre = n; return true; } return cel ? true : null; }
  if (k === "celular") { const c = celularDe(txt); if (c) { ins.celular = c; return true; } return /\d{6,}/.test(txt.replace(/\D/g, "")) ? false : null; }
  if (k === "programa") { const p = programaDe(txt); if (p) { ins.programa = p; return true; } return null; }
  if (k === "bachiller") { if (/^\s*(s[ií]|claro|ya|ya soy|si soy|sí soy|bachiller)\b/i.test(txt)) { ins.bachiller = "sí"; return true; } if (/^\s*(no|todav[ií]a no|aun no|aún no|estoy en)/i.test(txt)) { ins.bachiller = "no"; return true; } return null; }
  return null;
}

// Devuelve lo mismo que BOT.reply (reply, handoff, name, phone, interest, stage, botState) más sig/draw para el historial
async function responder(ctx, l) {
  const x = cfgOf(ctx.config, ctx.tid); if (!x) return null;
  const st = { ...(l.bot || {}) };
  const ultimo = (l.messages || []).filter((m) => m.from === "cliente").slice(-1)[0];
  const txt = String((ultimo && ultimo.text) || "").trim();
  const textosCliente = (l.messages || []).filter((m) => m.from === "cliente").map((m) => String(m.text || "")).reverse();
  const r = { reply: "", handoff: false, botState: st, cerebro: true };
  if (st.insc && Date.now() - (st.insc.at || 0) > 48 * 3600e3) st.insc = null; // una inscripción a medias vence en 2 días
  let pendiente = ""; // pregunta de la inscripción que se repite después de responder una duda
  // 1) Inscripción en curso: cada respuesta llena un dato; si el cliente pregunta otra cosa, responde Dayana y se vuelve a pedir el dato
  if (st.insc) {
    const ins = st.insc;
    if (NO_INTERESA.test(txt) && !esPregunta(txt)) { st.insc = null; r.reply = "Entendido, sin problema. Si más adelante quiere inscribirse, escríbame «inscribirme» y lo hacemos en un minuto."; return r; }
    if (QUIERE_INSCRIBIR.test(txt) && !esPregunta(txt) && !celularDe(txt) && !nombreDe(txt)) { ins.at = Date.now(); r.reply = "Perfecto, ya lo estoy inscribiendo. " + PREG[ins.paso].replace(/^Gracias\. /, ""); return r; }
    const ok = pasoInscripcion(ins, txt);
    if (ok === true) {
      ins.at = Date.now(); const k = siguiente(ins); ins.paso = k;
      if (!k) { r.reply = await terminarInscripcion(x, l, st, r); return r; }
      r.reply = PREG[k]; if (ins.nombre) r.name = ins.nombre; if (ins.celular) r.phone = ins.celular; return r;
    }
    if (ok === false) { r.reply = "Ese número no parece un celular de Colombia. Escríbalo con sus 10 dígitos, por ejemplo 3001234567."; return r; }
    pendiente = PREG[ins.paso];
  }
  // 2) El cliente quiere inscribirse: se toma la inscripción de una vez, sin mandarlo a otro lado
  else if (QUIERE_INSCRIBIR.test(txt) && !st.inscrito) { r.reply = iniciarInscripcion(st, l, textosCliente); r.stage = "calificado"; r.score = 70; return r; }
  // 3) Todo lo demás lo responde Dayana con su propia base de conocimientos
  let j;
  try { j = await post(x, "mensaje", { conv: convDe(l), msgs: historial(l) }); } catch (e) { j = { ok: false, error: e.message }; }
  if (!j || j.apagado || !j.texto) {
    console.error("cerebro dayana", ctx.tid, j && (j.error || (j.apagado ? "apagado" : "sin texto")));
    if (!st.insc && !st.inscrito) { r.reply = "En este momento no tengo ese dato a la mano, pero no lo dejo sin respuesta: " + iniciarInscripcion(st, l, textosCliente); return r; }
    r.reply = "Disculpe, no pude revisar eso ahora; una asesora le responderá." + (pendiente ? "\n\n" + pendiente : ""); r.handoff = true; return r;
  }
  const o = traducir(j.texto, x);
  r.reply = o.text || "¿Me lo repite, por favor?"; r.sig = j.sig || ""; r.draw = j.texto;
  // Dayana dice que se gestiona por WhatsApp o pide datos → aquí mismo se toma la inscripción
  r.reply = r.reply.replace(/[^.\n]*(se gestiona[n]? con el equipo por WhatsApp|por WhatsApp con el equipo)[^.\n]*\.?/gi, "").replace(/\n{3,}/g, "\n\n").trim();
  if (pendiente) r.reply += "\n\n" + pendiente;
  else if ((o.datos || o.wa) && !st.inscrito) r.reply += "\n\n" + iniciarInscripcion(st, l, textosCliente);
  else if (o.wa && st.inscrito) r.reply += `\n\nSi prefiere, escriba a POLIANDES por WhatsApp: https://wa.me/${o.waNum}`;
  if (l.stage === "nuevo") r.stage = "contactado";
  return r;
}

module.exports = { cfgOf, responder, traducir, datosDe, historial, convDe, nombreDe, programaDe, celularDe };
