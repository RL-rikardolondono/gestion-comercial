// Motor 24/7: respuesta automática con IA, seguimientos, cobros (Ley 2300), recordatorios de citas,
// mensualidades, resumen diario, envío real por canales y avisos a otros sistemas.
const db = require("./db");
const cobro = require("./cobro");
const ai = require("./ai");
const ch = require("./channels");
const docs = require("./docs");
const BOT = require("./bot");
const AI_ON = () => process.env.AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;

const SYSTEM = { id: "system", staff: true, role: "proveedor" };
const DAY = 864e5, TZ = -5; // Colombia, UTC-5 sin horario de verano
const local = (ts) => { const d = new Date(ts + TZ * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
const dayKey = (ts) => { const l = local(ts); return `${l.y}-${l.m + 1}-${l.d}`; };
const monthKey = (ts) => { const l = local(ts); return `${l.y}-${String(l.m + 1).padStart(2, "0")}`; };
const cop = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const fdt = (ts) => new Date(ts).toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
const fdate = (ts) => new Date(ts).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", year: "numeric" });

const PLAN_FEATS = { basico: ["autoReply"], pro: ["autoReply", "followup", "collect"], empresarial: ["autoReply", "followup", "collect", "sedes", "reports", "api"] };
const STAGE_ORDER = { nuevo: 0, contactado: 1, interesado: 2, propuesta: 3, ganado: 4, perdido: 5 };
const CH_LABEL = { whatsapp: "WhatsApp", web: "Chat web", email: "Correo", form: "Formulario", instagram: "Instagram", facebook: "Facebook" };
const TONES = { cercano: "cercano y amable", formal: "formal y profesional", entusiasta: "entusiasta y positivo" };

/* ---------- festivos de Colombia y Ley 2300 ---------- */
const holCache = {};
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(Date.UTC(y, mo - 1, da)); }
function holidays(y) {
  if (holCache[y]) return holCache[y];
  const out = new Set(), k = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  const fixed = (d) => out.add(k(d));
  const monday = (d) => { const x = new Date(d); const wd = x.getUTCDay(); if (wd !== 1) x.setUTCDate(x.getUTCDate() + ((8 - wd) % 7)); out.add(k(x)); };
  [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].forEach(([m, d]) => fixed(new Date(Date.UTC(y, m - 1, d))));
  [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].forEach(([m, d]) => monday(new Date(Date.UTC(y, m - 1, d))));
  const E = easter(y), add = (n) => { const x = new Date(E); x.setUTCDate(x.getUTCDate() + n); return x; };
  fixed(add(-3)); fixed(add(-2)); monday(add(39)); monday(add(60)); monday(add(68));
  return (holCache[y] = out);
}
const isHoliday = (ts) => { const l = local(ts); return holidays(l.y).has(`${l.y}-${l.m + 1}-${l.d}`); };
function collectAllowedAt(ts) { const l = local(ts), h = l.h + l.mi / 60; if (l.wd === 0 || isHoliday(ts)) return false; if (l.wd === 6) return h >= 8 && h < 15; return h >= 7 && h < 19; }

/* ---------- contexto de una empresa ---------- */
const BIZ_DEFAULT = { hours: { 1: [["08:00", "18:00"]], 2: [["08:00", "18:00"]], 3: [["08:00", "18:00"]], 4: [["08:00", "18:00"]], 5: [["08:00", "18:00"]], 6: [["08:00", "13:00"]], 0: [] }, slotMin: 30, remindHours: 24, agendaOn: true, services: [], catalog: [], assign: "off", rr: 0, slaMin: 15, privacy: { on: true, text: "Al escribirnos usted autoriza el tratamiento de sus datos personales para atender su solicitud, según la Ley 1581 de 2012. Si no desea recibir más mensajes, escriba BAJA.", url: "" }, survey: { on: true, text: "Gracias por elegirnos. ¿Cómo calificaría nuestra atención de 1 a 5?" }, digest: { on: false, to: "" } };
const COLLECT_DEFAULT = { enabled: true, thanks: true, payInfo: "", steps: [{ offset: -3, text: "Hola {nombre}, le recordamos que su pago de {saldo} por {concepto} vence el {vence}. {pago}" }, { offset: 0, text: "Hola {nombre}, hoy vence su pago de {saldo} por {concepto}. {pago}" }, { offset: 3, text: "{nombre}, su pago de {saldo} por {concepto} tiene 3 días de retraso. Si ya pagó, envíenos el comprobante." }, { offset: 10, text: "{nombre}, su cuenta {numero} por {saldo} sigue pendiente. Responda este mensaje para acordar el pago." }] };

async function loadTenant(tid) {
  const [t, cfg, conns, leads, invoices, appts, users, sedes, sec] = await Promise.all([
    db.getDoc(`tenants/${tid}`), db.getDoc(`tenants/${tid}/config/main`), db.getDoc(`tenants/${tid}/config/connections`),
    db.listCol(`tenants/${tid}/leads`), db.listCol(`tenants/${tid}/invoices`), db.listCol(`tenants/${tid}/appts`),
    db.listCol(`tenants/${tid}/users`), db.listCol(`tenants/${tid}/sedes`), db.getSecrets(tid)]);
  const config = cfg.exists ? cfg.data : { company: "Empresa", faqs: [], steps: [], autoReply: true };
  const b = config.biz || {};
  const biz = { ...BIZ_DEFAULT, ...b, hours: b.hours || BIZ_DEFAULT.hours, privacy: { ...BIZ_DEFAULT.privacy, ...(b.privacy || {}) }, survey: { ...BIZ_DEFAULT.survey, ...(b.survey || {}) }, digest: { ...BIZ_DEFAULT.digest, ...(b.digest || {}) } };
  const tenant = t.exists ? t.data : { plan: "pro", status: "activo" };
  return { tid, tenant, config, biz, conns: conns.exists ? conns.data : {}, sec,
    leads: new Map(leads.map((x) => [x.id, { ...x.data, id: x.id }])), invoices: invoices.map((x) => ({ ...x.data, id: x.id })),
    appts: appts.map((x) => ({ ...x.data, id: x.id })), users: users.map((x) => ({ ...x.data, id: x.id })), sedes: sedes.map((x) => ({ ...x.data, id: x.id })),
    feats: PLAN_FEATS[tenant.plan] || PLAN_FEATS.pro };
}
const saveLead = (ctx, l) => { const b = { ...l }; delete b.id; b.updatedAt = Date.now(); if (b.messages && b.messages.length > 60) b.messages = b.messages.slice(-60); ctx.leads.set(l.id, { ...b, id: l.id }); return docs.guardedWrite(SYSTEM, `tenants/${ctx.tid}/leads/${l.id}`, b); };
const saveInv = (ctx, i) => { const b = { ...i }; delete b.id; b.updatedAt = Date.now(); return docs.guardedWrite(SYSTEM, `tenants/${ctx.tid}/invoices/${i.id}`, b); };
const saveAppt = (ctx, a) => { const b = { ...a }; delete b.id; b.updatedAt = Date.now(); return docs.guardedWrite(SYSTEM, `tenants/${ctx.tid}/appts/${a.id}`, b); };

/* ---------- horario, agenda y textos ---------- */
const hm = (s) => { const [h, m] = String(s).split(":").map(Number); return (h || 0) * 60 + (m || 0); };
function isOpen(ctx, ts) { const l = local(ts); const r = ctx.biz.hours[l.wd] || []; const mins = l.h * 60 + l.mi; return !isHoliday(ts) && r.some(([a, b]) => mins >= hm(a) && mins < hm(b)); }
function nextOpen(ctx, ts) { for (let i = 0; i < 14 * 48; i++) { const t = ts + i * 30 * 60000; if (isOpen(ctx, t)) return t; } return null; }
function freeSlots(ctx, n = 8) {
  const step = (Number(ctx.biz.slotMin) || 30) * 60000, out = [], now = Date.now();
  const busy = new Set(ctx.appts.filter((a) => a.status !== "cancelada").map((a) => a.at));
  let t = Math.ceil((now + 3600e3) / 1800e3) * 1800e3;
  for (; t < now + 21 * DAY && out.length < n; t += step) if (isOpen(ctx, t) && isOpen(ctx, t + step - 60000) && !busy.has(t)) out.push(t);
  return out;
}
const isoLocal = (ts) => { const l = local(ts); const z = (n) => String(n).padStart(2, "0"); return `${l.y}-${z(l.m + 1)}-${z(l.d)}T${z(l.h)}:${z(l.mi)}`; };
const fromIsoLocal = (s) => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - TZ, +m[5]) : null; };
const first = (s) => String(s || "").replace(/^Ejemplo\s*·\s*/, "").split(" ")[0];
const fill = (ctx, t, l) => String(t || "").replaceAll("{nombre}", first(l.name)).replaceAll("{empresa}", ctx.config.company || "").replaceAll("{interes}", l.interest || "nuestros servicios").replace(/\s+,/g, ",").replace(/Hola ,/g, "Hola,").trim();
const paidOf = (i) => (i.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
const balOf = (i) => Math.max(0, (Number(i.amount) || 0) - paidOf(i));
const lateDays = (i) => Math.floor((Date.now() - (i.dueAt || 0)) / DAY);
function collectCfg(ctx) { const c = ctx.config.collect || {}; return { ...COLLECT_DEFAULT, ...c, steps: c.steps || COLLECT_DEFAULT.steps }; }
const fillCollect = (ctx, t, inv) => String(t || "").replaceAll("{nombre}", first(inv.client)).replaceAll("{empresa}", ctx.config.company || "").replaceAll("{valor}", cop(inv.amount)).replaceAll("{saldo}", cop(balOf(inv))).replaceAll("{concepto}", inv.concept || "su servicio").replaceAll("{vence}", fdate(inv.dueAt)).replaceAll("{numero}", inv.number || "").replaceAll("{pago}", collectCfg(ctx).payInfo || "").replace(/\s+/g, " ").trim();

function kbText(ctx) {
  const c = ctx.config, faqs = (c.faqs || []).map((f) => `- P: ${f.q}\n  R: ${f.a}`).join("\n");
  const sedes = ctx.feats.includes("sedes") && ctx.sedes.length ? "\nSEDES:\n" + ctx.sedes.map((x) => `- ${x.name}: ${[x.address, x.city, x.hours, x.phone].filter(Boolean).join(" | ")}`).join("\n") : "";
  return `EMPRESA: ${c.company}\nSECTOR: ${c.sector || ""}\nCIUDAD: ${c.city || ""}\nHORARIO: ${c.hours || ""}\nTELÉFONO: ${c.phone || ""}\nSERVICIOS Y PRECIOS:\n${c.services || ""}\nINFORMACIÓN ADICIONAL:\n${c.extra || ""}\nPREGUNTAS FRECUENTES:\n${faqs || "(ninguna)"}${sedes}`;
}

/* ---------- asignación automática ---------- */
async function autoAssign(ctx, l) {
  const b = ctx.biz; if (b.assign === "off" || !b.assign || l.owner) return;
  let pool = ctx.users.filter((u) => u.active !== false && u.role === "asesor");
  if (b.assign === "sede" && l.sede) { const p2 = pool.filter((u) => u.sede === l.sede); if (p2.length) pool = p2; }
  if (!pool.length) return;
  const i = (Number(b.rr) || 0) % pool.length; l.owner = pool[i].id; l.assignedAt = Date.now();
  ctx.config.biz = { ...b, rr: (Number(b.rr) || 0) + 1 }; ctx.biz.rr = ctx.config.biz.rr;
  await db.setDoc(`tenants/${ctx.tid}/config/main`, ctx.config);
}

/* ---------- respuesta con IA ---------- */
function ruleReply(ctx, l) {
  const last = norm((l.messages || []).filter((m) => m.from === "cliente").slice(-1)[0]?.text);
  const words = last.split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3);
  let best = null, bs = 0;
  for (const f of ctx.config.faqs || []) { const q = norm(f.q + " " + f.a); const s = words.filter((w) => q.includes(w)).length; if (s > bs) { bs = s; best = f; } }
  const human = /asesor|persona|humano|queja|reclamo/.test(last);
  if (best && bs > 0 && !human) return { reply: best.a + (l.name ? "" : " ¿Me regala su nombre para registrarlo?"), score: 45, stage: "interesado", handoff: false };
  return { reply: `Gracias por escribir a ${ctx.config.company}. ${human ? "Ya le aviso a un asesor para que lo contacte." : "Un asesor le responderá en breve."} ${l.name ? "" : "¿Me comparte su nombre y el servicio que le interesa?"}`.trim(), score: 30, stage: "contactado", handoff: human };
}
function botCtx(ctx) {
  const c = ctx.config, b = ctx.biz, DN = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const hoursText = c.hours || [1, 2, 3, 4, 5, 6, 0].map((d) => { const r = (b.hours[d] || []).map((x) => x.join(" a ")).join(" y "); return r ? `${DN[d]} ${r}` : null; }).filter(Boolean).join("; ");
  const no = nextOpen(ctx, Date.now());
  return { company: c.company, assistant: c.assistant, services: c.services, extra: c.extra, hoursText, phone: c.phone, faqs: c.faqs, catalog: b.catalog, payInfo: (ctx.config.collect || {}).payInfo || "", payLink: b.payLink,
    sedes: ctx.feats.includes("sedes") ? ctx.sedes : [], agendaOn: b.agendaOn, agendaServices: b.services, slots: (n) => freeSlots(ctx, n), fmt: fdt, openNow: isOpen(ctx, Date.now()), nextOpenText: no ? fdt(no) : "" };
}
async function aiReply(ctx, l) {
  const c = ctx.config, b = ctx.biz;
  if (!AI_ON()) { const last = (l.messages || []).filter((m) => m.from === "cliente").slice(-1)[0]; return BOT.reply(botCtx(ctx), l, last ? last.text : ""); }
  const convo = (l.messages || []).slice(-14).map((m) => (m.from === "cliente" ? "Cliente: " : "Empresa: ") + m.text).join("\n");
  const slots = b.agendaOn ? freeSlots(ctx, 8) : [];
  const prompt = `Eres "${c.assistant || "Asistente virtual"}", el asistente virtual de ${c.company}. Respondes por ${CH_LABEL[l.channel] || "chat"} a un cliente potencial.
Reglas:
- Español latinoamericano neutro; trata al cliente de "usted". Tono ${TONES[c.tone] || "amable"}.
- Respuesta corta, estilo chat: máximo 3 frases.
- Usa SOLO la información de la empresa. No inventes precios, horarios ni servicios. Si no sabes algo, o el cliente pide una persona, o tiene una queja, responde con amabilidad que un asesor lo contactará pronto y marca "handoff": true.
- Sin presionar, intenta conocer su nombre, qué necesita y un teléfono o correo, y propone el siguiente paso.

${kbText(ctx)}
${(b.catalog || []).length ? "CATÁLOGO:\n" + b.catalog.map((x) => `- ${x.n}: ${cop(x.p)}${x.d ? " (" + x.d + ")" : ""}`).join("\n") : ""}
${b.payLink ? "ENLACE DE PAGO: " + b.payLink : ""}
Ahora: ${fdt(Date.now())} (${isOpen(ctx, Date.now()) ? "abierto" : "cerrado"}).
${slots.length ? `AGENDA: servicios: ${(b.services || []).join(", ") || "cita"}. Horarios libres: ${slots.map((x) => isoLocal(x) + " (" + fdt(x) + ")").join("; ")}.
Si el cliente quiere una cita, ofrécele 2 o 3 horarios. Solo cuando confirme uno, llena "book" con ese horario (AAAA-MM-DDTHH:MM) y "service".` : ""}

LO QUE YA SABEMOS DEL CLIENTE: nombre=${l.name || "desconocido"}; teléfono=${l.phone || "—"}; correo=${l.email || "—"}; interés=${l.interest || "—"}

CONVERSACIÓN (la última línea es el mensaje nuevo):
${convo}

Responde SOLO con un objeto JSON:
{"reply":"","name":"","phone":"","email":"","interest":"3-6 palabras","score":0,"stage":"nuevo|contactado|interesado|propuesta","handoff":false,"book":"","service":"","unknown":"pregunta que no pudiste responder o vacío"}`;
  try { const r = await ai.askJSON(prompt, { tier: "quick", tid: ctx.tid }); if (r && typeof r.reply === "string" && r.reply.trim()) return { ...r, ai: true }; }
  catch (e) { console.error("IA", ctx.tid, e.message); }
  return ruleReply(ctx, l);
}

