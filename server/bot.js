/* Asistente automático SIN inteligencia artificial (sin costo por mensaje).
   Entiende preguntas por palabras clave y por la Base de conocimiento, muestra un menú,
   ofrece horarios de la agenda y agenda la cita, y avisa a un asesor cuando no sabe.
   Se usa igual en la app (navegador) y en el servidor. */
(function (root) {
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,;:()"]/g, " ").replace(/\s+/g, " ").trim();
  const stem = (w) => w.replace(/(es|s)$/, "").replace(/(cion|ciones)$/, "cion");
  const STOP = new Set("el la los las un una unos unas de del al a en y o u que por para con sin su sus mi mis me te se le lo es son hay como cual cuales esto eso este esta quiero quisiera queria saber tienen tiene usted ustedes favor buenas buenos hola dias tardes noches gracias".split(" "));
  const words = (s) => norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
  const GENERIC = new Set(["cuanto", "cuesta", "cuestan", "precio", "valor", "costo", "vale", "cobran", "hacen", "manejan", "ofrecen", "atienden", "donde", "queda", "quedan", "horario", "hora", "puedo", "necesito", "busco", "informacion", "info", "cita", "citas", "agendar", "agenda", "reservar", "turno", "quiero"].map(stem));
  const keyWords = (s) => words(s).filter((w) => !GENERIC.has(w));
  const has = (nt, list) => list.some((k) => (k.endsWith("*") ? new RegExp("\\b" + k.slice(0, -1)).test(nt) : new RegExp("\\b" + k + "\\b").test(nt)));
  const INTENTS = {
    human: ["asesor", "asesora", "persona", "humano", "hablar con", "llamar*", "llamada", "queja", "reclamo", "molest*", "gerente", "encargad*"],
    cita: ["cita*", "agend*", "reserv*", "turno", "disponib*", "espacio", "programar"],
    precio: ["precio*", "cuesta*", "cuanto", "valor*", "costo*", "tarifa*", "cobran", "vale", "cotiza*", "promocion*", "descuento*"],
    horario: ["horario*", "hora", "horas", "abren", "cierran", "atienden", "abierto*", "sabado*", "domingo*", "festivo*"],
    ubicacion: ["donde", "direccion", "ubica*", "llegar", "sede*", "queda*", "barrio"],
    pago: ["pago*", "pagar", "nequi", "daviplata", "tarjeta*", "transferencia*", "efectivo", "credito", "cuota*", "financ*", "pse"],
    gracias: ["gracias", "muy amable", "perfecto", "listo"],
    saludo: ["hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "saludos"],
  };
  const MENU_KEYS = { 1: "precio", 2: "horario", 3: "cita", 4: "human" };

  function extract(text) {
    const out = {};
    const em = String(text).match(/[\w.+-]+@[\w-]+\.[\w.-]+/); if (em) out.email = em[0];
    const ph = String(text).replace(/[\s.-]/g, "").match(/(\+?57)?3\d{9}\b/); if (ph) out.phone = ph[0];
    const nm = String(text).match(/(?:me llamo|mi nombre es|habla|le escribe)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+)?)/i)
      || String(text).match(/\bsoy\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/);
    if (nm) out.name = nm[1].replace(/\b\w/g, (c) => c.toUpperCase());
    return out;
  }
  function bestFaq(c, text) {
    const w = new Set(keyWords(text)); let best = null, bs = 0;
    for (const f of c.faqs || []) {
      if (!f.q || !f.a) continue;
      const fw = new Set(keyWords(f.q)); let s = 0; fw.forEach((x) => { if (w.has(x)) s++; });
      const score = fw.size ? s / Math.min(fw.size, Math.max(w.size, 1)) : 0;
      if (s > 0 && (score > bs || (score === bs && best && s > best.s))) { bs = score; best = { f, s, score }; }
    }
    return best;
  }
  function catalogHit(c, text) {
    const w = new Set(words(text)); let best = null, bs = 0;
    for (const it of c.catalog || []) { if (!it.n) continue; const iw = words(it.n); const s = iw.filter((x) => w.has(x)).length; if (s > bs) { bs = s; best = it; } }
    return bs ? best : null;
  }
  const lineOf = (txt, re) => String(txt || "").split(/\n|(?<=\.)\s+/).find((x) => re.test(norm(x)));
  const cop = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");

  /* c = { company, assistant, services, extra, hoursText, phone, faqs, catalog, payInfo, payLink, sedes:[{name,address,hours}],
          agendaOn, agendaServices:[], slots:(n)=>[ts], fmt:(ts)=>texto, openNow:boolean, nextOpenText:"" } */
  function reply(c, lead, text) {
    const nt = norm(text), st = { ...(lead.bot || {}) }, ex = extract(text);
    const r = { reply: "", score: lead.score || 20, stage: null, handoff: false, botState: st };
    if (ex.name && !lead.name) r.name = ex.name;
    if (ex.phone && !lead.phone) r.phone = ex.phone;
    if (ex.email && !lead.email) r.email = ex.email;
    const menu = `Puedo ayudarle con:\n1. Servicios y precios\n2. Horario y ubicación\n3. Agendar una cita\n4. Hablar con un asesor\nResponda con el número.`;
    const num = (nt.match(/^(?:opcion |la |el |numero )?([1-9])$/) || [])[1];
    const ordinal = { primer: 1, primera: 1, segund: 2, tercer: 3 }; let ord = null;
    for (const [k, v] of Object.entries(ordinal)) if (new RegExp("\\b" + k).test(nt)) ord = v;

    // 1. Respuesta a la oferta de horarios
    if (st.slots && st.slots.length && (num || ord)) {
      const i = Number(num || ord) - 1;
      if (st.slots[i]) {
        r.book = st.slots[i]; r.service = st.service || "cita";
        r.reply = `Listo${lead.name || r.name ? ", " + String(lead.name || r.name).split(" ")[0] : ""}. Su ${r.service === "cita" ? "cita" : "cita de " + r.service} quedó para el ${String(c.fmt(r.book)).replace(/\.$/, "")}. Le enviaremos un recordatorio.${!lead.phone && !r.phone && lead.channel !== "whatsapp" ? " ¿Me regala un número de WhatsApp para confirmarle?" : ""}`;
        r.score = Math.max(r.score, 75); r.stage = "propuesta"; st.slots = null; st.menu = false; return r;
      }
    }
    // 2. Respuesta al menú
    let intent = null;
    if (num && st.menu && MENU_KEYS[num]) intent = MENU_KEYS[num];
    // 3. Nombre cuando se le pidió
    if (!intent && st.askedName && !lead.name && !r.name && /^[a-záéíóúñ]+( [a-záéíóúñ]+){0,2}$/i.test(String(text).trim()) && !has(nt, [].concat(...Object.values(INTENTS)))) {
      r.name = String(text).trim().replace(/\b\w/g, (x) => x.toUpperCase()); st.askedName = false;
      r.reply = `Mucho gusto, ${r.name.split(" ")[0]}. ${menu}`; st.menu = true; return r;
    }
    // 4. Intención por palabras clave y base de conocimiento
    const faq = bestFaq(c, text);
    if (!intent) {
      if (has(nt, INTENTS.human)) intent = "human";
      else if (has(nt, INTENTS.cita) && !(faq && has(norm(faq.f.q), INTENTS.cita))) intent = "cita";
      else if (faq && faq.score >= 0.5 && !(catalogHit(c, text) && !keyWords(faq.f.q).some((x) => keyWords(catalogHit(c, text).n).includes(x)))) intent = "faq";
      else if (has(nt, INTENTS.cita)) intent = "cita";
      else if (has(nt, INTENTS.precio)) intent = "precio";
      else if (has(nt, INTENTS.horario)) intent = "horario";
      else if (has(nt, INTENTS.ubicacion)) intent = "ubicacion";
      else if (has(nt, INTENTS.pago)) intent = "pago";
      else if (faq && faq.s >= 1 && faq.score >= 0.34) intent = "faq";
      else if (has(nt, INTENTS.gracias)) intent = "gracias";
      else if (has(nt, INTENTS.saludo) || nt.length < 3) intent = "saludo";
    }
    const item = catalogHit(c, text);
    if (item && !lead.interest) r.interest = item.n;
    switch (intent) {
      case "human":
        r.handoff = true; r.reply = `Con gusto. Ya le aviso a un asesor para que le escriba${c.openNow ? " en breve" : " " + (c.nextOpenText || "apenas abramos")}.`; break;
      case "faq":
        r.reply = faq.f.a; r.score += 10; r.stage = "interesado"; if (!lead.interest) r.interest = String(faq.f.q).replace(/[¿?]/g, "").slice(0, 60); break;
      case "cita": {
        if (!c.agendaOn) { r.handoff = true; r.reply = "Con gusto le agendamos. Un asesor le escribirá para acordar el día y la hora."; break; }
        const slots = (c.slots(3) || []);
        if (!slots.length) { r.handoff = true; r.reply = "En este momento no veo espacios libres en la agenda. Un asesor le escribirá para buscarle un horario."; break; }
        const svc = (c.agendaServices || []).find((s) => keyWords(text).some((w) => keyWords(s).includes(w)));
        st.slots = slots; st.service = svc || ""; st.menu = false;
        r.reply = `Tengo estos espacios${svc ? " para " + svc : ""}:\n${slots.map((t, i) => `${i + 1}. ${c.fmt(t)}`).join("\n")}\nResponda con el número que prefiera.`;
        r.score = Math.max(r.score, 55); r.stage = "interesado"; break;
      }
      case "precio":
        if (item) r.reply = `${item.n} tiene un valor de ${cop(item.p)}${item.d ? " (" + item.d + ")" : ""}.`;
        else if ((c.catalog || []).filter((x) => x.n).length) r.reply = `Estos son nuestros precios:\n${c.catalog.filter((x) => x.n).slice(0, 8).map((x) => `• ${x.n}: ${cop(x.p)}`).join("\n")}`;
        else if (c.services) r.reply = String(c.services).slice(0, 700);
        else { r.handoff = true; r.reply = "Un asesor le compartirá los precios en breve."; }
        if (!r.handoff) r.reply += "\n¿Desea agendar una cita? Responda 3.";
        st.menu = true; r.score += 15; r.stage = "interesado"; break;
      case "horario": {
        const sedes = (c.sedes || []).filter((x) => x.hours).map((x) => `• ${x.name}: ${x.hours}`).join("\n");
        r.reply = (c.hoursText ? `Nuestro horario es: ${String(c.hoursText).replace(/\.$/, "")}.` : "Le comparto nuestro horario de atención.") + (sedes ? `\n${sedes}` : "");
        const addr = lineOf(c.extra, /direccion|calle|carrera|cra|avenida|av /);
        if (addr && !sedes) r.reply += `\n${addr.trim()}`;
        r.reply += "\n¿Le ayudo con algo más? Responda 1 para precios o 3 para agendar."; st.menu = true; break;
      }
      case "ubicacion": {
        const sedes = (c.sedes || []).filter((x) => x.address).map((x) => `• ${x.name}: ${x.address}`).join("\n");
        const addr = lineOf(c.extra, /direccion|calle|carrera|cra|avenida|av |ubicad/);
        r.reply = sedes ? `Estas son nuestras sedes:\n${sedes}` : addr ? addr.trim() : `Un asesor le compartirá la ubicación de ${c.company}.`;
        if (!sedes && !addr) r.handoff = true; st.menu = true; break;
      }
      case "pago": {
        const p = c.payInfo || lineOf(c.extra, /pago|nequi|tarjeta|efectivo|transferencia/);
        r.reply = p ? String(p).trim() : "Un asesor le explicará los medios de pago."; if (!p) r.handoff = true;
        if (c.payLink) r.reply += `\nTambién puede pagar en línea aquí: ${c.payLink}`; break;
      }
      case "gracias":
        r.reply = `Con mucho gusto. Si necesita algo más, aquí estamos. ${c.company}.`; st.menu = false; break;
      case "saludo":
        r.reply = `Hola, soy ${c.assistant || "el asistente"} de ${c.company}. ${menu}`; st.menu = true; break;
      default:
        r.unknown = String(text).slice(0, 200); r.handoff = true;
        r.reply = `Esa pregunta se la responde mejor un asesor; ya le aviso para que le escriba${c.openNow ? "" : " " + (c.nextOpenText || "apenas abramos")}. Mientras tanto, ${menu.charAt(0).toLowerCase() + menu.slice(1)}`; st.menu = true;
    }
    if (!lead.name && !r.name && !st.askedName && intent !== "human" && !r.book) { r.reply += "\n¿Me regala su nombre, por favor?"; st.askedName = true; }
    if (r.name || r.phone || r.email) r.score += 10;
    r.score = Math.max(0, Math.min(100, r.score));
    return r;
  }
  const api = { reply, norm, extract };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.GC_BOT = api;
})(typeof window !== "undefined" ? window : globalThis);
