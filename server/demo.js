// Datos de ejemplo de la demostración pública (Empresa Demo): una academia de cursos que muestra
// todo el recorrido de Agente-IA (chat de la página, formulario, seguimiento, WhatsApp de un clic,
// clientes activos con cumpleaños y casos, citas). Se vuelven a crear cada día con fechas frescas.
// Todos llevan demo:true, así el motor nunca envía nada real y la limpieza diaria no los borra.
const db = require("./db");
const H = 3600e3, D = 24 * H;

function datos(now) {
  const t = (ms) => now - ms;
  const L = [];
  const lead = (id, x) => L.push({ id, demo: true, seed: true, createdAt: t(3 * D), updatedAt: now, ...x });
  lead("ej-ana", { name: "Ejemplo · Ana Martínez", phone: "3001112233", email: "", channel: "web", stage: "interesado", interest: "Técnico en enfermería", score: 70, awaiting: "empresa", handoff: true,
    createdAt: t(40 * 60e3), lastInboundAt: t(12 * 60e3), lastOutboundAt: t(13 * 60e3),
    messages: [{ from: "cliente", text: "Hola, ¿cuánto vale el técnico en enfermería?", at: t(38 * 60e3) },
      { from: "bot", text: "¡Hola! El técnico en enfermería vale $1.830.000 y la inscripción $80.000. Empieza en febrero. ¿Me deja su nombre y su celular para enviarle la información completa?", at: t(38 * 60e3 - 3000) },
      { from: "cliente", text: "Ana Martínez, 300 111 2233", at: t(30 * 60e3) },
      { from: "bot", text: "Gracias, Ana. Ya quedó registrada. ¿Le gustaría que un asesor la llame para explicarle las formas de pago?", at: t(30 * 60e3 - 3000) },
      { from: "cliente", text: "Sí, por favor, quiero hablar con un asesor", at: t(12 * 60e3) }] });
  lead("ej-carlos", { name: "Ejemplo · Carlos Pérez", phone: "3104445566", channel: "form", stage: "contactado", interest: "Curso de primeros auxilios", score: 55, awaiting: "cliente", followStep: 1,
    createdAt: t(2 * D), lastInboundAt: t(2 * D), lastOutboundAt: t(3 * H),
    messages: [{ from: "cliente", text: "Formulario: quiero información del curso de primeros auxilios", at: t(2 * D) },
      { from: "bot", text: "Hola, Carlos. Gracias por escribirnos. El curso de primeros auxilios dura 40 horas y vale $250.000.", at: t(2 * D - 5000), d: "sin canal activo" },
      { from: "auto", text: "Hola Carlos, ¿pudo revisar la información del curso de primeros auxilios? Le guardamos un cupo para el sábado.", at: t(3 * H), step: 1, d: "sin canal activo" }] });
  lead("ej-luisa", { name: "Ejemplo · Luisa Gómez", phone: "3157778899", email: "luisa.ejemplo@correo.co", channel: "web", stage: "propuesta", interest: "Auxiliar administrativo", score: 80, value: 1650000, awaiting: "cliente", followStep: 1,
    createdAt: t(4 * D), lastInboundAt: t(26 * H), lastOutboundAt: t(2 * H),
    messages: [{ from: "cliente", text: "¿Tienen auxiliar administrativo los sábados?", at: t(4 * D) },
      { from: "bot", text: "Sí, Luisa. Hay grupo los sábados de 8 a. m. a 1 p. m. ¿Quiere agendar una visita para conocer la sede?", at: t(4 * D - 4000) },
      { from: "cliente", text: "Sí, el jueves en la tarde", at: t(26 * H) },
      { from: "auto", text: "Hola Luisa, le recordamos su visita del jueves. Si necesita cambiarla, escríbanos por aquí.", at: t(2 * H), step: 1, d: "ok: correo" }] });
  lead("ej-jorge", { name: "Ejemplo · Jorge Ruiz", phone: "3201234567", channel: "web", stage: "nuevo", interest: "Precios de los cursos", score: 30, awaiting: "empresa",
    createdAt: t(9 * H), lastInboundAt: t(9 * H), lastOutboundAt: t(9 * H - 3000),
    messages: [{ from: "cliente", text: "¿Tienen parqueadero para estudiantes?", at: t(9 * H) },
      { from: "bot", text: "Esa pregunta se la confirma una persona de nuestro equipo. ¿Me deja su nombre y celular para que lo contacten?", at: t(9 * H - 3000), unknown: "¿Tienen parqueadero para estudiantes?" }] });
  lead("ej-maria", { name: "Ejemplo · María Fernanda Ríos", phone: "3009876543", email: "maria.ejemplo@correo.co", channel: "form", stage: "ganado", interest: "Técnico en enfermería", score: 95, value: 1830000, awaiting: "cliente",
    createdAt: t(40 * D), wonAt: t(30 * D), lastInboundAt: t(30 * D), lastOutboundAt: t(2 * H), careDay: "",
    messages: [{ from: "agente", text: "¡Bienvenida, María Fernanda! Su matrícula quedó lista. Las clases empiezan el lunes.", at: t(30 * D) },
      { from: "auto", text: "¡Feliz cumpleaños, María Fernanda! Todo el equipo le desea un día maravilloso. 🎉", at: t(2 * H), care: "bday", d: "ok: correo" }] });
  lead("ej-andres", { name: "Ejemplo · Andrés Torres", phone: "3112223344", email: "andres.ejemplo@correo.co", channel: "web", stage: "ganado", interest: "Curso de sistemas", score: 90, value: 650000, awaiting: "empresa", handoff: true,
    createdAt: t(60 * D), wonAt: t(50 * D), lastInboundAt: t(5 * H), lastOutboundAt: t(5 * H - 4000),
    cases: [{ id: "c1", status: "abierto", text: "No le llega el certificado del curso", at: t(5 * H) }],
    messages: [{ from: "cliente", text: "Buenas, terminé el curso y no me ha llegado el certificado", at: t(5 * H) },
      { from: "bot", text: "Lamento el inconveniente, Andrés. Ya abrí un caso y una persona del equipo lo revisa hoy mismo.", at: t(5 * H - 4000) }] });
  lead("ej-paola", { name: "Ejemplo · Paola Castro", phone: "3013334455", email: "paola.ejemplo@correo.co", channel: "form", stage: "ganado", interest: "Primeros auxilios", score: 85, value: 250000, awaiting: "cliente", csat: 5,
    createdAt: t(120 * D), wonAt: t(100 * D), lastInboundAt: t(6 * D), lastOutboundAt: t(6 * D),
    messages: [{ from: "auto", text: "Hola Paola, ¿cómo calificaría nuestra atención de 1 a 5?", at: t(7 * D), care: "survey", d: "ok: correo" }, { from: "cliente", text: "5", at: t(6 * D) },
      { from: "auto", text: "¡Muchas gracias por su calificación! Nos alegra haberle atendido bien.", at: t(6 * D) }] });
  lead("ej-diego", { name: "Ejemplo · Diego Morales", phone: "3189990011", channel: "web", stage: "perdido", interest: "Curso de inglés", score: 20, lossReason: "Lo que buscaba no lo ofrecemos",
    createdAt: t(10 * D), lastInboundAt: t(10 * D), lastOutboundAt: t(10 * D),
    messages: [{ from: "cliente", text: "¿Tienen cursos de inglés?", at: t(10 * D) },
      { from: "bot", text: "Por ahora no tenemos inglés, Diego. Le recomiendo nuestro curso de sistemas, que incluye herramientas de oficina. ¿Le interesa?", at: t(10 * D - 3000) }] });
  const hoy10 = (() => { const d = new Date(now - 5 * H); d.setUTCHours(15, 0, 0, 0); return d.getTime(); })();
  const appts = [
    { id: "ej-cita1", demo: true, seed: true, leadId: "ej-luisa", client: "Ejemplo · Luisa Gómez", service: "Visita a la sede", at: hoy10 + D, status: "programada", createdAt: t(26 * H) },
    { id: "ej-cita2", demo: true, seed: true, leadId: "ej-ana", client: "Ejemplo · Ana Martínez", service: "Asesoría de matrícula", at: hoy10 + 2 * H, status: "programada", createdAt: t(20 * 60e3) }];
  return { L, appts };
}