async function botAnswer(ctx, l) {
  const r = await aiReply(ctx, l), t = Date.now(), b = ctx.biz;
  let reply = String(r.reply).trim();
  if (b.privacy.on && !l.consentAsked) { reply = b.privacy.text + (b.privacy.url ? " Política: " + b.privacy.url : "") + "\n\n" + reply; l.consentAsked = t; l.consent = l.consent || "pendiente"; }
  if (r.botState !== undefined) l.bot = r.botState;
  if (!isOpen(ctx, t) && r.handoff && r.ai) { const no = nextOpen(ctx, t); if (no) reply += `\n\nEn este momento estamos fuera del horario de atención. Un asesor le escribirá ${fdt(no)}.`; }
  l.messages.push({ from: "bot", text: reply, at: t, ...(r.unknown ? { unknown: String(r.unknown).slice(0, 200) } : {}) });
  if (r.name && !l.name) l.name = String(r.name).slice(0, 80);
  if (r.phone && !l.phone) l.phone = String(r.phone).slice(0, 40);
  if (r.email && !l.email) l.email = String(r.email).slice(0, 80);
  if (r.interest) l.interest = String(r.interest).slice(0, 80);
  if (Number(r.score) > 0) l.score = Math.max(0, Math.min(100, Math.round(Number(r.score))));
  if (r.stage && STAGE_ORDER[r.stage] != null && STAGE_ORDER[r.stage] < 4 && STAGE_ORDER[r.stage] > STAGE_ORDER[l.stage]) setStage(l, r.stage);
  else if (l.stage === "nuevo") setStage(l, "contactado");
  l.handoff = !!r.handoff || l.handoff; l.awaiting = "cliente"; l.lastOutboundAt = t;
  if (r.book && b.agendaOn) {
    const at = typeof r.book === "number" ? r.book : fromIsoLocal(r.book);
    if (at && freeSlots(ctx, 60).includes(at)) {
      const a = { id: uid("ap"), leadId: l.id, client: l.name || l.phone || "Cliente", phone: l.phone || "", service: r.service || l.interest || "Cita", at, sede: l.sede || "", owner: l.owner || "", status: "programada", reminded: false, createdAt: t, by: "asistente" };
      ctx.appts.push(a); await saveAppt(ctx, a); if (STAGE_ORDER[l.stage] < 3) setStage(l, "propuesta");
    }
  }
  await saveLead(ctx, l);
}
function setStage(l, st) { if (l.stage === st) return; l.stageLog = [...(l.stageLog || [{ stage: l.stage || "nuevo", at: l.createdAt || Date.now() }]), { stage: st, at: Date.now() }].slice(-30); l.stage = st; }

