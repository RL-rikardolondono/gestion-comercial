// Prueba de extremo a extremo contra un servidor local: node server/selftest.js http://localhost:3311
const B = process.argv[2] || "http://localhost:3000";
const j = (r) => r.json();
const call = (tok, m, u, b) => fetch(B + u, { method: m, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ s: r.status, b: await r.json().catch(() => ({})) }));
// Simulador del sistema central de pagos (firmador y verificador). Inicie el servidor con
//   BOLD_FIRMA=http://localhost:3390/firma BOLD_VERIFICAR=http://localhost:3390/verificar
const MOCK = { pagos: {} };
require("http").createServer((req, res) => {
  const u = new URL(req.url, "http://x"); res.setHeader("Content-Type", "application/json");
  if (!/SkyNetGenesis/.test(req.headers["user-agent"] || "")) { res.statusCode = 403; return res.end("{}"); }
  if (u.pathname === "/verificar") { const q = u.searchParams; const p = q.get("pago") ? MOCK.pagos[q.get("pago")] : Object.values(MOCK.pagos).find((x) => x.referencia === q.get("ref")); return res.end(JSON.stringify(p && q.get("app") === "agente-ia" ? { ok: true, orden: p } : { ok: false })); }
  if (u.pathname === "/firma") { const PR = { "agente-ia:ia500": 59000, "agente-ia:ia2000": 179000, "agente-ia:ia6000": 449000 }; return res.end(JSON.stringify({ orderId: "SGAGENTE-" + Date.now(), amount: PR[u.searchParams.get("plan")] || 1090000, currency: "COP", apiKey: "llave-prueba", signature: "firma-prueba", description: "Agente-IA" })); }
  res.statusCode = 404; res.end("{}");
}).listen(3390).unref();
// Avisos de Meta firmados con la clave de la app (el servidor rechaza los que no traen firma)
const META_SECRET = process.env.META_APP_SECRET || "clave-meta-prueba";
const metaPost = (obj) => { const body = JSON.stringify(obj); const sig = "sha256=" + require("crypto").createHmac("sha256", META_SECRET).update(body).digest("hex"); return fetch(B + "/webhooks/meta", { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body }); };
const ok = (c, msg) => { console.log((c ? "✔ " : "✘ ") + msg); if (!c) process.exitCode = 1; };
(async () => {
  const L = await call(null, "POST", "/api/auth/login", { email: "proveedor@prueba.co", password: "Prueba12345" }); ok(L.s === 200, "ingreso del proveedor");
  const P = L.b.token;
  ok((await call(null, "POST", "/api/auth/login", { email: "proveedor@prueba.co", password: "mala" })).s === 401, "contraseña incorrecta rechazada");
  ok((await call(null, "GET", "/api/col?path=tenants")).s === 401, "sin sesión no hay datos");
  await call(P, "PUT", "/api/doc", { path: "tenants/t1", data: { name: "Clínica Uno", plan: "empresarial", status: "activo", createdAt: Date.now() } });
  await call(P, "PUT", "/api/doc", { path: "tenants/t2", data: { name: "Otra", plan: "basico", status: "activo" } });
  await call(P, "PUT", "/api/doc", { path: "tenants/t1/config/main", data: { company: "Clínica Uno", faqs: [{ q: "¿Cuánto cuesta la consulta?", a: "La consulta cuesta $80.000." }], autoReply: true, steps: [{ hours: 0, text: "Hola {nombre}, ¿pudo revisar?" }], autoFollow: true, biz: { assign: "rr", agendaOn: true, services: ["Consulta"] } } });
  await call(P, "PUT", "/api/doc", { path: "tenants/t1/config/connections", data: { web: { status: "activo", data: { greeting: "Hola" } }, facebook: { status: "activo", data: {} } } });
  ok((await call(P, "POST", "/api/secrets", { tid: "t1", values: { page_id: "PAGE123", page_token: "fake" } })).b.has?.includes("page_token"), "credenciales cifradas guardadas");
  ok(!((await call(P, "POST", "/api/secrets", { tid: "t1", values: { wa_token: "x" } })).b.has || []).includes("wa_token"), "no se aceptan credenciales de WhatsApp (Agente-IA no usa WhatsApp)");
  const U = await call(P, "POST", "/api/auth/users", { tid: "t1", id: "u-adm", name: "Admin Uno", email: "admin@uno.co", password: "Admin12345", role: "admin" }); ok(U.s === 200, "usuario administrador creado");
  await call(P, "POST", "/api/auth/users", { tid: "t1", id: "u-ase", name: "Asesor Uno", email: "asesor@uno.co", password: "Asesor12345", role: "asesor" });
  const A = (await call(null, "POST", "/api/auth/login", { email: "admin@uno.co", password: "Admin12345" })).b.token; ok(!!A, "ingreso del administrador");
  const T = await call(A, "GET", "/api/col?path=tenants"); ok(T.b.docs.length === 1 && T.b.docs[0].id === "t1", "el administrador solo ve su empresa");
  ok(!(await call(A, "GET", "/api/doc?path=tenants/t2/config/main")).b.exists, "no puede leer otra empresa");
  ok((await call(A, "PUT", "/api/doc", { path: "tenants/t2/leads/x", data: { a: 1 } })).s === 403, "no puede escribir en otra empresa");
  await call(A, "PUT", "/api/doc", { path: "tenants/t1", data: { name: "Clínica Uno", plan: "basico", status: "activo", sedes: 3 } });
  const t1 = (await call(P, "GET", "/api/doc?path=tenants/t1")).b.data; ok(t1.plan === "empresarial" && !t1.sedes, "la empresa no puede cambiarse el plan ni escribir a mano su número de sedes");
  for (const n of [1, 2, 3]) await call(A, "PUT", "/api/doc", { path: "tenants/t1/sedes/s" + n, data: { name: "Sede " + n } });
  ok((await call(P, "GET", "/api/doc?path=tenants/t1")).b.data.sedes === 3, "el servidor cuenta las sedes reales de la empresa (3)");
  const S = (await call(null, "POST", "/api/auth/login", { email: "asesor@uno.co", password: "Asesor12345" })).b.token;
  await call(S, "PUT", "/api/doc", { path: "tenants/t1/config/main", data: { company: "Hack" } });
  ok((await call(A, "GET", "/api/doc?path=tenants/t1/config/main")).b.data.company === "Clínica Uno", "el asesor no cambia la configuración (solo el turno del reparto)");
  ok((await call(S, "PUT", "/api/doc", { path: "tenants/t1/users/u-x", data: { role: "admin" } })).s === 403, "el asesor no crea usuarios");
  // Formulario público
  const F = await call(null, "POST", "/api/public/t1/form", { name: "Laura Prueba", phone: "3001112233", interest: "Consulta", consent: true }); ok(F.s === 200, "formulario público recibido");
  ok((await call(null, "POST", "/api/public/t1/form", { name: "Sin permiso" })).s === 400, "el formulario exige la autorización de datos");
  // Chat web
  const C = await call(null, "POST", "/api/public/t1/chat", { sid: "abc123", text: "¿Cuánto cuesta la consulta?" });
  ok(C.s === 200 && C.b.messages.some((m) => m.from === "empresa" && /80\.000/.test(m.text)), "el chat web responde con la base de conocimiento");
  // Messenger entrante (webhook simulado)
  const W = await metaPost({ object: "page", entry: [{ id: "PAGE123", messaging: [{ sender: { id: "psid77" }, message: { mid: "m.1", text: "Hola, ¿cuánto cuesta la consulta?" } }] }] });
  ok(W.status === 200, "webhook de Messenger aceptado");
  const WW = await metaPost({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "X" }, contacts: [{ wa_id: "573004445566", profile: { name: "Pedro WA" } }], messages: [{ id: "wamid.1", from: "573004445566", type: "text", text: { body: "hola" } }] } }] }] });
  await new Promise((r) => setTimeout(r, 1500));
  const leads = (await call(A, "GET", "/api/col?path=tenants/t1/leads")).b.docs.map((d) => d.data);
  ok(WW.status === 200 && !leads.some((l) => l.name === "Pedro WA"), "un mensaje de WhatsApp no crea nada (WhatsApp desactivado)");
  const wa = leads.find((l) => l.extKey === "fb:psid77");
  ok(!!wa, "Messenger crea el prospecto");
  ok(wa && wa.messages.some((m) => m.from === "bot" && m.d), "la respuesta automática intentó salir por Messenger (" + (wa?.messages.find((m) => m.from === "bot")?.d || "") + ")");
  ok(wa && wa.owner === "u-ase", "reparto automático al asesor");
  const web = leads.find((l) => l.channel === "web"); ok(web && web.messages.some((m) => m.d === "web"), "mensaje del chat web marcado como entregado");
  // Reenvío del mismo mensaje de Meta (reintento): no se duplica
  await metaPost({ object: "page", entry: [{ id: "PAGE123", messaging: [{ sender: { id: "psid77" }, message: { mid: "m.1", text: "Hola, ¿cuánto cuesta la consulta?" } }] }] });
  await new Promise((r) => setTimeout(r, 800));
  const wa2 = (await call(A, "GET", "/api/col?path=tenants/t1/leads")).b.docs.map((d) => d.data).find((l) => l.extKey === "fb:psid77");
  ok(wa2.messages.filter((m) => m.from === "cliente").length === 1, "reintentos de Meta no duplican mensajes");
  // Escritura desactualizada desde la app no borra mensajes
  const id = (await call(A, "GET", "/api/col?path=tenants/t1/leads")).b.docs.find((d) => d.data.extKey === "fb:psid77").id;
  const stale = { ...wa2, messages: wa2.messages.slice(0, 1) };
  await call(A, "PUT", "/api/doc", { path: "tenants/t1/leads/" + id, data: stale });
  const wa3 = (await call(A, "GET", "/api/doc?path=tenants/t1/leads/" + id)).b.data; ok(wa3.messages.length === wa2.messages.length, "guardar una copia vieja no borra mensajes");
  // Seguimiento automático por el motor
  await call(A, "POST", "/api/engine/run", {});
  const wa4 = (await call(A, "GET", "/api/doc?path=tenants/t1/leads/" + id)).b.data; const habilSeg = require("./engine").collectAllowedAt(Date.now());
  ok(habilSeg ? wa4.messages.some((m) => m.from === "auto") : !wa4.messages.some((m) => m.from === "auto"), habilSeg ? "el motor envió el seguimiento" : "fuera del horario de la Ley 2300 el motor no envía el seguimiento");
  // Baja
  await metaPost({ object: "page", entry: [{ id: "PAGE123", messaging: [{ sender: { id: "psid77" }, message: { mid: "m.2", text: "BAJA" } }] }] });
  await new Promise((r) => setTimeout(r, 800));
  const wa5 = (await call(A, "GET", "/api/doc?path=tenants/t1/leads/" + id)).b.data; ok(!!wa5.optOut, "BAJA detiene los mensajes");
  // API de prospectos
  const K = (await call(P, "POST", "/api/secrets/t1/apikey", {})).b.key;
  ok((await call(K, "POST", "/api/v1/t1/prospectos", { nombre: "Por API", telefono: "3009998877" })).s === 201, "API de prospectos con clave");
  ok((await call("mala", "POST", "/api/v1/t1/prospectos", { nombre: "x" })).s === 401, "API rechaza clave inválida");
  // Página del formulario y widget
  ok((await fetch(B + "/f/t1")).status === 200, "página del formulario");
  ok((await fetch(B + "/widget.js")).status === 200, "código del chat web");
  ok((await fetch(B + "/webhooks/meta?hub.mode=subscribe&hub.verify_token=verifica123&hub.challenge=42").then((r) => r.text())) === "42", "verificación del webhook de Meta");
  // --- Revisión 1: seguridad y regla de cobro ---
  await call(S, "PUT", "/api/doc", { path: "tenants/t1", data: { name: "Hack", logo: "x", stats: { conv: 9 } } });
  const t1b = (await call(P, "GET", "/api/doc?path=tenants/t1")).b.data; ok(t1b.name === "Clínica Uno" && !t1b.logo && t1b.stats?.conv === 9, "el asesor solo actualiza estadísticas de la empresa");
  ok((await call(S, "DELETE", "/api/doc?path=tenants/t1/leads/" + id)).s === 403, "el asesor no elimina prospectos");
  await call(P, "PUT", "/api/doc", { path: "tickets/tk1", data: { tid: "t2", text: "de otra" } });
  ok((await call(A, "PUT", "/api/doc", { path: "tickets/tk1", data: { tid: "t1", text: "robado" } })).s === 403, "no se puede sobrescribir el soporte de otra empresa");
  ok((await call(A, "DELETE", "/api/doc?path=tickets/tk1")).s === 403, "no se puede borrar el soporte de otra empresa");
  // usuario desactivado pierde el acceso con la sesión abierta
  await call(P, "POST", "/api/auth/users", { tid: "t1", id: "u-ase", name: "Asesor Uno", role: "asesor", active: false, email: "asesor@uno.co" });
  ok((await call(S, "GET", "/api/col?path=tenants/t1/leads")).s === 401, "un usuario desactivado pierde el acceso de inmediato");
  // intentos fallidos
  let last; for (let i = 0; i < 9; i++) last = await call(null, "POST", "/api/auth/login", { email: "admin@uno.co", password: "mala" + i });
  ok(last.s === 429, "demasiados intentos fallidos bloquean el correo");
  // Pagos SOLO con Bold: firma desde el servidor, aviso confirmado con el verificador central (simulado aquí), una sola vez por pago
  const PL = "agente-ia:paq_empresarial_sede-x2", VAL = 1090000;
  const FI = await call(A, "POST", "/api/bold/firma", {});
  ok(FI.s === 200 && FI.b.plan === PL && FI.b.valor === VAL && /^\d{4}-\d{2}-\d{2}$/.test(FI.b.hasta || ""), "el administrador pide la firma del pago con el plan de su empresa (" + FI.b.plan + ", " + FI.b.valor + ")");
  await call(P, "POST", "/api/auth/users", { tid: "t1", id: "u-sup", name: "Supervisora Uno", email: "sup@uno.co", password: "Super12345", role: "supervisor" });
  const SU = (await call(null, "POST", "/api/auth/login", { email: "sup@uno.co", password: "Super12345" })).b.token;
  ok((await call(SU, "POST", "/api/bold/firma", {})).s === 403, "solo el administrador paga la mensualidad");
  ok((await call(A, "POST", "/api/auth/users", { id: "system", name: "x", email: "sys@uno.co", password: "Sistema12345", role: "admin" })).s === 400, "no se puede crear un usuario con el identificador interno del motor");
  await call(A, "DELETE", "/api/doc?path=tenants/t1/sedes/s3");
  ok((await call(A, "POST", "/api/bold/firma", {})).b.plan === PL, "borrar una sede antes de pagar no baja el precio del mes");
  MOCK.pagos.Q1 = { pago_id: "Q1", plan: PL, empresa: "t1", valor: VAL, referencia: "SGQ", estado: "no aprobado", app: "agente-ia" };
  ok((await call(null, "POST", "/api/bold/aplicar", { pago_id: "Q1" })).s === 409, "un pago que el verificador no reporta como aprobado no se aplica");
  ok((await call(null, "POST", "/webhooks/meta", { object: "page", entry: [] })).s === 401, "un aviso de Meta sin firma se rechaza");
  ok((await call(P, "GET", "/api/col?path=tenants/t1/leads")).b.docs?.length === 0 || (await call(P, "GET", "/api/col?path=tenants/t1/leads")).s === 403, "el Superadministrador no ve las conversaciones de las empresas");
  ok((await call(A, "POST", "/api/pago/reporte", { ref: "X", amount: 1 })).s === 404, "ya no existe el «Ya pagué» con comprobante");
  await call(P, "PUT", "/api/doc", { path: "tenants/t1", data: { ...t1b, paidUntil: "2020-01-31", paidOnce: true } });
  ok((await call(A, "PUT", "/api/doc", { path: "tenants/t1/leads/zz", data: { name: "x" } })).s === 402, "empresa cerrada por pago no puede guardar");
  ok((await call(null, "POST", "/api/public/t1/chat", { sid: "abc123", text: "hola" })).s === 400, "empresa cerrada: el chat público no responde");
  ok((await call(A, "POST", "/api/bold/firma", {})).s === 200, "empresa cerrada sí puede pagar en línea");
  ok((await call(null, "POST", "/api/bold/aplicar", { pago_id: "FALSO1" })).s === 409, "un aviso falso (que el verificador central no confirma) se rechaza");
  MOCK.pagos.P1 = { pago_id: "P1", plan: PL, empresa: "t1", valor: VAL, referencia: "SGAGENTE-1", meses: 1, app: "agente-ia" };
  const AP = await call(null, "POST", "/api/bold/aplicar", { pago_id: "P1" });
  const cobro = require("./cobro"); const finActual = cobro.finMes(cobro.HOY());
  const t1p = (await call(P, "GET", "/api/doc?path=tenants/t1")).b.data;
  ok(AP.s === 200 && AP.b.ok === true && t1p.paidUntil === finActual, "el pago de Bold confirmado se aplica: queda al día hasta el fin de este mes, sin cobrar los meses cerrados (" + t1p.paidUntil + ")");
  ok((await call(A, "PUT", "/api/doc", { path: "tenants/t1/leads/zz2", data: { name: "x" } })).s === 200, "al confirmar el pago la empresa se reabre de inmediato");
  await call(null, "POST", "/api/bold/aplicar", { pago_id: "P1" });
  ok((await call(P, "GET", "/api/doc?path=tenants/t1")).b.data.paidUntil === finActual, "el mismo aviso repetido no suma otro mes");
  ok((await call(A, "GET", "/api/bold/volver?ref=SGAGENTE-1")).b.ok === true && (await call(P, "GET", "/api/doc?path=tenants/t1")).b.data.paidUntil === finActual, "el respaldo al volver de Bold tampoco lo duplica");
  MOCK.pagos.P2 = { pago_id: "P2", plan: "agente-ia:pro", empresa: "t1", valor: 1000, referencia: "SGAGENTE-2", app: "agente-ia" };
  await call(null, "POST", "/api/bold/aplicar", { pago_id: "P2" });
  const RV = await call(P, "GET", "/api/bold/recibos");
  ok((await call(P, "GET", "/api/doc?path=tenants/t1")).b.data.paidUntil === finActual && RV.b.revisar.some((x) => x.pago_id === "P2"), "un pago que no cubre la mensualidad no se aplica: queda para revisar");
  ok(RV.b.recibos.some((x) => x.pago_id === "P1" && x.receiptN >= 1), "queda el recibo del pago");
  ok(((await call(A, "GET", "/api/col?path=boldpagos")).b.docs || []).every((x) => x.data.tid === "t1"), "cada empresa ve solo sus recibos");
  await call(A, "PUT", "/api/doc", { path: "tenants/t1", data: { ...t1p, paidUntil: "2099-12-31", trialUntil: "2099-12-31" } });
  ok((await call(P, "GET", "/api/doc?path=tenants/t1")).b.data.paidUntil === finActual, "la empresa no puede cambiarse «Pagado hasta»");
  // Módulo de pago: SofIA con inteligencia artificial (paquetes prepagados con Bold)
  ok((await call(A, "POST", "/api/ai", { input: "hola" })).s === 403, "la empresa no usa IA libre: solo con paquetes en las respuestas de SofIA");
  const FIA = await call(A, "POST", "/api/bold/firma", { pack: "ia500" });
  ok(FIA.s === 200 && FIA.b.plan === "agente-ia:ia500" && FIA.b.valor === 59000, "el administrador pide la firma del paquete de 500 respuestas ($59.000)");
  ok((await call(A, "POST", "/api/bold/firma", { pack: "ia999" })).s === 400, "un paquete que no existe se rechaza");
  MOCK.pagos.IA1 = { pago_id: "IA1", plan: "agente-ia:ia500", empresa: "t1", valor: 59000, referencia: "SGIA-1", app: "agente-ia" };
  await call(null, "POST", "/api/bold/aplicar", { pago_id: "IA1" });
  const tia = (await call(P, "GET", "/api/doc?path=tenants/t1")).b.data;
  ok(tia.ia && tia.ia.left === 500 && tia.ia.budgetUSD > 0 && tia.paidUntil === finActual, "el paquete pagado deja 500 respuestas con tope de gasto, sin tocar «Pagado hasta»");
  await call(null, "POST", "/api/bold/aplicar", { pago_id: "IA1" });
  ok((await call(P, "GET", "/api/doc?path=tenants/t1")).b.data.ia.left === 500, "el aviso repetido del paquete no suma dos veces");
  MOCK.pagos.IA2 = { pago_id: "IA2", plan: "agente-ia:ia2000", empresa: "t1", valor: 59000, referencia: "SGIA-2", app: "agente-ia" };
  await call(null, "POST", "/api/bold/aplicar", { pago_id: "IA2" });
  ok((await call(P, "GET", "/api/doc?path=tenants/t1")).b.data.ia.left === 500, "un pago menor que el precio del paquete no da respuestas (queda para revisar)");
  const tia2 = (await call(A, "GET", "/api/doc?path=tenants/t1")).b.data;
  await call(A, "PUT", "/api/doc", { path: "tenants/t1", data: { ...tia2, ia: { left: 99999, until: "2099-12-31", budgetUSD: 9999 } } });
  ok((await call(P, "GET", "/api/doc?path=tenants/t1")).b.data.ia.left === 500, "la empresa no puede darse respuestas de IA gratis");
  const IE = await call(A, "GET", "/api/ia/estado");
  ok(IE.b.empresa && IE.b.empresa.left === 500 && IE.b.packs.ia6000.price === 449000, "la empresa ve su paquete y los precios");
  // Regla: prueba de 15 días sin renovación, cierre el día 5, primer pago con el resto del mes gratis
  ok(cobro.estado({ trialUntil: cobro.addD(cobro.HOY(), 3) }).k === "prueba", "empresa nueva: en prueba gratis");
  ok(cobro.estado({ trialUntil: cobro.addD(cobro.HOY(), -1) }).k === "cerrada", "al terminar la prueba sin pago se cierra");
  ok(cobro.estado({ paidUntil: "2026-09-30", paidOnce: true }, "2026-10-04").k === "activa" && cobro.estado({ paidUntil: "2026-09-30", paidOnce: true }, "2026-10-05").k === "cerrada", "sin pago, el día 5 se cierra (sin cuenta regresiva)");
  ok(cobro.trasPago({}, "2026-10-20") === "2026-11-30" && cobro.trasPago({}, "2026-10-03") === "2026-10-31", "primer pago: el resto del mes gratis (o solo ese mes si paga del 1 al 5)");
  ok(cobro.trasPago({ trialUntil: "2026-10-25" }, "2026-10-20") === "2026-11-30", "si paga durante la prueba, cuenta desde el día siguiente al fin de la prueba");
  ok(cobro.trasPago({ paidUntil: "2026-10-31", paidOnce: true }, "2026-10-28") === "2026-11-30", "pagando por adelantado suma un mes");
  const DM = await call(null, "POST", "/api/auth/demo", { role: "asesor" });
  ok(DM.s === 404 || (DM.s === 200 && DM.b.user.tid === "t-demo" && DM.b.user.role === "asesor"), "la demostración entra solo a la Empresa Demo (o está apagada)");
  if (DM.s === 200) { ok((await call(DM.b.token, "GET", "/api/doc?path=tenants/t1")).b.exists === false, "la demostración no ve otras empresas"); ok((await call(DM.b.token, "POST", "/api/auth/password", { current: "x", password: "y12345678" })).s === 403, "en la demostración no se cambia la contraseña"); }
  ok((await call(null, "POST", "/api/auth/olvido", { email: "nadie@x.co" })).s === 200, "recuperar contraseña no revela si el correo existe");
  ok((await call(null, "POST", "/api/auth/reset", { token: "falso", password: "Nueva12345" })).s === 400, "un enlace de recuperación falso no sirve");
  await call(P, "PUT", "/api/doc", { path: "tenants/t1", data: { ...t1b, paidUntil: "2099-12-31" } });
  // Posventa y fidelización: SofIA felicita al cliente y abre un caso cuando reporta un problema
  const cfg = (await call(P, "GET", "/api/doc?path=tenants/t1/config/main")).b.data;
  await call(P, "PUT", "/api/doc", { path: "tenants/t1/config/main", data: { ...cfg, care: { on: true, hourFrom: 0, hourTo: 24 } } });
  const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(5, 10);
  await call(A, "PUT", "/api/doc", { path: "tenants/t1/leads/cli1", data: { name: "Marta Cliente", phone: "3007778899", email: "marta@cliente.co", channel: "email", stage: "ganado", wonAt: Date.now() - 40 * 864e5, purchase: "Camioneta X", birthday: "1980-" + hoy, family: [{ name: "Tomás", rel: "hijo", bday: "2015-" + hoy }], famOk: false, messages: [], createdAt: Date.now() - 60 * 864e5, updatedAt: Date.now() } });
  await call(A, "POST", "/api/engine/run", {});
  const c1 = (await call(A, "GET", "/api/doc?path=tenants/t1/leads/cli1")).b.data;
  const bo = new Date(Date.now() - 5 * 3600e3), wd = bo.getUTCDay(), hh = bo.getUTCHours();
  const habil = wd !== 0 && !require("./engine").isHoliday(Date.now()) && (wd === 6 ? hh >= 8 && hh < 15 : hh >= 9 && hh < 19);
  if (habil) {
    ok(c1.messages.some((m) => m.from === "auto" && /Feliz cumpleaños, Marta/.test(m.text)), "SofIA felicita al cliente el día de su cumpleaños");
    ok(c1.messages.filter((m) => m.care).length === 1, "máximo un mensaje de acompañamiento por día");
  } else ok(!c1.messages.some((m) => m.care), "fuera del horario de la Ley 2300 SofIA no escribe (se prueba el saludo en horario hábil)");
  ok(!c1.messages.some((m) => /Tomás/.test(m.text)), "no felicita a la familia sin autorización de datos");
  await call(A, "POST", "/api/engine/run", {});
  ok((await call(A, "GET", "/api/doc?path=tenants/t1/leads/cli1")).b.data.messages.filter((m) => m.care).length === (habil ? 1 : 0), "no repite el saludo el mismo día");
  await call(A, "PUT", "/api/doc", { path: "tenants/t1/leads/cli1", data: { ...c1, stage: "ganado" } });
  await call(K, "POST", "/api/v1/t1/prospectos", { nombre: "x2", telefono: "3001234500" });
  const L2 = await call(null, "POST", "/api/public/t1/chat", { sid: "cli-web-1", text: "hola" });
  ok(L2.s === 200, "chat sigue respondiendo");
  const cw = (await call(A, "GET", "/api/col?path=tenants/t1/leads")).b.docs.find((d) => d.data.extKey === "web:cli-web-1" || (d.data.messages || []).some((m) => m.text === "hola"));
  if (cw) { await call(A, "PUT", "/api/doc", { path: "tenants/t1/leads/" + cw.id, data: { ...cw.data, stage: "ganado", wonAt: Date.now() - 90 * 864e5, careDay: "x" } });
    const R = await call(null, "POST", "/api/public/t1/chat", { sid: "cli-web-1", text: "Tengo un problema, el equipo no funciona" });
    const cc = (await call(A, "GET", "/api/doc?path=tenants/t1/leads/" + cw.id)).b.data;
    ok((cc.cases || []).some((x) => x.status === "abierto") && cc.handoff, "un cliente activo con un problema abre un caso de soporte y pasa a una persona");
    ok(R.s === 200 && cc.messages.some((m) => m.caso), "SofIA le confirma al cliente que su caso quedó registrado"); }
  else ok(false, "no se encontró el cliente del chat web");
  console.log(process.exitCode ? "\nHay pruebas fallidas" : "\nTodas las pruebas pasaron");
})();
