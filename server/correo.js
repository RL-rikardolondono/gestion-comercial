// Respuestas por correo que entran a la Bandeja.
// Cada correo que Agente-IA le manda a un cliente lleva como «responder a» una dirección propia de esa conversación:
//   r.<empresa>.<prospecto>.<firma>@respuestas.skynetgenesis.com
// Brevo recibe la respuesta (registros MX del subdominio) y la entrega a este servidor (webhook «inbound»).
// La respuesta entra a la conversación del cliente como si hubiera escrito en el chat: SofIA responde por correo,
// el equipo recibe el aviso y queda todo en la Bandeja. La firma impide que alguien invente direcciones.
const crypto = require("crypto");
const db = require("./db");
const DOM = () => process.env.INBOUND_DOMAIN || "respuestas.skynetgenesis.com";
const SECRETO = () => process.env.SECRET_KEY || process.env.JWT_SECRET || "agente-ia";
const firma = (s, n = 10) => crypto.createHmac("sha256", SECRETO()).update(String(s)).digest("hex").slice(0, n);
let activo = null, revisadoAt = 0;

// ¿Ya está conectado el webhook de Brevo? (se recuerda en la base; se revisa como mucho cada 10 minutos)
// Solo se usa la dirección propia si el webhook existe Y los registros MX del subdominio apuntan a Brevo
// (si no, las respuestas de los clientes rebotarían): mientras tanto las respuestas van al correo de la empresa, como antes.
async function mxListo() {
  try { const mx = await require("dns").promises.resolveMx(DOM()); return mx.some((x) => /sendinblue|brevo/i.test(x.exchange)); } catch { return false; }
}
async function estaActivo() {
  if (activo !== null && Date.now() - revisadoAt < 600000) return activo;
  revisadoAt = Date.now(); activo = !!(await db.kvGet("inbound:ok").catch(() => null)) && (await mxListo()); return activo;
}
async function responderA(tid, leadId) {
  if (!(await estaActivo())) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(tid + leadId)) return null;
  return `r.${tid}.${leadId}.${firma(tid + "/" + leadId)}@${DOM()}`;
}
function leerDireccion(addr) {
  const m = String(addr || "").trim().match(/^r\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([0-9a-fA-F]{10})@/i);
  return m ? { tid: m[1], leadId: m[2], sig: m[3].toLowerCase() } : null;
}
// Quita el texto citado del correo anterior (lo que viene después de «El … escribió:» o líneas con «>»)
function limpiar(t) {
  let s = String(t || "").replace(/\r/g, "");
  const corte = s.search(/\n\s*(El .{3,120} escribió:|On .{3,120} wrote:|-----Original Message-----|De: .{3,120}\nEnviado:)/i);
  if (corte > 0) s = s.slice(0, corte);
  s = s.split("\n").filter((x) => !/^\s*>/.test(x)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.slice(0, 2000);
}
// Algunos correos pasan la dirección a minúsculas: se busca el id exacto y, si no aparece, sin distinguir mayúsculas
async function idReal(parent, id) {
  const r = await db.pool.query("SELECT path FROM docs WHERE parent=$1 AND (path=$2 OR lower(path)=lower($2)) LIMIT 1", [parent, parent + "/" + id]);
  return r.rows[0] ? r.rows[0].path.split("/").pop() : null;
}
async function buscar(d) {
  const tid = await idReal("tenants", d.tid); if (!tid) return null;
  const leadId = await idReal(`tenants/${tid}/leads`, d.leadId); if (!leadId) return null;
  return firma(tid + "/" + leadId) === d.sig ? { tid, leadId } : null;
}

function routes(app) {
  // Aviso de Brevo: la URL lleva una clave secreta propia (Brevo no firma sus avisos)
  app.post("/api/public/correo-entrante", async (req, res) => {
    if (String(req.query.k || "") !== firma("inbound", 24)) return res.status(403).json({ ok: false });
    res.json({ ok: true }); // se responde de una vez; Brevo no espera
    const items = Array.isArray(req.body?.items) ? req.body.items : [req.body || {}];
    for (const it of items.slice(0, 20)) {
      try {
        const id = String(it.MessageId || (it.Uuid || [])[0] || "");
        const dests = [...(it.Recipients || []), ...((it.To || []).map((x) => x && x.Address))].filter(Boolean);
        const d = dests.map(leerDireccion).find(Boolean); if (!d) continue;
        let f = await buscar(d);
        if (!f) { // el prospecto pudo pasar al archivo: se busca allí y se trae de vuelta con su conversación
          const tid = await idReal("tenants", d.tid), aid = tid && (await idReal(`tenants/${tid}/archive`, d.leadId));
          if (aid && firma(tid + "/" + aid) === d.sig) { const a = await db.getDoc(`tenants/${tid}/archive/${aid}`); if (a.exists) { await db.setDoc(`tenants/${tid}/leads/${aid}`, { ...a.data, archivedAt: null }); await db.delDoc(`tenants/${tid}/archive/${aid}`); f = { tid, leadId: aid }; } }
        }
        if (!f) { console.error("correo entrante: dirección no válida"); continue; }
        if ((Number(it.SpamScore ?? it.Spam?.Score) || 0) >= 5) continue;
        const texto = limpiar(it.ExtractedMarkdownMessage || it.RawTextBody || "") || "[Respondió el correo sin texto]";
        const de = it.From || {};
        await require("./engine").handleInbound(f.tid, { leadId: f.leadId, via: "email", email: de.Address || "", name: de.Name || "", text: texto, extId: id ? "em:" + id : undefined });
      } catch (e) { console.error("correo entrante", e.message); }
    }
  });
}

// Al arrancar: crea en Brevo el webhook de correo entrante si no existe (con la llave de Brevo que ya está en Render)
async function conectar() {
  const key = process.env.BREVO_API_KEY; if (!key) return;
  const base = (process.env.PUBLIC_API_URL || "https://api-comercial.skynetgenesis.com").replace(/\/$/, "");
  const url = `${base}/api/public/correo-entrante?k=${firma("inbound", 24)}`;
  try {
    const H = { "api-key": key, "Content-Type": "application/json", Accept: "application/json" };
    const l = await fetch("https://api.brevo.com/v3/webhooks?type=inbound", { headers: H }).then((r) => r.json()).catch(() => ({}));
    const ya = (l.webhooks || []).find((w) => w.url === url);
    if (!ya) {
      const r = await fetch("https://api.brevo.com/v3/webhooks", { method: "POST", headers: H, body: JSON.stringify({ type: "inbound", events: ["inboundEmailProcessed"], url, domain: DOM(), description: "Agente-IA: respuestas de los clientes a la Bandeja" }) });
      if (!r.ok) { const txt = (await r.text()).slice(0, 300); console.error("correo entrante: Brevo no creó el webhook", r.status, txt); await db.kvSet("inbound:err", r.status + " " + txt).catch(() => {}); return; }
    }
    await db.kvSet("inbound:ok", Date.now()); activo = null;
    console.log("Correo entrante: webhook listo en Brevo;", (await mxListo()) ? "registros MX listos" : "faltan los registros MX de " + DOM());
  } catch (e) { console.error("correo entrante: no se pudo conectar con Brevo", e.message); }
}
module.exports = { routes, conectar, responderA, limpiar, leerDireccion, firma, mxListo };