/* ---------- mensaje entrante de un cliente (cualquier canal) ---------- */
const OPTOUT_RE = /\b(baja|stop|no (me )?(escriban|envien|manden) mas|no quiero (recibir )?mas mensajes|cancelar suscripcion)\b/;
const YES_RE = /^(si|sí|acepto|autorizo|de acuerdo|ok|listo|claro)\b/;
async function handleInbound(tid, { channel, key, phone, name, email, text, extId, sede }) {
  if (extId) { if (await db.kvGet("in:" + extId)) return null; await db.kvSet("in:" + extId, Date.now()); }
  const ctx = await loadTenant(tid);
  const t = Date.now(), nt = norm(text).trim();
  let l = [...ctx.leads.values()].find((x) => (key && x.extKey === key) || (phone && ch.digits(x.phone).slice(-10) === ch.digits(phone).slice(-10) && ch.digits(phone).length >= 7));
  if (!l) {
    l = { id: uid("l"), name: name || "", phone: phone || "", email: email || "", channel, extKey: key || "", interest: "", stage: "nuevo", score: 20, value: 0, notes: "", sede: sede || "", createdAt: t, updatedAt: t, lastInboundAt: 0, lastOutboundAt: 0, awaiting: "", followStep: 0, followPaused: false, handoff: false, messages: [], stageLog: [{ stage: "nuevo", at: t }] };
    await autoAssign(ctx, l); fireWebhook(ctx, "prospecto_nuevo", l);
  }
  if (!l.extKey && key) l.extKey = key;
  if (name && !l.name) l.name = name;
  l.messages.push({ from: "cliente", text, at: t, ...(extId ? { ext: extId } : {}) });
  l.lastInboundAt = t;
  if (OPTOUT_RE.test(nt)) { l.optOut = t; l.followPaused = true; l.messages.push({ from: "auto", text: `Entendido. No le enviaremos más mensajes de ${ctx.config.company}. Si necesita algo, escríbanos.`, at: t + 1 }); l.awaiting = "cliente"; l.lastOutboundAt = t + 1; await saveLead(ctx, l); return l; }
  if (l.awaitSurvey && /^[1-5]$/.test(nt)) { l.csat = Number(nt); l.awaitSurvey = false; l.messages.push({ from: "auto", text: Number(nt) >= 4 ? "¡Muchas gracias por su calificación!" : "Gracias por su sinceridad. Un responsable revisará su caso.", at: t + 1 }); if (Number(nt) <= 3) { l.handoff = true; l.awaiting = "empresa"; } else l.awaiting = "cliente"; l.lastOutboundAt = t + 1; await saveLead(ctx, l); return l; }
  if (ctx.biz.privacy.on && l.consent !== "aceptado" && l.consentAsked && YES_RE.test(nt)) { l.consent = "aceptado"; l.consentAt = t; }
  l.awaiting = "empresa"; l.followStep = 0; if (l.stage === "perdido") setStage(l, "contactado");
  await saveLead(ctx, l);
  const canBot = ctx.config.autoReply !== false && !l.followPaused && ctx.tenant.status !== "suspendido" && !cobro.cerrada(ctx.tenant) && !(l.handoff && l.owner);
  if (canBot) await botAnswer(ctx, l);
  return ctx.leads.get(l.id);
}

