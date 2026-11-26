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

const PIDE_DATOS = "Si quiere, POLIANDES le escribe: envíeme en un solo mensaje su nombre completo y su celular. Al enviarlos autoriza a POLIANDES a tratar sus datos para contactarlo sobre sus programas (Ley 1581 de 2012).";

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

// Devuelve lo mismo que BOT.reply (reply, handoff, name, phone, interest, stage, botState) más sig/draw para el historial
async function responder(ctx, l) {
  const x = cfgOf(ctx.config, ctx.tid); if (!x) return null;
  const st = { ...(l.bot || {}) };
  const ultimo = (l.messages || []).filter((m) => m.from === "cliente").slice(-1)[0];
  const r = { reply: "", handoff: false, botState: st, cerebro: true };
  // 1) Si Dayana pidió los datos y el cliente los mandó, se registran en Dayana (→ AcademIA) y en Agente-IA
  if (ultimo && (st.dyDatos || /(\+?57)?3\d{9}\b/.test(String(ultimo.text).replace(/[\s.-]/g, "")))) {
    const d = datosDe(ultimo.text, l);
    if (!d.phone && st.dyDatos && l.phone && d.name && !/[?¿]/.test(ultimo.text)) d.phone = l.phone;
    if (d.phone) {
      if (d.name && !l.name) r.name = d.name; r.phone = d.phone; if (d.email && !l.email) r.email = d.email;
      const textos = (l.messages || []).filter((m) => m.from === "cliente").map((m) => String(m.text || "")).reverse();
      const interes = adivinar(textos);
      if (d.name && !st.dyRegistrado) {
        const p = await post(x, "prospecto", { conv: convDe(l), nombre: d.name, celular: d.phone, correo: d.email || l.email || "", interes, acepto: true, web: "",
          contexto: (l.channel ? "[" + l.channel + "] " : "") + textos.slice(0, 4).reverse().join(" / ").slice(0, 280) }).catch(() => ({ ok: false }));
        if (p && p.ok) st.dyRegistrado = Date.now();
      }
      if (!d.name) { st.dyDatos = true; r.reply = "Gracias, ya tengo su celular. ¿Me escribe también su nombre completo?"; return r; }
      st.dyDatos = false; r.interest = interes !== "Otro / no sé" ? interes : undefined; r.stage = "calificado"; r.score = 70;
      r.reply = `Listo${d.name ? ", " + d.name.split(" ")[0] : ""}. POLIANDES le escribirá desde su línea oficial 301 344 4422. ¿Le ayudo con algo más mientras tanto?`;
      return r;
    }
  }
  // 2) Todo lo demás lo responde Dayana con su propia base de conocimientos
  let j;
  try { j = await post(x, "mensaje", { conv: convDe(l), msgs: historial(l) }); } catch (e) { j = { ok: false, error: e.message }; }
  if (!j || j.apagado || !j.texto) {
    console.error("cerebro dayana", ctx.tid, j && (j.error || (j.apagado ? "apagado" : "sin texto")));
    r.reply = "En este momento le atiende mejor una asesora de POLIANDES por WhatsApp: https://wa.me/" + (x.wa || "573013444422") + " (línea oficial 301 344 4422). También puede dejarme su nombre y celular y le escribimos.";
    st.dyDatos = true; r.handoff = true; return r;
  }
  const o = traducir(j.texto, x);
  r.reply = o.text || "¿Me lo repite, por favor?"; r.sig = j.sig || ""; r.draw = j.texto;
  if (o.datos || o.wa) {
    if (l.phone) { if (o.wa) r.reply += `\n\nSi prefiere, escriba a POLIANDES por WhatsApp: https://wa.me/${o.waNum}`; }
    else { r.reply += "\n\n" + PIDE_DATOS; st.dyDatos = true; }
  }
  if (l.stage === "nuevo") r.stage = "contactado";
  return r;
}

module.exports = { cfgOf, responder, traducir, datosDe, historial, convDe };
