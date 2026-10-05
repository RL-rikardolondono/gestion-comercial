// Entradas públicas: webhooks de Meta (WhatsApp, Messenger, Instagram, anuncios), chat web,
// formulario y API de prospectos para otros sistemas.
const express = require("express");
const crypto = require("crypto");
const db = require("./db");
const ch = require("./channels");
const engine = require("./engine");

const cors = (req, res, next) => { res.set("Access-Control-Allow-Origin", "*"); res.set("Access-Control-Allow-Headers", "Content-Type, Authorization"); res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); if (req.method === "OPTIONS") return res.sendStatus(204); next(); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function tenantOk(tid) { const t = await db.getDoc(`tenants/${tid}`); return t.exists && t.data.status !== "suspendido" && !require("./cobro").cerrada(t.data) ? t.data : null; }

function router() {
  const r = express.Router();

  /* ---------- Meta: verificación y eventos ---------- */
  r.get("/webhooks/meta", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === (process.env.META_VERIFY_TOKEN || "")) return res.send(req.query["hub.challenge"]);
    res.sendStatus(403);
  });
  r.post("/webhooks/meta", async (req, res) => {
    if (!ch.verifyMeta(req)) return res.sendStatus(401);
    res.sendStatus(200); // Meta exige respuesta rápida; se procesa después
    engine.markDirty();
    const body = req.body || {};
    try {
      for (const entry of body.entry || []) {
        // WhatsApp
        for (const c of entry.changes || []) {
          const v = c.value || {};
          if (c.field === "messages" && v.messaging_product === "whatsapp") {
            const tid = await db.findTenantBySecret("wa_phone_id", v.metadata?.phone_number_id); if (!tid || !(await tenantOk(tid))) continue;
            const names = Object.fromEntries((v.contacts || []).map((x) => [x.wa_id, x.profile?.name || ""]));
            for (const m of v.messages || []) {
              const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || (m.type !== "text" ? `[El cliente envió ${m.type === "image" ? "una imagen" : m.type === "audio" ? "un audio" : m.type === "document" ? "un documento" : "un archivo"}]` : "");
              await engine.handleInbound(tid, { channel: "whatsapp", phone: "+" + m.from, name: names[m.from], text, extId: "wa:" + m.id });
            }
          }
          if (c.field === "leadgen") {
            const pageId = v.page_id || entry.id;
            const tid = await db.findTenantBySecret("page_id", pageId); if (!tid || !(await tenantOk(tid))) continue;
            const sec = await db.getSecrets(tid);
            const lead = await ch.fetchLeadgen(sec, v.leadgen_id).catch(() => null); if (!lead) continue;
            const f = Object.fromEntries((lead.field_data || []).map((x) => [x.name, (x.values || [])[0] || ""]));
            const name = f.full_name || f.nombre_completo || f.first_name || "", phone = f.phone_number || f.telefono || "", email = f.email || f.correo || "";
            await engine.handleInbound(tid, { channel: "fbleads", phone, name, email, text: `Formulario de anuncio: ${Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("; ")}`, extId: "lg:" + v.leadgen_id });
          }
        }
        // Messenger e Instagram
        for (const m of entry.messaging || []) {
          if (!m.message || m.message.is_echo || !m.sender) continue;
          const isIG = body.object === "instagram";
          const tid = await db.findTenantBySecret(isIG ? "ig_id" : "page_id", entry.id); if (!tid || !(await tenantOk(tid))) continue;
          await engine.handleInbound(tid, { channel: isIG ? "instagram" : "facebook", key: `${isIG ? "ig" : "fb"}:${m.sender.id}`, text: m.message.text || "[Adjunto]", extId: "pg:" + m.message.mid });
        }
      }
    } catch (e) { console.error("webhook", e.message); }
  });

  /* ---------- Chat para la página web ---------- */
  r.get("/widget.js", (req, res) => { res.type("application/javascript"); res.set("Cache-Control", "public, max-age=300"); res.send(WIDGET); });
  r.options("/api/public/*", cors);
  r.get("/api/public/:tid/info", cors, async (req, res) => {
    const t = await tenantOk(req.params.tid); if (!t) return res.status(404).json({ error: "No disponible" });
    const cfg = await db.getDoc(`tenants/${req.params.tid}/config/main`); const conns = await db.getDoc(`tenants/${req.params.tid}/config/connections`);
    const w = (conns.exists && conns.data.web && conns.data.web.data) || {};
    res.json({ company: cfg.data?.company || t.name, assistant: cfg.data?.assistant || "Asistente", greeting: w.greeting || "Hola, ¿en qué le podemos ayudar?", color: w.color || "#1E3A4C" });
  });
  r.post("/api/public/:tid/chat", cors, async (req, res) => {
    const { sid, text, name } = req.body || {}; const tid = req.params.tid;
    if (!(await tenantOk(tid)) || !sid || !text || String(text).length > 2000) return res.status(400).json({ error: "Solicitud inválida" });
    const conns = await db.getDoc(`tenants/${tid}/config/connections`);
    if (!(conns.exists && conns.data.web && conns.data.web.status === "activo")) return res.status(403).json({ error: "El chat no está activo" });
    const l = await engine.handleInbound(tid, { channel: "web", key: "web:" + String(sid).slice(0, 60), name, text: String(text) });
    res.json({ messages: publicMsgs(l, 0) });
  });
  r.get("/api/public/:tid/chat", cors, async (req, res) => {
    const tid = req.params.tid, sid = String(req.query.sid || ""), after = Number(req.query.after || 0);
    const leads = await db.listCol(`tenants/${tid}/leads`);
    const l = leads.map((x) => x.data).find((x) => x.extKey === "web:" + sid);
    res.json({ messages: l ? publicMsgs(l, after) : [] });
  });

  /* ---------- Formulario ---------- */
  r.get("/f/:tid", async (req, res) => {
    const t = await tenantOk(req.params.tid); if (!t) return res.status(404).send("Formulario no disponible");
    const cfg = await db.getDoc(`tenants/${req.params.tid}/config/main`); const c = cfg.data || {};
    const priv = (c.biz && c.biz.privacy) || { on: true };
    res.type("html").send(formPage(req.params.tid, c.company || t.name, priv));
  });
  r.post("/api/public/:tid/form", cors, async (req, res) => {
    const tid = req.params.tid; const f = req.body || {};
    if (!(await tenantOk(tid)) || !f.name || String(f.name).length > 120) return res.status(400).json({ error: "Escriba su nombre" });
    const cfg = await db.getDoc(`tenants/${tid}/config/main`); const c = cfg.data || {};
    if (((c.biz && c.biz.privacy) || { on: true }).on !== false && !f.consent) return res.status(400).json({ error: "Debe autorizar el tratamiento de datos" });
    const l = await engine.handleInbound(tid, { channel: "form", phone: f.phone, name: f.name, email: f.email, text: `Solicitud por formulario${f.interest ? ": " + f.interest : ""}.${f.msg ? " " + f.msg : ""}` });
    if (l && f.consent) { const p = `tenants/${tid}/leads/${l.id}`; const d = await db.getDoc(p); if (d.exists) await db.setDoc(p, { ...d.data, consent: "aceptado", consentAt: Date.now(), consentAsked: Date.now(), email: d.data.email || f.email || "", interest: d.data.interest || f.interest || "" }); }
    res.json({ ok: true, thanks: "Gracias. Recibimos su solicitud y le escribiremos en breve." });
  });

  /* ---------- API de prospectos (plan Empresarial) ---------- */
  r.post("/api/v1/:tid/prospectos", cors, express.json(), async (req, res) => {
    const tid = req.params.tid, t = await tenantOk(tid); if (!t) return res.status(404).json({ error: "Empresa no disponible" });
    if (t.plan !== "empresarial") return res.status(403).json({ error: "La API está en el plan Empresarial" });
    const sec = await db.getSecrets(tid); const tok = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
    if (!sec.api_key || !tok || tok.length !== sec.api_key.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(sec.api_key))) return res.status(401).json({ error: "Clave inválida" });
    const b = req.body || {};
    if (!b.nombre && !b.telefono && !b.correo) return res.status(400).json({ error: "Envíe nombre, telefono o correo" });
    const l = await engine.handleInbound(tid, { channel: "manual", phone: b.telefono, name: b.nombre, email: b.correo, text: b.mensaje || `Prospecto recibido por API${b.interes ? ": " + b.interes : ""}` });
    res.status(201).json({ id: l && l.id });
  });
  return r;
}

