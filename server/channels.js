// Envío real por cada canal: WhatsApp Cloud API, Messenger / Instagram (Graph API) y correo (SMTP).
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VERSION || "v22.0"}`;
const digits = (s) => String(s || "").replace(/\D/g, "");
// Números de Colombia: si viene de 10 dígitos y empieza por 3, se antepone 57
function waNumber(s) { let d = digits(s); if (d.length === 10 && d.startsWith("3")) d = "57" + d; return d; }

async function graph(path, token, body) {
  const r = await fetch(`${GRAPH}/${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Graph ${r.status}`);
  return j;
}

// WhatsApp: dentro de las 24 h desde el último mensaje del cliente se envía texto libre;
// fuera de esa ventana Meta exige una plantilla aprobada (nombre en sec.wa_template, cuerpo con {{1}} empresa y {{2}} mensaje).
async function sendWhatsApp(sec, to, text, { lastInboundAt = 0, company = "" } = {}) {
  if (!sec.wa_phone_id || !sec.wa_token) throw new Error("WhatsApp no está activado para esta empresa");
  const num = waNumber(to); if (num.length < 10) throw new Error("Número de WhatsApp inválido");
  const inWindow = Date.now() - (lastInboundAt || 0) < 24 * 3600e3;
  let body;
  if (inWindow) body = { messaging_product: "whatsapp", to: num, type: "text", text: { body: String(text).slice(0, 4000), preview_url: true } };
  else if (sec.wa_template) body = { messaging_product: "whatsapp", to: num, type: "template", template: { name: sec.wa_template, language: { code: sec.wa_template_lang || "es" },
    components: [{ type: "body", parameters: [{ type: "text", text: String(company).slice(0, 60) || "nosotros" }, { type: "text", text: String(text).replace(/\s*\n\s*/g, " ").slice(0, 900) }] }] } };
  else throw new Error("Fuera de la ventana de 24 h y sin plantilla aprobada");
  const j = await graph(`${sec.wa_phone_id}/messages`, sec.wa_token, body);
  return j.messages?.[0]?.id || "ok";
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
async function sendEmail(to, subject, text) {
  // Brevo (gratis hasta 300 correos al día) por su API web; si no, SMTP
  if (process.env.BREVO_API_KEY) {
    const from = process.env.MAIL_FROM || "Gestión ComercIAl <no-responder@skynetgenesis.com>";
    const m = from.match(/^(.*)<(.+)>$/);
    const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: { name: m ? m[1].trim() : "Gestión ComercIAl", email: m ? m[2].trim() : from }, to: [{ email: to }], subject, textContent: text }) });
    if (!r.ok) throw new Error("Brevo " + r.status);
    return "ok";
  }
  const m = mail(); if (!m) throw new Error("Correo no configurado (BREVO_API_KEY o SMTP_URL)");
  await m.sendMail({ from: process.env.MAIL_FROM || "Gestión ComercIAl <no-responder@skynetgenesis.com>", to, subject, text });
  return "ok";
}

// Firma de Meta en los webhooks (X-Hub-Signature-256) con META_APP_SECRET
function verifyMeta(req) {
  const secret = process.env.META_APP_SECRET; if (!secret) return true;
  const sig = req.headers["x-hub-signature-256"] || "";
  const h = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody || "").digest("hex");
  try { return sig.length === h.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(h)); } catch { return false; }
}

module.exports = { sendWhatsApp, sendPage, fetchLeadgen, sendEmail, verifyMeta, waNumber, digits };