/* ---------- envío real de lo que la app escribe (bandeja de salida) ---------- */
const OUT = new Set(["bot", "auto", "agente"]);
async function dispatchLead(tid, path, l) {
  if (!l || l.demo || l.sim || !Array.isArray(l.messages)) return;
  const now = Date.now();
  const pending = l.messages.filter((m) => OUT.has(m.from) && !m.d && now - (m.at || 0) < 15 * 60000);
  if (!pending.length) return;
  const ctx = await loadTenant(tid);
  const st = (k) => (ctx.conns[k] || {}).status === "activo";
  for (const m of pending) {
    try {
      if (l.optOut && m.from === "auto" && !/No le enviaremos más/.test(m.text)) { m.d = "omitido: pidió baja"; continue; }
      if (l.channel === "web") m.d = "web";
      else if (l.channel === "instagram" || l.channel === "facebook") { if (!st(l.channel === "instagram" ? "instagram" : "facebook") || !l.extKey) throw new Error("canal no activo"); await ch.sendPage(ctx.sec, l.extKey.split(":").pop(), m.text); m.d = "ok"; }
      else if (l.phone && st("whatsapp")) { await ch.sendWhatsApp(ctx.sec, l.phone, m.text, { lastInboundAt: l.lastInboundAt, company: ctx.config.company }); m.d = "ok"; }
      else if (l.email && ch.digits(l.email) !== l.email && process.env.SMTP_URL) { await ch.sendEmail(l.email, `Mensaje de ${ctx.config.company}`, m.text); m.d = "ok"; }
      else m.d = "sin canal activo";
    } catch (e) { m.d = "error: " + String(e.message).slice(0, 120); }
    m.dAt = Date.now();
  }
  await db.setDoc(path, (({ id, ...x }) => x)(l)); // sin ganchos, para no repetir el envío
}
async function dispatchInvoice(tid, path, inv) {
  if (!inv || inv.demo || inv.leadId) return; // si tiene prospecto, el mensaje ya sale por la conversación
  const pending = (inv.reminders || []).filter((r) => !r.d && Date.now() - (r.at || 0) < 15 * 60000);
  if (!pending.length) return;
  const ctx = await loadTenant(tid);
  for (const r of pending) {
    try {
      if ((inv.channel || "whatsapp") === "whatsapp" && (ctx.conns.whatsapp || {}).status === "activo" && inv.phone) { await ch.sendWhatsApp(ctx.sec, inv.phone, r.text, { company: ctx.config.company }); r.d = "ok"; }
      else if (inv.email && process.env.SMTP_URL) { await ch.sendEmail(inv.email, `Recordatorio de pago · ${ctx.config.company}`, r.text); r.d = "ok"; }
      else r.d = "sin canal activo";
    } catch (e) { r.d = "error: " + String(e.message).slice(0, 120); }
  }
  await db.setDoc(path, (({ id, ...x }) => x)(inv));
}
async function dispatchBilling(path, b) {
  const pending = (b.reminders || []).filter((r) => !r.d && Date.now() - (r.at || 0) < 15 * 60000);
  if (!pending.length) return;
  const users = await db.listCol(`tenants/${b.tid}/users`);
  const admins = users.map((u) => u.data).filter((u) => u.role === "admin" && u.active !== false && u.email);
  const cfg = await db.getDoc(`tenants/${b.tid}/config/main`);
  const psec = await db.getSecrets("_platform");
  for (const r of pending) {
    const out = [];
    for (const a of admins) { try { await ch.sendEmail(a.email, `Gestión ComercIAl · ${b.concept}`, r.text); out.push("correo"); } catch {} }
    const phone = cfg.exists && cfg.data.phone;
    if (phone && psec.wa_phone_id) { try { await ch.sendWhatsApp(psec, phone, r.text, { company: "Gestión ComercIAl" }); out.push("WhatsApp"); } catch {} }
    r.d = out.length ? "ok: " + out.join(", ") : "sin canal (configure SMTP o el WhatsApp de la plataforma)";
  }
  await db.setDoc(path, (({ id, ...x }) => x)(b));
}