function publicMsgs(l, after) {
  return (l?.messages || []).filter((m) => m.at > after).map((m) => ({ from: m.from === "cliente" ? "cliente" : "empresa", text: m.text, at: m.at }));
}

function formPage(tid, company, priv) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contacto · ${esc(company)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&family=Public+Sans:wght@400;600&display=swap">
<style>body{margin:0;background:#EEF2F1;color:#15232B;font-family:"Public Sans",system-ui,sans-serif}main{max-width:480px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border-radius:12px;padding:20px;border:1px solid #D2DBDA}h1{font-family:"Barlow Condensed",sans-serif;font-size:30px;margin:0 0 4px;color:#1E3A4C}
label{display:block;font-size:13px;font-weight:600;margin-top:12px}input,textarea{width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #D2DBDA;border-radius:8px;font:inherit}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;background:#1E3A4C;color:#fff;font-weight:600;font-size:15px;cursor:pointer}.ok{color:#1F8A4C;font-weight:600}.err{color:#B93A27}
.chk{display:flex;gap:8px;font-weight:400;align-items:flex-start}.chk input{width:auto;margin-top:3px}</style></head><body><main><div class="card">
<h1>${esc(company)}</h1><p style="margin:0;color:#3E4F57">Déjenos sus datos y le escribimos en minutos.</p>
<form id="f"><label>Nombre completo<input name="name" required></label><label>WhatsApp o teléfono<input name="phone" inputmode="tel"></label><label>Correo<input name="email" type="email"></label>
<label>¿Qué le interesa?<input name="interest"></label><label>Mensaje<textarea name="msg" rows="3"></textarea></label>
${priv.on !== false ? `<label class="chk"><input type="checkbox" name="consent" required> Autorizo el tratamiento de mis datos personales según la política de ${esc(company)} (Ley 1581 de 2012).${priv.url ? ` <a href="${esc(priv.url)}" target="_blank">Ver política</a>` : ""}</label>` : ""}
<button>Enviar</button><p id="m" role="status"></p></form></div></main>
<script>document.getElementById("f").onsubmit=async e=>{e.preventDefault();const f=e.target,m=document.getElementById("m"),b=f.querySelector("button");b.disabled=true;
const d=Object.fromEntries(new FormData(f));d.consent=!!f.consent?.checked;try{const r=await fetch("/api/public/${tid}/form",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});const j=await r.json();
if(r.ok){f.innerHTML='<p class="ok">'+j.thanks+'</p>'}else{m.className="err";m.textContent=j.error;b.disabled=false}}catch{m.className="err";m.textContent="No se pudo enviar. Intente de nuevo.";b.disabled=false}}</script></body></html>`;
}

// Burbuja de chat para pegar en cualquier sitio web
const WIDGET = `(function(){var s=document.currentScript,T=s.getAttribute("data-empresa"),B=(new URL(s.src)).origin,C=s.getAttribute("data-color");
if(!T||window.__gcw)return;window.__gcw=1;var sid=localStorage.getItem("gcw_"+T);if(!sid){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);try{localStorage.setItem("gcw_"+T,sid)}catch(e){}}
var last=0,open=false,info={company:"",greeting:"Hola, ¿en qué le podemos ayudar?",color:C||"#1E3A4C"};
var st=document.createElement("style");st.textContent=".gcw-b{position:fixed;right:18px;bottom:18px;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25);z-index:2147483000;color:#fff;font:600 24px system-ui}.gcw-p{position:fixed;right:18px;bottom:88px;width:340px;max-width:calc(100vw - 36px);height:460px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font:14px system-ui;color:#15232B}.gcw-h{padding:12px 14px;color:#fff;font-weight:600}.gcw-m{flex:1;overflow:auto;padding:12px;background:#EEF2F1;display:flex;flex-direction:column;gap:8px}.gcw-x{max-width:82%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}.gcw-c{align-self:flex-end;background:#fff;border:1px solid #D2DBDA}.gcw-e{align-self:flex-start;background:#DCE6EC}.gcw-f{display:flex;gap:6px;padding:8px;border-top:1px solid #D2DBDA}.gcw-f input{flex:1;padding:9px;border:1px solid #D2DBDA;border-radius:8px;font:inherit}.gcw-f button{border:0;border-radius:8px;padding:0 14px;color:#fff;font-weight:600;cursor:pointer}";document.head.appendChild(st);
var b=document.createElement("button");b.className="gcw-b";b.setAttribute("aria-label","Abrir chat");b.textContent="💬";var p=document.createElement("div");p.className="gcw-p";p.innerHTML='<div class="gcw-h"></div><div class="gcw-m"></div><form class="gcw-f"><input placeholder="Escriba su mensaje" aria-label="Mensaje"><button>Enviar</button></form>';
document.body.appendChild(b);document.body.appendChild(p);var H=p.querySelector(".gcw-h"),M=p.querySelector(".gcw-m"),F=p.querySelector("form"),I=F.querySelector("input");
function col(){b.style.background=info.color;H.style.background=info.color;F.querySelector("button").style.background=info.color;H.textContent=info.company||"Chat"}
function add(m){var d=document.createElement("div");d.className="gcw-x "+(m.from==="cliente"?"gcw-c":"gcw-e");d.textContent=m.text;M.appendChild(d);M.scrollTop=M.scrollHeight;if(m.at>last)last=m.at}
fetch(B+"/api/public/"+T+"/info").then(function(r){return r.json()}).then(function(j){info=Object.assign(info,j);col();add({from:"empresa",text:info.greeting,at:0})}).catch(col);
function poll(){fetch(B+"/api/public/"+T+"/chat?sid="+sid+"&after="+last).then(function(r){return r.json()}).then(function(j){(j.messages||[]).forEach(add)}).catch(function(){})}
b.onclick=function(){open=!open;p.style.display=open?"flex":"none";if(open){poll();I.focus()}};setInterval(function(){if(open)poll()},5000);
F.onsubmit=function(e){e.preventDefault();var t=I.value.trim();if(!t)return;I.value="";add({from:"cliente",text:t,at:last});var w=document.createElement("div");w.className="gcw-x gcw-e";w.textContent="Escribiendo…";M.appendChild(w);
fetch(B+"/api/public/"+T+"/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sid:sid,text:t})}).then(function(r){return r.json()}).then(function(j){w.remove();(j.messages||[]).filter(function(m){return m.from!=="cliente"&&m.at>last}).forEach(add);(j.messages||[]).forEach(function(m){if(m.at>last)last=m.at})}).catch(function(){w.textContent="No se pudo enviar. Intente de nuevo."})}})();`;

module.exports = { router };
