// Simulación de 3 años de servicio con reloj acelerado (solo para pruebas; usa una base de datos local).
//   DATABASE_URL=postgres://... node server/simular.js [semilla]
// Crea varias empresas, recibe conversaciones todos los días, genera cobros, pagos con Bold (sistema central simulado), cierres el día 5,
// y corre el motor como lo haría el servidor. Revisa reglas y mide tamaño y velocidad mes a mes.
const RealDate = Date; const rn = RealDate.now.bind(RealDate); let OFF = 0;
class FDate extends RealDate { constructor(...a) { if (a.length === 0) super(rn() + OFF); else super(...a); } static now() { return rn() + OFF; } }
global.Date = FDate;
const START = RealDate.UTC(2026, 10, 1, 12, 0); // 1 nov 2026, 7:00 a. m. Bogotá
OFF = START - rn();
const setTime = (ts) => { OFF = ts - rn(); };

process.env.PORT = process.env.PORT || "3399";
process.env.SIMULACION_LOCAL = "1"; process.env.ADMIN_EMAIL = "prov@sim.co"; process.env.ADMIN_PASSWORD = "Simula12345"; process.env.META_VERIFY_TOKEN = "x";
process.env.JWT_SECRET = "sim"; process.env.SECRET_KEY = "sim"; process.env.CRON_SECRET = "c";
let seed = Number(process.argv[2] || 1); const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const B = "http://localhost:" + process.env.PORT;
const call = (tok, m, u, b) => fetch(B + u, { method: m, headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.0." + Math.floor(rnd() * 250) + "." + Math.floor(rnd() * 250), ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ s: r.status, b: await r.json().catch(() => ({})), bytes: Number(r.headers.get("content-length") || 0) }));

const problems = []; const bad = (msg) => { if (problems.length < 400) problems.push(new Date().toISOString().slice(0, 10) + " " + msg); };
const DAY = 864e5, TZ = -5;
const local = (ts) => { const d = new RealDate(ts + TZ * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours() }; };
const mk = (ts) => { const l = local(ts); return `${l.y}-${String(l.m + 1).padStart(2, "0")}`; };

(async () => {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")) { console.error("La simulación borra la base de datos: úsela solo con una base local (localhost)."); process.exit(1); }
  // Sistema central de pagos simulado (firmador y verificador de skynetgenesis.com)
  const MOCK = { pagos: {} }, MPORT = Number(process.env.PORT) + 100;
  require("http").createServer((req, res) => {
    const u = new URL(req.url, "http://x"); res.setHeader("Content-Type", "application/json");
    if (u.pathname === "/verificar") { const q = u.searchParams; const p = q.get("pago") ? MOCK.pagos[q.get("pago")] : Object.values(MOCK.pagos).find((x) => x.referencia === q.get("ref")); return res.end(JSON.stringify(p ? { ok: true, orden: p } : { ok: false })); }
    if (u.pathname === "/firma") { // el firmador central cobra por su propia tabla de precios ($PLANES)
      const PR = { basico: 190000, pro: 390000, empresarial: 790000, sede: 150000 }; const pl = (u.searchParams.get("plan") || "").replace(/^agente-ia:/, "");
      const pq = pl.match(/^paq_(\w+?)(?:_sede-x(\d+))?$/); const amount = pq ? PR[pq[1]] + Number(pq[2] || 0) * PR.sede : PR[pl] || 0;
      return res.end(JSON.stringify({ orderId: "SG-" + Math.random().toString(36).slice(2), amount, currency: "COP", apiKey: "k", signature: "s" })); }
    res.statusCode = 404; res.end("{}");
  }).listen(MPORT);
  process.env.BOLD_FIRMA = `http://localhost:${MPORT}/firma`; process.env.BOLD_VERIFICAR = `http://localhost:${MPORT}/verificar`;
  let nPago = 0, aplicados = 0;
  const db = require("./db");
  await db.pool.query("DROP TABLE IF EXISTS docs, auth_users, secrets, leases, kv CASCADE");
  require("./index");
  await new Promise((r) => setTimeout(r, 1500));
  const engine = require("./engine"), cobro = require("./cobro");
  const ch = require("./channels"); const mails = []; process.env.BREVO_API_KEY = "sim";
  ch.sendEmail = async (to, subject, text) => { mails.push({ to, subject, at: Date.now() }); return "ok"; };
  let P = (await call(null, "POST", "/api/auth/login", { email: "prov@sim.co", password: "Simula12345" })).b.token, pSince = 0;
  await call(P, "PUT", "/api/doc", { path: "platform/settings", data: { pricing: { install: 350000, basic: 190000, pro: 390000, biz: 790000, sede: 150000 }, billing: { enabled: true } } });
  // Empresas: comportamiento de pago distinto
  const T = [
    { id: "ta", name: "Clínica Alfa", plan: "empresarial", pay: "puntual", daily: 7 },
    { id: "tb", name: "Taller Beta", plan: "pro", pay: "tarde", daily: 4 },
    { id: "tc", name: "Tienda Gamma", plan: "basico", pay: "moroso", daily: 2 },
    { id: "td", name: "Colegio Delta", plan: "pro", pay: "puntual", daily: 3, from: 200, trial: true } // llega en el día 200 con 15 días de prueba
  ];
  const tok = {};
  async function addTenant(t) {
    const createdAt = Date.now();
    await call(P, "PUT", "/api/doc", { path: "tenants/" + t.id, data: t.trial ? { name: t.name, plan: t.plan, status: "activo", createdAt, trialUntil: cobro.addD(cobro.HOY(), 14) } : { name: t.name, plan: t.plan, status: "activo", createdAt, paidUntil: cobro.finMes(cobro.HOY()) } });
    await call(P, "PUT", "/api/doc", { path: `tenants/${t.id}/config/main`, data: { company: t.name, autoReply: true, autoFollow: true, steps: [{ hours: 4, text: "Hola {nombre}, ¿pudo revisar la información?" }, { hours: 48, text: "{nombre}, seguimos atentos." }], faqs: [{ q: "¿Cuánto cuesta?", a: "Desde $50.000." }, { q: "¿Dónde están?", a: "En Santa Marta." }], biz: { agendaOn: true, services: ["Consulta"], assign: "rr", digest: { on: true, to: "dueño@" + t.id + ".co" } }, collect: { enabled: true } } });
    await call(P, "PUT", "/api/doc", { path: `tenants/${t.id}/config/connections`, data: { web: { status: "activo", data: {} } } });
    await call(P, "POST", "/api/auth/users", { tid: t.id, id: "uadm-" + t.id, name: "Admin " + t.name, email: "admin@" + t.id + ".co", password: "Admin12345", role: "admin" });
    await call(P, "POST", "/api/auth/users", { tid: t.id, id: "uase-" + t.id, name: "Asesor " + t.name, email: "asesor@" + t.id + ".co", password: "Asesor12345", role: "asesor" });
    t.on = true;
  }
  const login = async (t) => { const r = await call(null, "POST", "/api/auth/login", { email: "admin@" + t.id + ".co", password: "Admin12345" }); tok[t.id] = r.b.token; return r.b.token; };
  const metrics = []; let tickMs = [], inMs = [], nIn = 0, sessions = {}, restored = 0; const custs = []; let surveys = 0, problemsSent = 0, resolved = 0;
  const t0 = rn();
  const DAYS = Number(process.env.SIM_DAYS || 1096);
  for (let d = 0; d < DAYS; d++) {
    const day0 = START + d * DAY; // 7:00 a. m.
    setTime(day0);
    for (const t of T) if (!t.on && d >= (t.from || 0)) await addTenant(t);
    const L = local(day0);
    if (d - pSince >= 29) { P = (await call(null, "POST", "/api/auth/login", { email: "prov@sim.co", password: "Simula12345" })).b.token; pSince = d; }
    // JWT dura 30 días: cada empresa vuelve a ingresar cuando vence
    for (const t of T) if (t.on && (!sessions[t.id] || d - sessions[t.id] >= 29)) { await login(t); sessions[t.id] = d; }
    // Proveedor: el día 1 genera las mensualidades (como lo haría la app) si el servidor no lo hizo
    if (L.d === 1 && process.env.SIM_CLIENT_GEN) {
      const bills = (await call(P, "GET", "/api/col?path=billing")).b.docs.map((x) => x.data);
      const per = mk(day0);
      for (const t of T) if (t.on && !bills.some((b) => b.tid === t.id && b.period === per && b.kind === "mensualidad")) {
        const fee = { basico: 190000, pro: 390000, empresarial: 790000 }[t.plan];
        await call(P, "PUT", "/api/doc", { path: "billing/bl-" + t.id + "-" + per, data: { kind: "mensualidad", number: "MEN-" + per + "-" + t.id, tid: t.id, tenantName: t.name, period: per, plan: t.plan, concept: "Mensualidad", amount: fee, issuedAt: Date.now(), dueAt: RealDate.UTC(L.y, L.m, 5, 17), payments: [], reminders: [], sent: [], createdAt: Date.now() } });
      }
    }
    // Pagos con Bold según el comportamiento de cada empresa (paga el administrador; Bold avisa al sistema central y este al servidor)
    for (const t of T) {
      if (!t.on) continue;
      const tn0 = (await call(P, "GET", "/api/doc?path=tenants/" + t.id)).b.data; const e0 = cobro.estado(tn0);
      const payDay = t.pay === "puntual" ? 3 : t.pay === "tarde" ? 8 : (L.m % 3 === 0 ? 12 : 99);
      // La empresa en prueba paga cuando le faltan pocos días (no pierde días de prueba)
      const debePagar = e0.k === "prueba" ? e0.dias === 3 : (L.d === payDay && cobro.pagadoHasta(tn0) < cobro.finMes(cobro.HOY()));
      if (debePagar) {
        setTime(day0 + 2 * 3600e3);
        const FI = await call(tok[t.id], "POST", "/api/bold/firma", {});
        if (FI.s !== 200) { bad(`${t.name}: no pudo pedir la firma del pago (${FI.s} ${FI.b.error})`); continue; }
        const id = "PG" + (++nPago), antes = cobro.pagadoHasta(tn0);
        MOCK.pagos[id] = { pago_id: id, plan: FI.b.plan, empresa: t.id, valor: FI.b.valor, referencia: "REF" + nPago, meses: 1, app: "agente-ia" };
        const r = await call(null, "POST", "/api/bold/aplicar", { pago_id: id });
        if (r.s !== 200) bad(`${t.name}: el aviso de Bold no se aplicó (${r.s})`);
        if (rnd() < 0.2) await call(null, "POST", "/api/bold/aplicar", { pago_id: id }); // Bold reintenta el aviso a veces
        if (rnd() < 0.3) await call(tok[t.id], "GET", "/api/bold/volver?ref=REF" + nPago); // y la empresa vuelve de la pasarela
        const tn1 = (await call(P, "GET", "/api/doc?path=tenants/" + t.id)).b.data; aplicados++;
        if (tn1.paidUntil !== FI.b.hasta) bad(`${t.name}: «Pagado hasta» quedó en ${tn1.paidUntil} y la pantalla prometía ${FI.b.hasta}`);
        if (tn1.paidUntil <= antes && e0.k !== "prueba") bad(`${t.name}: el pago no avanzó «Pagado hasta» (${antes} → ${tn1.paidUntil})`);
      }
    }
    // Clientes escriben durante el día
    for (const t of T) {
      if (!t.on) continue;
      const tn = (await call(P, "GET", "/api/doc?path=tenants/" + t.id)).b.data;
      const st = cobro.estado(tn);
      for (let k = 0; k < t.daily; k++) {
        setTime(day0 + (1 + k) * 3600e3 * 1.5);
        const sid = "s" + d + "-" + k + "-" + t.id;
        const a = rn();
        const r = await call(null, "POST", `/api/public/${t.id}/chat`, { sid, text: pick(["Hola, ¿cuánto cuesta?", "¿Dónde están ubicados?", "Quiero una cita", "Necesito hablar con un asesor", "Buenas, información por favor"]) });
        inMs.push(rn() - a); nIn++;
        if (st.k === "cerrada" && r.s === 200) bad(`${t.name}: el chat respondió estando cerrada por pago`);
        if (st.k !== "cerrada" && r.s !== 200) bad(`${t.name}: el chat falló (${r.s} ${r.b.error})`);
        if (rnd() < 0.05 && st.k !== "cerrada") await call(null, "POST", `/api/public/${t.id}/chat`, { sid, text: "BAJA" });
        // Algunos clientes vuelven a escribir con el mismo celular otro día
        if (rnd() < 0.3 && st.k !== "cerrada") await call(null, "POST", `/api/public/${t.id}/form`, { name: "Cliente " + d + k, phone: "300" + String(1000000 + Math.floor(rnd() * 400)), consent: true, interest: "Consulta" });
      }
      // El asesor cierra algunos negocios y crea cobros a clientes (cuentas por cobrar)
      if (st.k !== "cerrada" && L.wd >= 1 && L.wd <= 5) {
        setTime(day0 + 10 * 3600e3);
        if (t.plan !== "basico" && rnd() < 0.5) {
          const id = "iv" + d + t.id;
          const w = await call(tok[t.id], "PUT", "/api/doc", { path: `tenants/${t.id}/invoices/${id}`, data: { number: "CXC-" + d, client: "Cliente " + d, phone: "3001112233", concept: "Servicio", amount: 120000, issuedAt: Date.now(), dueAt: Date.now() + 5 * DAY, payments: rnd() < 0.5 ? [{ amount: 120000, at: Date.now() + 6 * DAY }] : [], reminders: [], sent: [], channel: "email", email: "cliente@sim.co" } });
          if (w.s !== 200) bad(`${t.name}: no pudo crear cuenta por cobrar (${w.s})`);
        }
      }
    }
    // Posventa: cada martes el asesor cierra una venta; los jueves los clientes responden encuestas, reportan problemas y el asesor resuelve casos
    for (const t of T) {
      if (!t.on || t.plan === "basico") continue;
      const tn = (await call(P, "GET", "/api/doc?path=tenants/" + t.id)).b.data; if (cobro.estado(tn).k === "cerrada") continue;
      if (L.wd === 2) {
        setTime(day0 + 11 * 3600e3);
        const ld = (await call(tok[t.id], "GET", `/api/col?path=tenants/${t.id}/leads`)).b.docs.find((x) => x.data.extKey === `web:s${d}-0-${t.id}`);
        if (ld) { const md = () => String(1 + Math.floor(rnd() * 12)).padStart(2, "0") + "-" + String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
          const famOk = rnd() < 0.5; const c = { tid: t.id, id: ld.id, sid: `s${d}-0-${t.id}`, famOk };
          const w = await call(tok[t.id], "PUT", "/api/doc", { path: `tenants/${t.id}/leads/${ld.id}`, data: { ...ld.data, name: "Cliente " + d, stage: "ganado", wonAt: Date.now(), purchase: "Servicio " + d, birthday: "1980-" + md(), famOk, family: [{ name: "Hijo" + d, rel: "hijo", bday: "2015-" + md() }], dates: rnd() < 0.3 ? [{ label: "Aniversario de bodas", date: "2000-" + md() }] : [] } });
          if (w.s !== 200) bad(`${t.name}: no pudo marcar un cliente como ganado (${w.s})`); else custs.push(c); }
      }
      if (L.wd === 4) {
        setTime(day0 + 15 * 3600e3);
        const docs = (await call(tok[t.id], "GET", `/api/col?path=tenants/${t.id}/leads`)).b.docs.filter((x) => x.data.stage === "ganado");
        for (const x of docs) {
          const l = x.data; const sid = (l.extKey || "").replace(/^web:/, ""); if (!sid || l.optOut) continue;
          if (l.awaitSurvey && Date.now() - (l.lastSurveyAt || l.surveySent || 0) < 7 * DAY) { await call(null, "POST", `/api/public/${t.id}/chat`, { sid, text: String(pick([5, 5, 4, 4, 3, 2])) }); surveys++; }
          else if (rnd() < 0.04) { await call(null, "POST", `/api/public/${t.id}/chat`, { sid, text: pick(["Tengo un problema con el servicio", "No funciona lo que compré", "Quiero poner una queja"]) }); problemsSent++; }
          const fresh = (await call(tok[t.id], "GET", `/api/doc?path=tenants/${t.id}/leads/${x.id}`)).b.data;
          if ((fresh.cases || []).some((c) => c.status === "abierto" && Date.now() - c.at > DAY)) {
            await call(tok[t.id], "PUT", "/api/doc", { path: `tenants/${t.id}/leads/${x.id}`, data: { ...fresh, handoff: false, cases: fresh.cases.map((c) => (c.status === "abierto" ? { ...c, status: "resuelto", resolvedAt: Date.now() } : c)) } }); resolved++; }
        }
      }
    }
    // Un cliente de hace 8 meses vuelve a escribir: debe recuperar su historial archivado
    if (L.d === 15 && d > 260) {
      const t = T[0];
      const before = (await call(tok[t.id], "GET", `/api/col?path=tenants/${t.id}/archive`)).b.docs.find((x) => /^Cliente fijo/.test(x.data.name || "") && x.data.phone);
      const oldPhone = before && before.data.phone;
      if (before) {
        setTime(day0 + 9 * 3600e3);
        await call(null, "POST", `/api/public/${t.id}/form`, { name: "Vuelve", phone: oldPhone, consent: true });
        const now = (await call(tok[t.id], "GET", `/api/doc?path=tenants/${t.id}/leads/${before.id}`)).b;
        if (!now.exists) bad("un cliente que volvió no recuperó su historial archivado");
        else restored++;
      }
    }
    if (L.d === 15) { setTime(day0 + 8 * 3600e3); await call(null, "POST", `/api/public/${T[0].id}/form`, { name: "Cliente fijo " + d, phone: "3109" + String(d).padStart(6, "0"), consent: true }); }
    // Motor: varias veces al día (como el despertador)
    for (const h of [7.5, 12, 19.5, 21]) { setTime(day0 + (h - 7) * 3600e3); const a = rn(); try { await engine.tick(null, true); } catch (e) { bad("motor: " + e.message); } tickMs.push(rn() - a); }
    // Revisión de la regla de cobro: el día 5 sin pago debe estar cerrada (y abierta del 1 al 4)
    if (L.d === 5 || L.d === 4) for (const t of T) if (t.on) {
      const tn = (await call(P, "GET", "/api/doc?path=tenants/" + t.id)).b.data; const st = cobro.estado(tn);
      const bills = (await call(P, "GET", "/api/col?path=billing")).b.docs.map((x) => x.data).filter((b) => b.tid === t.id && b.period === mk(day0));
      const unpaid = bills.some((b) => b.amount > (b.payments || []).reduce((s, p) => s + p.amount, 0));
      if (L.d === 5 && tn.paidUntil && tn.paidUntil < mk(day0) + "-01" && st.k !== "cerrada") bad(`${t.name}: debía estar cerrada el día 5 (pagado hasta ${tn.paidUntil})`);
      if (L.d === 4 && tn.paidUntil && tn.paidUntil >= cobro.addD(mk(day0) + "-01", -1) && st.k === "cerrada") bad(`${t.name}: se cerró antes del día 5 (pagado hasta ${tn.paidUntil})`);
      if (tn.paidUntil >= cobro.HOY() && st.k === "cerrada") bad(`${t.name}: pagó pero sigue cerrada (pagado hasta ${tn.paidUntil})`);
      const w = await call(tok[t.id], "PUT", "/api/doc", { path: `tenants/${t.id}/leads/prueba-cierre`, data: { name: "x", messages: [] } });
      if (st.k === "cerrada" && w.s !== 402) bad(`${t.name}: cerrada pero pudo guardar (${w.s})`);
    }
    // Métricas al final de cada mes
    if (local(day0 + DAY).d === 1) {
      const size = Number((await db.pool.query("SELECT pg_database_size(current_database()) s")).rows[0].s);
      const kv = Number((await db.pool.query("SELECT COUNT(*) n FROM kv")).rows[0].n);
      const row = { mes: mk(day0), mbBase: +(size / 1048576).toFixed(1), kv, tickMs: Math.round(tickMs.reduce((a, b) => a + b, 0) / tickMs.length), chatMs: Math.round(inMs.reduce((a, b) => a + b, 0) / inMs.length) };
      for (const t of T) if (t.on) {
        const r = await fetch(B + `/api/col?path=tenants/${t.id}/leads`, { headers: { Authorization: "Bearer " + tok[t.id] } }); const txt = await r.text();
        const a2 = await fetch(B + `/api/col?path=tenants/${t.id}/audit`, { headers: { Authorization: "Bearer " + tok[t.id] } }).then((x) => x.text());
        row[t.id] = `${(JSON.parse(txt).docs || []).length} prosp · ${(txt.length / 1048576).toFixed(1)} MB al abrir`;
      }
      metrics.push(row); tickMs = []; inMs = [];
      if (local(day0).m % 6 === 5) console.log(JSON.stringify(row));
    }
  }
  // Revisiones finales
  const bills = (await call(P, "GET", "/api/col?path=billing")).b.docs.map((x) => x.data);
  const nums = bills.map((b) => b.number); if (new Set(nums).size !== nums.length) bad("hay números de cobro repetidos");
  for (const b of bills) { const days = new Set((b.reminders || []).map((r) => new RealDate(r.at + TZ * 3600e3).toISOString().slice(0, 10))); if (days.size < (b.reminders || []).length) bad("mensualidad con dos avisos el mismo día: " + b.number); }
  for (const t of T) if (t.on) {
    const inv = (await db.listCol(`tenants/${t.id}/invoices`)).map((x) => x.data);
    for (const i of inv) for (const r of i.reminders || []) { const l = local(r.at); const h = l.h; if (l.wd === 0 || (l.wd === 6 ? h < 8 || h >= 15 : h < 7 || h >= 19)) bad(`${t.name}: cobro ${i.number} enviado fuera del horario de la Ley 2300 (${new RealDate(r.at).toISOString()})`); }
  }
  const dg = {}; for (const m of mails.filter((x) => /Resumen del día/.test(x.subject))) { const k = m.to + new RealDate(m.at + TZ * 3600e3).toISOString().slice(0, 10); dg[k] = (dg[k] || 0) + 1; }
  if (Object.values(dg).some((n) => n > 1)) bad("algún resumen del día se envió más de una vez");
  console.log("Correos enviados:", mails.length, "· resúmenes:", Object.keys(dg).length);
  // Una mensualidad por mes por empresa activa, incluido febrero del año bisiesto 2028
  for (const t of T) { const per = {}; for (const b of bills.filter((b) => b.tid === t.id && b.kind === "mensualidad")) per[b.period] = (per[b.period] || 0) + 1;
    if (Object.values(per).some((n) => n > 1)) bad(`${t.name}: mensualidad duplicada en algún mes`);
    if (t.from === undefined && !per["2028-02"]) bad(`${t.name}: no se generó la mensualidad de febrero de 2028 (bisiesto)`);
    const exp = t.from ? 36 - Math.ceil(t.from / 30.4) : 36; if (Object.keys(per).length < exp - 2) /* el primer pago puede cubrir dos meses (resto del mes gratis) */ bad(`${t.name}: solo ${Object.keys(per).length} mensualidades en 3 años (se esperaban ~${exp})`); }
  for (const t of T) { const tn = (await call(P, "GET", "/api/doc?path=tenants/" + t.id)).b.data; if (tn && (tn.credit || 0) < 0) bad(`${t.name}: saldo a favor negativo`); }
  // Nadie que pidió BAJA recibió mensajes automáticos después
  for (const t of T) for (const col of ["leads", "archive"]) for (const x of (await db.listCol(`tenants/${t.id}/${col}`))) { const l = x.data; if (l.optOut && (l.messages || []).some((m) => m.from === "auto" && m.at > l.optOut + 5 && !/No le enviaremos más/.test(m.text))) bad(`${t.name}: se escribió a un cliente que pidió BAJA`); }
  // Posventa: un mensaje al día como máximo, en horario, sin felicitar a familias sin autorización; los clientes no se archivan
  const care = { bday: 0, family: 0, anniv: 0, steps: 0, survey: 0, cases: 0, csat: 0 };
  for (const t of T) {
    const arch = new Set((await db.listCol(`tenants/${t.id}/archive`)).map((x) => x.id));
    for (const x of (await db.listCol(`tenants/${t.id}/leads`))) {
      const l = x.data; if (l.stage !== "ganado") continue;
      const cm = (l.messages || []).filter((m) => m.care); const per = {};
      for (const m of cm) { const k = new RealDate(m.at + TZ * 3600e3).toISOString().slice(0, 10); per[k] = (per[k] || 0) + 1; const lm = local(m.at); if (lm.wd === 0 || engine.isHoliday(m.at) || lm.h < 9 || lm.h >= (lm.wd === 6 ? 15 : 19)) bad(`${t.name}: mensaje de posventa fuera del horario de la Ley 2300`); }
      if (Object.values(per).some((n) => n > 1)) bad(`${t.name}: un cliente recibió dos mensajes de posventa el mismo día`);
      if (!l.famOk && cm.some((m) => /Hijo\d/.test(m.text))) bad(`${t.name}: se felicitó a un familiar sin autorización`);
      for (const k of Object.keys(l.careLog || {})) { if (/^b/.test(k)) care.bday++; else if (/^f:/.test(k)) care.family++; else if (/^a/.test(k)) care.anniv++; else if (/^s/.test(k)) care.steps++; else if (/^q/.test(k)) care.survey++; }
      care.cases += (l.cases || []).length; if (l.csat) care.csat++;
      if ((l.cases || []).some((c) => c.status === "abierto" && Date.now() - c.at > 8 * DAY)) bad(`${t.name}: un caso quedó abierto sin resolver`);
      // Saludos esperados: cada cumpleaños desde la compra (el plan de pasos se marca aunque se agrupe)
      if (l.wonAt && l.birthday && !l.optOut) { const yrs = Math.floor((Date.now() - l.wonAt) / (365 * DAY)); const got = Object.keys(l.careLog || {}).filter((k) => /^b/.test(k)).length; if (got < yrs - 1) bad(`${t.name}: a un cliente le faltaron felicitaciones de cumpleaños (${got} de ~${yrs})`); }
    }
    for (const c of custs.filter((c) => c.tid === t.id)) if (arch.has(c.id)) bad(`${t.name}: un cliente activo terminó archivado`);
  }
  console.log("Posventa:", custs.length, "clientes ganados ·", JSON.stringify(care), "· encuestas respondidas:", surveys, "· problemas reportados:", problemsSent, "· casos resueltos por el asesor:", resolved);
  const nRec = Number((await db.pool.query("SELECT COUNT(*) n FROM docs WHERE parent = 'boldpagos'")).rows[0].n);
  const nRev = Number((await db.pool.query("SELECT COUNT(*) n FROM docs WHERE parent = 'boldrevisar'")).rows[0].n);
  if (nRev) bad(`${nRev} pagos de Bold quedaron para revisar sin motivo`);
  if (nRec > aplicados) bad(`hay más recibos (${nRec}) que pagos (${aplicados}): algún aviso repetido se aplicó dos veces`);
  console.log("Pagos con Bold aplicados:", aplicados, "· recibos:", nRec, "(los de más de 2 años se depuran)");
  console.log("\n=== Resumen de 3 años ===");
  console.log("Clientes que volvieron y recuperaron su historial:", restored);
  console.log("Conversaciones simuladas:", nIn, "· tiempo real:", Math.round((rn() - t0) / 1000), "s");
  console.log("Último mes:", JSON.stringify(metrics[metrics.length - 1]));
  const uniq = [...new Set(problems.map((p) => p.slice(11)))];
  console.log("Problemas encontrados:", problems.length, "(distintos:", uniq.length + ")");
  for (const p of uniq.slice(0, 40)) console.log(" -", p);
  if (process.env.SIM_KEEP) { console.log("Servidor de la simulación sigue abierto en", B); return; }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