/* ---------- avisos a otros sistemas (webhook de salida) ---------- */
function fireWebhook(ctx, event, l) {
  const c = ctx.conns.webhook; if (!c || c.status !== "activo" || !c.data?.outUrl) return;
  const ev = c.data.events || "Ambos";
  if (event === "prospecto_nuevo" && ev === "Un prospecto cambia de etapa") return;
  if (event === "cambio_etapa" && ev === "Llega un prospecto nuevo") return;
  fetch(c.data.outUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evento: event, empresa: ctx.config.company, prospecto: { id: l.id, nombre: l.name, telefono: l.phone, correo: l.email, canal: l.channel, interes: l.interest, etapa: l.stage, valor: l.value } }) }).catch(() => {});
}

/* ---------- tareas programadas ---------- */
async function runFollowups(ctx) {
  if (!ctx.feats.includes("followup") || ctx.config.autoFollow === false) return;
  const steps = ctx.config.steps || [];
  for (const l of ctx.leads.values()) {
    if (l.demo || l.sim || l.optOut || l.followPaused || l.awaiting !== "cliente" || !l.lastOutboundAt || ["ganado", "perdido"].includes(l.stage)) continue;
    const i = l.followStep || 0; if (i >= steps.length) continue;
    if (Date.now() < l.lastOutboundAt + (Number(steps[i].hours) || 0) * 3600e3) { due(l.lastOutboundAt + (Number(steps[i].hours) || 0) * 3600e3); continue; }
    let text = fill(ctx, steps[i].text, l);
    if (ctx.config.aiFollow && AI_ON()) { try { text = (await ai.ask(`Personaliza este mensaje de seguimiento de ${ctx.config.company} para un cliente que no ha respondido. Máximo 2 frases, español neutro, "usted", sin presionar. Mensaje base: "${text}". Interés: ${l.interest || "—"}. Devuelve solo el texto.`, { tid: ctx.tid })).text || text; } catch {} }
    l.messages.push({ from: "auto", text, at: Date.now(), step: i + 1 }); l.lastOutboundAt = Date.now(); l.followStep = i + 1;
    await saveLead(ctx, l);
  }
}
async function runCollect(ctx) {
  if (!ctx.feats.includes("collect")) return;
  const c = collectCfg(ctx); if (!c.enabled) return;
  if (!collectAllowedAt(Date.now())) { if (ctx.invoices.some((i) => !i.demo && balOf(i) > 0)) due(Date.now() + 30 * 60000); return; }
  for (const inv of ctx.invoices) {
    if (inv.demo || inv.paused || balOf(inv) <= 0) continue;
    const sent = inv.sent || []; let k = c.steps.findIndex((_, i) => !sent.includes(i)); if (k < 0) continue;
    if (Date.now() < inv.dueAt + (Number(c.steps[k].offset) || 0) * DAY) { due(inv.dueAt + (Number(c.steps[k].offset) || 0) * DAY); continue; }
    while (k + 1 < c.steps.length && inv.dueAt + (Number(c.steps[k + 1].offset) || 0) * DAY <= Date.now()) k++;
    const same = ctx.invoices.filter((o) => (o.leadId && o.leadId === inv.leadId) || (o.phone && o.phone === inv.phone));
    if (same.some((o) => (o.reminders || []).some((r) => dayKey(r.at) === dayKey(Date.now())))) continue; // máximo uno por día
    const text = fillCollect(ctx, c.steps[k].text, inv), at = Date.now();
    inv.reminders = [...(inv.reminders || []), { at, text, step: k + 1, auto: true, channel: inv.channel || "whatsapp" }].slice(-40);
    inv.sent = [...new Set([...sent, ...Array.from({ length: k + 1 }, (_, i) => i)])];
    await saveInv(ctx, inv);
    const l = inv.leadId && ctx.leads.get(inv.leadId);
    if (l) { l.messages.push({ from: "auto", text, at, cobro: true }); l.lastOutboundAt = at; await saveLead(ctx, l); }
  }
}
async function runAppts(ctx) {
  if (!ctx.biz.agendaOn) return;
  for (const a of ctx.appts) {
    if (a.status !== "programada" || a.reminded) continue;
    if (a.at - Date.now() > (Number(ctx.biz.remindHours) || 24) * 3600e3) { due(a.at - (Number(ctx.biz.remindHours) || 24) * 3600e3); continue; }
    if (a.at < Date.now()) continue;
    a.reminded = true; await saveAppt(ctx, a);
    const l = ctx.leads.get(a.leadId);
    if (l && !l.optOut) { l.messages.push({ from: "auto", text: `Hola ${first(a.client)}, le recordamos su cita de ${a.service} el ${fdt(a.at)} en ${ctx.config.company}. Responda SÍ para confirmar o escríbanos si necesita cambiarla.`, at: Date.now(), appt: a.id }); l.lastOutboundAt = Date.now(); await saveLead(ctx, l); }
  }
}
async function runDigest(ctx) {
  const d = ctx.biz.digest; if (!d.on || !d.to) return;
  const l = local(Date.now()); const at19 = Date.UTC(l.y, l.m, l.d, 19 - TZ, 0);
  if (l.h < 19) { due(at19); return; } due(at19 + DAY);
  const k = `digest:${ctx.tid}:${dayKey(Date.now())}`; if (await db.kvGet(k)) return; await db.kvSet(k, Date.now());
  const L = [...ctx.leads.values()], today = (ts) => ts && dayKey(ts) === dayKey(Date.now());
  const won = L.filter((x) => x.stage === "ganado" && today(x.wonAt));
  const rec = ctx.invoices.flatMap((i) => (i.payments || []).filter((p) => today(p.at))).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const mora = ctx.invoices.filter((i) => balOf(i) > 0 && lateDays(i) > 0);
  const text = `Resumen de ${ctx.config.company} · ${fdate(Date.now())}
• Prospectos nuevos hoy: ${L.filter((x) => today(x.createdAt)).length}
• Ventas ganadas hoy: ${won.length} (${cop(won.reduce((s, x) => s + (Number(x.value) || 0), 0))})
• Clientes esperando respuesta: ${L.filter((x) => !["ganado", "perdido"].includes(x.stage) && (x.awaiting === "empresa" || x.handoff)).length}
• Recaudado hoy: ${cop(rec)}
• Cartera en mora: ${cop(mora.reduce((s, i) => s + balOf(i), 0))} en ${mora.length} cuentas
• Citas de mañana: ${ctx.appts.filter((a) => a.status === "programada" && dayKey(a.at) === dayKey(Date.now() + DAY)).length}`;
  try {
    if (/@/.test(d.to)) await ch.sendEmail(d.to, `Resumen del día · ${ctx.config.company}`, text);
    else if ((ctx.conns.whatsapp || {}).status === "activo") await ch.sendWhatsApp(ctx.sec, d.to, text, { company: ctx.config.company });
  } catch (e) { console.error("resumen", ctx.tid, e.message); }
}
async function runBilling() {
  const s = await db.getDoc("platform/settings"); const bc = (s.exists && s.data.billing) || {};
  if (bc.enabled === false) return;
  if (!collectAllowedAt(Date.now())) { due(Date.now() + 30 * 60000); return; }
  const steps = bc.steps || [{ offset: -3, text: "Hola {empresa}, su mensualidad de {periodo} por {saldo} vence el {vence}. {pago}" }, { offset: 0, text: "Hola {empresa}, hoy vence su mensualidad de {periodo} por {saldo}. {pago}" }, { offset: 5, text: "{empresa}, su mensualidad de {periodo} por {saldo} tiene 5 días de retraso." }, { offset: 15, text: "{empresa}, su mensualidad de {periodo} sigue pendiente ({saldo}). Comuníquese con nosotros para evitar la suspensión." }];
  const MES = (m) => { const [y, mm] = String(m).split("-"); return mm ? ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][Number(mm) - 1] + " " + y : ""; };
  for (const x of await db.listCol("billing")) {
    const b = x.data; if (b.paused || balOf(b) <= 0) continue;
    const sent = b.sent || []; let k = steps.findIndex((_, i) => !sent.includes(i)); if (k < 0) continue;
    if (Date.now() < b.dueAt + (Number(steps[k].offset) || 0) * DAY) { due(b.dueAt + (Number(steps[k].offset) || 0) * DAY); continue; }
    while (k + 1 < steps.length && b.dueAt + (Number(steps[k + 1].offset) || 0) * DAY <= Date.now()) k++;
    if ((b.reminders || []).some((r) => dayKey(r.at) === dayKey(Date.now()))) continue;
    const tpl = b.period ? String(steps[k].text) : String(steps[k].text).replace(/mensualidad de Gestión ComercIAl de \{periodo\}|mensualidad de \{periodo\}/g, "pago de {periodo}");
    const text = tpl.replaceAll("{empresa}", b.tenantName || "").replaceAll("{periodo}", b.period ? MES(b.period) : b.concept || "").replaceAll("{saldo}", cop(balOf(b))).replaceAll("{valor}", cop(b.amount)).replaceAll("{vence}", fdate(b.dueAt)).replaceAll("{numero}", b.number || "").replaceAll("{pago}", bc.payInfo || "").replace(/\s+/g, " ").trim();
    b.reminders = [...(b.reminders || []), { at: Date.now(), text, step: k + 1, auto: true }].slice(-30);
    b.sent = [...new Set([...sent, ...Array.from({ length: k + 1 }, (_, i) => i)])];
    await docs.guardedWrite(SYSTEM, "billing/" + x.id, b);
  }
}

