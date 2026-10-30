// Envío real por cada canal: Messenger / Instagram (Graph API) y correo (Brevo o SMTP).
// Agente-IA no envía WhatsApp (directiva de SkyNet Genesis): WhatsApp solo es el botón de soporte.
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VERSION || "v22.0"}`;
const digits = (s) => String(s || "").replace(/\D/g, "");

async function graph(path, token, body) {
  const r = await fetch(`${GRAPH}/${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Graph ${r.status}`);
  return j;
}

// Messenger e Instagram usan la misma API de mensajes de la página
async function sendPage(sec, psid, text) {
  if (!sec.page_token) throw new Error("Messenger / Instagram no están activados");
  const j = await graph(`me/messages`, sec.page_token, { recipient: { id: psid }, messaging_type: "RESPONSE", message: { text: String(text).slice(0, 1900) } });
  return j.message_id || "ok";
}
async function fetchLeadgen(sec, leadgenId) {
  if (!sec.page_token) throw new Error("Sin token de página");
  return graph(`${leadgenId}?fields=field_data,created_time,form_id`, sec.page_token);
}

let mailer = null;
function mail() {
  if (mailer !== null) return mailer;
  mailer = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : false;
  return mailer;
}
const mailOn = () => !!(process.env.BREVO_API_KEY || process.env.SMTP_URL);
const FIRMA = "\n\n—\nEnviado con Agente-IA de SkyNet Genesis · contacto@skynetgenesis.com · WhatsApp 304 437 5758";
const FROM_DEF = "SofIA · Agente-IA <sofia@skynetgenesis.com>"; // remitente verificado en Brevo (dominio skynetgenesis.com autenticado)
// Cupo del plan gratis de Brevo (300 correos al día para TODA la plataforma): se reserva una parte para los correos
// del sistema (contraseñas, pruebas, pagos) y cada empresa tiene un tope diario, para que una sola no gaste el cupo de todas.
const DIA = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const LIM = () => ({ total: Number(process.env.BREVO_DIARIO) || 280, sistema: 40, empresa: Number(process.env.BREVO_POR_EMPRESA) || 60 });
let dbm = null; const kv = () => (dbm || (dbm = require("./db")));
async function usados(k) { return Number(await kv().kvGet(k)) || 0; }
async function cupo(kind, tid) {
  const d = DIA(), L = LIM(), tot = await usados("mail:" + d);
  if (kind === "sistema") return tot < L.total;
  if (tot >= L.total - L.sistema) return false;
  return !tid || (await usados(`mail:${tid}:${d}`)) < L.empresa;
}
async function contar(tid) { const d = DIA(); await kv().pool.query("INSERT INTO kv (k, v) VALUES ($1, '1') ON CONFLICT (k) DO UPDATE SET v = (COALESCE(NULLIF(kv.v, ''), '0')::bigint + 1)::text", ["mail:" + d]); if (tid) await kv().pool.query("INSERT INTO kv (k, v) VALUES ($1, '1') ON CONFLICT (k) DO UPDATE SET v = (COALESCE(NULLIF(kv.v, ''), '0')::bigint + 1)::text", [`mail:${tid}:${d}`]); }
async function sendEmail(to, subject, text, opts = {}) {
  if (opts.sistema && !(await cupo("sistema"))) throw new Error("se acabó el cupo diario de correo");
  text = String(text || "") + FIRMA;
  // Brevo (gratis hasta 300 correos al día) por su API web; si no, SMTP
  if (process.env.BREVO_API_KEY) {
    const from = process.env.MAIL_FROM || FROM_DEF;
    const m = from.match(/^(.*)<(.+)>$/);
    const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: { name: m ? m[1].trim() : "Agente-IA", email: m ? m[2].trim() : from }, to: [{ email: to }], subject, textContent: text, ...(/@/.test(opts.replyTo || "") ? { replyTo: { email: opts.replyTo } } : {}) }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error("Brevo " + r.status + (j.message ? ": " + j.message : "")); }
    await contar(opts.tid).catch(() => {});
    return "ok";
  }
  const m = mail(); if (!m) throw new Error("Correo no configurado (BREVO_API_KEY o SMTP_URL)");
  await m.sendMail({ from: process.env.MAIL_FROM || FROM_DEF, to, subject, text });
  return "ok";
}

// Firma de Meta en los webhooks (X-Hub-Signature-256) con META_APP_SECRET
function verifyMeta(req) {
  const secret = process.env.META_APP_SECRET; if (!secret) return false; // sin la clave de Meta no se acepta ningún aviso
  const sig = req.headers["x-hub-signature-256"] || "";
  const h = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody || "").digest("hex");
  try { return sig.length === h.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(h)); } catch { return false; }
}

module.exports = { sendPage, fetchLeadgen, sendEmail, mailOn, verifyMeta, digits, cupo };