const CONFIG = {
  company: "Academia Demo", assistant: "SofIA", autoReply: true, tone: "cercano",
  services: "Técnico en enfermería: $1.830.000\nAuxiliar administrativo: $1.650.000\nCurso de primeros auxilios (40 horas): $250.000\nCurso de sistemas: $650.000\nInscripción: $80.000",
  hours: "Lunes a viernes de 8:00 a. m. a 6:00 p. m. y sábados de 8:00 a. m. a 1:00 p. m.",
  faqs: [{ q: "¿Cuánto cuesta el técnico en enfermería?", a: "El técnico en enfermería vale $1.830.000 y la inscripción $80.000. Se puede pagar por cuotas." },
    { q: "¿Dónde están ubicados?", a: "Estamos en el centro de Santa Marta. Le enviamos la ubicación por mensaje." },
    { q: "¿Tienen clases los sábados?", a: "Sí, hay grupos los sábados de 8:00 a. m. a 1:00 p. m." },
    { q: "¿Los títulos tienen validez?", a: "Sí, son programas con registro ante la Secretaría de Educación." }],
  steps: [{ hours: 24, text: "Hola {nombre}, ¿pudo revisar la información que le enviamos? Con gusto le resolvemos cualquier duda." },
    { hours: 72, text: "Hola {nombre}, le guardamos un cupo en el próximo grupo. ¿Quiere que lo separemos a su nombre?" }],
  autoFollow: true,
  biz: { agendaOn: true, services: ["Visita a la sede", "Asesoría de matrícula"], assign: "rr", digest: { on: false, to: "" } }
};

async function seedDemo(tid, force) {
  const now = Date.now();
  const k = "demoseed:" + new Date(now - 5 * H).toISOString().slice(0, 10);
  if (!force && (await db.kvGet(k))) return;
  await db.kvSet(k, now);
  const cur = await db.getDoc(`tenants/${tid}/config/main`);
  await db.setDoc(`tenants/${tid}/config/main`, { ...(cur.exists ? cur.data : {}), ...CONFIG, seededAt: now });
  await db.setDoc(`tenants/${tid}`, { ...((await db.getDoc("tenants/" + tid)).data || {}), name: "Academia Demo", sector: "Educación", city: "Santa Marta" });
  const { L, appts } = datos(now);
  for (const x of L) { const { id, ...d } = x; await db.setDoc(`tenants/${tid}/leads/${id}`, d); }
  for (const a of appts) { const { id, ...d } = a; await db.setDoc(`tenants/${tid}/appts/${id}`, d); }
}
module.exports = { seedDemo, datos };