// Ahorro de Neon: solo se consulta la base cuando algo cambió o cuando hay algo por enviar.
let busy = false, dirty = true, nextDue = 0;
const due = (t) => { if (t && t > Date.now()) dueList.push(t); };
let dueList = [];
const markDirty = () => { dirty = true; };
async function tick(only, force) {
  if (busy) return { ran: false, busy: true };
  if (!force && !only && !dirty && Date.now() < nextDue) return { ran: false, nextDue };
  busy = true; dirty = false; dueList = [];
  try {
    const tenants = await db.listCol("tenants");
    for (const t of tenants) {
      if (only && t.id !== only) continue;
      if (t.data.status === "suspendido" || cobro.cerrada(t.data)) continue;
      try { const ctx = await loadTenant(t.id); await runFollowups(ctx); await runCollect(ctx); await runAppts(ctx); await runDigest(ctx); }
      catch (e) { console.error("tick", t.id, e.message); }
    }
    if (!only) await runBilling();
    nextDue = Math.min(Date.now() + 6 * 3600e3, ...dueList);
    return { ran: true, nextDue };
  } catch (e) { dirty = true; throw e; } finally { busy = false; }
}

// Ganchos: envío real y avisos cuando la app guarda algo
docs.onWrite(async ({ path, data, prev }) => {
  markDirty();
  const s = path.split("/");
  if (s[0] === "tenants" && s[2] === "leads" && s.length === 4) {
    await dispatchLead(s[1], path, { ...data, id: s[3] });
    if (prev && prev.stage !== data.stage) { const ctx = await loadTenant(s[1]); fireWebhook(ctx, "cambio_etapa", { ...data, id: s[3] }); }
    else if (!prev) { const ctx = await loadTenant(s[1]); fireWebhook(ctx, "prospecto_nuevo", { ...data, id: s[3] }); }
  }
  if (s[0] === "tenants" && s[2] === "invoices" && s.length === 4) await dispatchInvoice(s[1], path, { ...data, id: s[3] });
  if (s[0] === "billing" && s.length === 2) await dispatchBilling(path, data);
});

module.exports = { markDirty, tick, handleInbound, loadTenant, collectAllowedAt, isHoliday, botAnswer, fromIsoLocal, isoLocal };
