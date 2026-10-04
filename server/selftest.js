// Prueba de extremo a extremo contra un servidor local: node server/selftest.js http://localhost:3311
const B = process.argv[2] || "http://localhost:3000";
const j = (r) => r.json();
const call = (tok, m, u, b) => fetch(B + u, { method: m, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ s: r.status, b: await r.json().catch(() => ({})) }));
const ok = (c, msg) => { console.log((c ? "✔ " : "✘ ") + msg); if (!c) process.exitCode = 1; };
(async () => {
  const L = await call(null, "POST", "/api/auth/login", { email: "proveedor@prueba.co", password: "Prueba12345" }); ok(L.s === 200, "ingreso del proveedor");
  const P = L.b.token;
  ok((await call(null, "POST", "/api/auth/login", { email: "proveedor@prueba.co", password: "mala" })).s === 401, "contraseña incorrecta rechazada");
  ok((await call(null, "GET", "/api/col?path=tenants")).s === 401, "sin sesión no hay datos");
  await call(P, "PUT", "/api/doc", { path: "tenants/t1", data: { name: "Clínica Uno", plan: "empresarial", status: "activo", createdAt: Date.now() } });
  await call(P, "PUT", "/api/doc", { path: "tenants/t2", data: { name: "Otra", plan: "basico", status: "activo" } });
  await call(P, "PUT", "/api/doc", { path: "tenants/t1/config/main", data: { company: "Clínica Uno", faqs: [{ q: "¿Cuánto cuesta la consulta?", a: "La consulta cuesta $80.000." }], autoReply: true, steps: [{ hours: 0, text: "Hola {nombre}, ¿pudo revisar?" }], autoFollow: true, biz: { assign: "rr", agendaOn: true, services: ["Consulta"] } } });
  await call(P, "PUT", "/api/doc", { path: "tenants/t1/config/connections", data: { web: { status: "activo", data: { greeting: "Hola" } }, whatsapp: { status: "activo", data: {} } } });
  ok((await call(P, "POST", "/api/secrets", { tid: "t1", values: { wa_phone_id: "PHONE123", wa_token: "fake" } })).b.has?.includes("wa_token"), "credenciales cifradas guardadas");
  const U = await call(P, "POST", "/api/auth/users", { tid: "t1", id: "u-adm", name: "Admin Uno", email: "admin@uno.co", password: "Admin12345", role: "admin" }); ok(U.s === 200, "usuario administrador creado");
  await call(P, "POST", "/api/auth/users", { tid: "t1", id: "u-ase", name: "Asesor Uno", email: "asesor@uno.co", password: "Asesor12345", role: "asesor" });
  const A = (await call(null, "POST", "/api/auth/login", { email: "admin@uno.co", password: "Admin12345" })).b.token; ok(!!A, "ingreso del administrador");
  const T = await call(A, "GET", "/api/col?path=tenants"); ok(T.b.docs.length === 1 && T.b.docs[0].id === "t1", "el administrador solo ve su empresa");
  ok(!(await call(A, "GET", "/api/doc?path=tenants/t2/config/main")).b.exists, "no puede leer otra empresa");
  ok((await call(A, "PUT", "/api/doc", { path: "tenants/t2/leads/x", data: { a: 1 } })).s === 403, "no puede escribir en otra empresa");
  await call(A, "PUT", "/api/doc", { path: "tenants/t1", data: { name: "Clínica Uno", plan: "basico", status: "activo", sedes: 3 } });
  const t1 = (await call(P, "GET", "/api/doc?path=tenants/t1")).b.data; ok(t1.plan === "empresarial" && t1.sedes === 3, "la empresa no puede cambiarse el plan (sí las sedes)");
  const S = (await call(null, "POST", "/api/auth/login", { email: "asesor@uno.co", password: "Asesor12345" })).b.token;
  ok((await call(S, "PUT", "/api/doc", { path: "tenants/t1/config/main", data: { company: "Hack" } })).s === 403, "el asesor no cambia la configuración");
  ok((await call(S, "PUT", "/api/doc", { path: "tenants/t1/users/u-x", data: { role: "admin" } })).s === 403, "el asesor no crea usuarios");
  // Formulario público
  const F = await call(null, "POST", "/api/public/t1/form", { name: "Laura Prueba", phone: "3001112233", interest: "Consulta", consent: true }); ok(F.s === 200, "formulario público recibido");
  ok((await call(null, "POST", "/api/public/t1/form", { name: "Sin permiso" })).s === 400, "el formulario exige la autorización de datos");
  // Chat web
  const C = await call(null, "POST", "/api/public/t1/chat", { sid: "abc123", text: "¿Cuánto cuesta la consulta?" });
  ok(C.s === 200 && C.b.messages.some((m) => m.from === "empresa" && /80\.000/.test(m.text)), "el chat web responde con la base de conocimiento");
  // WhatsApp entrante (webhook simulado)
  const W = await fetch(B + "/webhooks/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PHONE123" }, contacts: [{ wa_id: "573004445566", profile: { name: "Pedro WA" } }], messages: [{ id: "wamid.1", from: "573004445566", type: "text", text: { body: "Hola, quiero información" } }] } }] }] }) });
  ok(W.status === 200, "webhook de WhatsApp aceptado");
  await new Promise((r) => setTimeout(r, 1500));
  const leads = (await call(A, "GET", "/api/col?path=tenants/t1/leads")).b.docs.map((d) => d.data);
  const wa = leads.find((l) => l.name === "Pedro WA");
  ok(!!wa, "WhatsApp crea el prospecto");
  ok(wa && wa.messages.some((m) => m.from === "bot" && m.d), "la respuesta automática intentó salir por WhatsApp (" + (wa?.messages.find((m) => m.from === "bot")?.d || "") + ")");
  ok(wa && wa.owner === "u-ase", "reparto automático al asesor");
  const web = leads.find((l) => l.channel === "web"); ok(web && web.messages.some((m) => m.d === "web"), "mensaje del chat web marcado como entregado");
  // Reenvío del mismo mensaje de Meta (reintento): no se duplica
  await fetch(B + "/webhooks/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PHONE123" }, messages: [{ id: "wamid.1", from: "573004445566", type: "text", text: { body: "Hola, quiero información" } }] } }] }] }) });
  await new Promise((r) => setTimeout(r, 800));
  const wa2 = (await call(A, "GET", "/api/col?path=tenants/t1/leads")).b.docs.map((d) => d.data).find((l) => l.name === "Pedro WA");
  ok(wa2.messages.filter((m) => m.from === "cliente").length === 1, "reintentos de Meta no duplican mensajes");
  // Escritura desactualizada desde la app no borra mensajes
  const stale = { ...wa2, messages: wa2.messages.slice(0, 1) }; const id = (await call(A, "GET", "/api/col?path=tenants/t1/leads")).b.docs.find((d) => d.data.name === "Pedro WA").id;
  await call(A, "PUT", "/api/doc", { path: "tenants/t1/leads/" + id, data: stale });
  const wa3 = (await call(A, "GET", "/api/doc?path=tenants/t1/leads/" + id)).b.data; ok(wa3.messages.length === wa2.messages.length, "guardar una copia vieja no borra mensajes");
  // Seguimiento automático por el motor
  await call(A, "POST", "/api/engine/run", {});
  const wa4 = (await call(A, "GET", "/api/doc?path=tenants/t1/leads/" + id)).b.data; ok(wa4.messages.some((m) => m.from === "auto"), "el motor envió el seguimiento");
  // Baja
  await fetch(B + "/webhooks/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PHONE123" }, messages: [{ id: "wamid.2", from: "573004445566", type: "text", text: { body: "BAJA" } }] } }] }] }) });
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
  console.log(process.exitCode ? "\nHay pruebas fallidas" : "\nTodas las pruebas pasaron");
})();
