// Inicio de sesión con correo y contraseña. Token JWT de 30 días.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const SECRET = process.env.JWT_SECRET || process.env.SECRET_KEY || "cambie-esta-clave";
const sign = (u) => jwt.sign({ id: u.id, tid: u.tenant_id || null, role: u.role, staff: !!u.staff }, SECRET, { expiresIn: "30d" });

// Freno a intentos de adivinar contraseñas: 8 fallos por correo en 15 minutos bloquean ese correo 15 minutos.
// Se cuenta por correo + IP (nadie puede bloquear a otro desde su computador) y el intento se anota ANTES de revisar la contraseña.
const fails = new Map();
const tooMany = (k) => { const f = fails.get(k); return !!f && f.n >= 8 && Date.now() - f.at < 15 * 60000; };
const note = (k) => { const f = fails.get(k); if (!f || Date.now() - f.at > 15 * 60000) fails.set(k, { n: 1, at: Date.now() }); else f.n++; if (fails.size > 20000) fails.clear(); };
async function login(email, password, ip = "") {
  const e = String(email || "").trim().toLowerCase(), key = e + "|" + ip;
  if (!e) return null;
  if (tooMany(key)) return { blocked: true };
  note(key);
  const r = await db.pool.query("SELECT * FROM auth_users WHERE lower(email)=lower($1)", [e]);
  const u = r.rows[0];
  if (!u || !u.active || !(await bcrypt.compare(String(password || ""), u.pass_hash))) return null;
  // Bloqueo del Superadministrador por correo: sigue aunque la empresa borre el usuario y lo vuelva a crear
  if ((await db.pool.query("SELECT 1 FROM bloqueos WHERE email=$1", [String(u.email).toLowerCase()])).rows[0]) return null;
  fails.delete(key); active.set(u.id, { ok: true, row: u, at: Date.now() });
  db.pool.query("UPDATE auth_users SET last_login=$2 WHERE id=$1", [u.id, Date.now()]).catch(() => {});
  return { token: sign(u), user: { id: u.id, email: u.email, tid: u.tenant_id, role: u.role, staff: u.staff } };
}

// Un usuario desactivado pierde el acceso aunque tenga la sesión abierta, y un cambio de rol aplica de inmediato.
// Se revisa en la base como máximo cada 5 minutos por usuario (para no despertar Neon en cada consulta).
const active = new Map();
async function current(id) {
  const c = active.get(id); if (c && c.row && Date.now() - c.at < 5 * 60000) return c;
  try { const r = await db.pool.query("SELECT active, role, tenant_id, staff FROM auth_users WHERE id=$1", [id]); const row = r.rows[0] || null; const x = { ok: !!(row && row.active), row, at: Date.now() }; active.set(id, x); return x; }
  catch { return c && c.row ? c : { ok: true, row: null }; }
}
const forget = (id) => active.delete(id);

function middleware(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: "Inicie sesión", code: "unauthenticated" });
  let u; try { u = jwt.verify(t, SECRET); } catch { return res.status(401).json({ error: "La sesión venció. Inicie sesión de nuevo.", code: "unauthenticated" }); }
  current(u.id).then((c) => {
    if (!c.ok) return res.status(401).json({ error: "Su usuario fue desactivado o ya no existe.", code: "unauthenticated" });
    if (c.row) { u.role = c.row.role; u.tid = c.row.tenant_id || null; u.staff = !!c.row.staff; }
    req.user = u; next();
  });
}

async function upsertUser({ id, email, password, tid, role, staff, active: act }) {
  const active = act;
  const ex = await db.pool.query("SELECT * FROM auth_users WHERE id=$1", [id]);
  if (ex.rows[0]) {
    const u = ex.rows[0];
    const hash = password ? await bcrypt.hash(String(password), 10) : u.pass_hash;
    await db.pool.query("UPDATE auth_users SET email=$2, pass_hash=$3, tenant_id=$4, role=$5, staff=$6, active=$7 WHERE id=$1",
      [id, email || u.email, hash, tid ?? u.tenant_id, role || u.role, staff ?? u.staff, active ?? u.active]);
    forget(id);
  } else {
    if (!email || !password) throw new Error("Para crear el acceso se necesitan correo y contraseña.");
    await db.pool.query("INSERT INTO auth_users(id,email,pass_hash,tenant_id,role,staff,active,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, email, await bcrypt.hash(String(password), 10), tid || null, role, !!staff, active !== false, Date.now()]);
  }
}

// Superadministrador de Agente-IA (directiva 29 oct 2026: cada app tiene su propio correo superadmin.<app>@skynetgenesis.com).
// Si ADMIN_EMAIL en Render quedó con el correo viejo compartido, se ignora.
const SA_VIEJO = "superadmin@skynetgenesis.com";
const SA_EMAIL = () => { const e = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase(); return e && e !== SA_VIEJO ? e : "superadmin.agente@skynetgenesis.com"; };
// Primer arranque: crea la cuenta del Superadministrador con SA_EMAIL y ADMIN_PASSWORD.
// Si ya existe con el correo viejo, le cambia el correo y conserva su contraseña (superadmin@ deja de entrar).
async function bootstrap() {
  const email = SA_EMAIL(), pass = process.env.ADMIN_PASSWORD;
  const r = await db.pool.query("SELECT id, email FROM auth_users WHERE staff=true ORDER BY created_at LIMIT 1");
  if (r.rows[0]) {
    const row = r.rows[0];
    if (String(row.email).toLowerCase() !== email) {
      await db.pool.query("UPDATE auth_users SET email=$2 WHERE id=$1", [row.id, email]); forget(row.id);
      const sd = await db.getDoc("staff/" + row.id); if (sd.exists) await db.setDoc("staff/" + row.id, { ...sd.data, email });
      console.log("Superadministrador: correo cambiado a", email);
    }
    // ADMIN_PASSWORD de Render manda: cuando el dueño la cambia en Render, al arrancar se aplica UNA vez a su cuenta
    // (así recupera el acceso sin correo). Si después cambia la clave dentro de la app, un reinicio no la pisa.
    if (pass) {
      const h = require("crypto").createHash("sha256").update("sa:" + row.id + ":" + pass).digest("hex");
      if ((await db.kvGet("sapass:" + row.id)) !== h) { await upsertUser({ id: row.id, password: pass }); await db.kvSet("sapass:" + row.id, h); console.log("Superadministrador: contraseña puesta desde ADMIN_PASSWORD"); }
    }
    console.log("Superadministrador:", email);
    return;
  }
  if (!pass) return;
  const id = "s-admin";
  await upsertUser({ id, email, password: pass, tid: null, role: "proveedor", staff: true });
  await db.setDoc("staff/" + id, { name: process.env.ADMIN_NAME || "Superadministrador", email, createdAt: Date.now() });
  console.log("Cuenta del Superadministrador creada para", email);
}

// Demostración pública: la cuenta demo@skynetgenesis.com (administrador) y dos perfiles más de la «Empresa Demo».
// Se activa poniendo DEMO_PASSWORD en Render. El botón «Probar la demostración» entra sin escribir contraseña.
const DEMO_TID = "t-demo";
const DEMO_USERS = [
  { id: "u-demo", email: "demo@skynetgenesis.com", role: "admin", name: "Demo · Administrador" },
  { id: "u-demo-sup", email: "demo+supervisor@skynetgenesis.com", role: "supervisor", name: "Demo · Supervisor" },
  { id: "u-demo-ase", email: "demo+asesor@skynetgenesis.com", role: "asesor", name: "Demo · Asesor" }];
async function bootstrapDemo() {
  const pass = process.env.DEMO_PASSWORD; if (!pass) return;
  const t = await db.getDoc("tenants/" + DEMO_TID);
  if (!t.exists) {
    await db.setDoc("tenants/" + DEMO_TID, { name: "Empresa Demo", plan: "empresarial", status: "activo", demo: true, paidUntil: "2099-12-31", sector: "Salud", city: "Santa Marta", createdAt: Date.now() });
    await db.setDoc(`tenants/${DEMO_TID}/config/main`, { company: "Empresa Demo", assistant: "Asistente de Empresa Demo", autoReply: true, services: "Consulta general: $80.000\nControl: $50.000", hours: "Lunes a viernes de 8:00 a. m. a 6:00 p. m.", faqs: [{ q: "¿Cuánto cuesta la consulta?", a: "La consulta general cuesta $80.000." }, { q: "¿Dónde están ubicados?", a: "Estamos en Santa Marta." }], biz: { agendaOn: true, services: ["Consulta general"], assign: "rr" } });
    await db.setDoc(`tenants/${DEMO_TID}/config/connections`, { web: { status: "activo", data: { greeting: "Hola, bienvenido a Empresa Demo. ¿En qué le ayudamos?" } } });
  }
  for (const u of DEMO_USERS) {
    const r = await db.pool.query("SELECT id FROM auth_users WHERE id=$1", [u.id]);
    if (!r.rows[0]) await upsertUser({ id: u.id, email: u.email, password: pass + u.role, tid: DEMO_TID, role: u.role, staff: false });
    const d = await db.getDoc(`tenants/${DEMO_TID}/users/${u.id}`);
    if (!d.exists) await db.setDoc(`tenants/${DEMO_TID}/users/${u.id}`, { name: u.name, email: u.email, role: u.role, active: true, createdAt: Date.now() });
  }
  console.log("Demostración activa con demo@skynetgenesis.com");
}
async function demoLogin(role) {
  if (!process.env.DEMO_PASSWORD) return null;
  const u = DEMO_USERS.find((x) => x.role === role) || DEMO_USERS[0];
  const r = await db.pool.query("SELECT * FROM auth_users WHERE id=$1 AND active=true", [u.id]); if (!r.rows[0]) return null;
  const row = r.rows[0];
  return { token: jwt.sign({ id: row.id, tid: row.tenant_id, role: row.role, staff: false, demo: true }, SECRET, { expiresIn: "12h" }), user: { id: row.id, email: row.email, tid: row.tenant_id, role: row.role, staff: false, demo: true } };
}

// Recuperar la contraseña: se envía un enlace al correo (válido 1 hora). No revela si el correo existe.
const crypto = require("crypto");
const hashTok = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
// Cuentas del dueño (Ricardo Londoño): sus enlaces de contraseña llegan directo a su Gmail, sin reenvíos (directiva 29 oct 2026)
const DUENO_CORREO = "rikardolondono@gmail.com";
const DUENO_CUENTAS = () => [SA_EMAIL(), "contacto@skynetgenesis.com", "poliandes@poliandes.com", "anglo@anglocolombiano.com", "contacto@reinaelizabeth.com",
  ...String(process.env.DUENO_CUENTAS || "").split(",")].map((x) => x.trim().toLowerCase()).filter(Boolean);
const esDueno = (row) => !!row && (row.staff || DUENO_CUENTAS().includes(String(row.email).toLowerCase()));
// Crea el enlace (vale 1 hora) y lo manda: a la persona, o al Gmail del dueño si la cuenta es suya (el correo dice qué cuenta y qué empresa es)
async function enviarEnlace(u, origin, send, motivo = "olvido") {
  const tok = crypto.randomBytes(24).toString("base64url");
  const horas = motivo === "registro" ? 24 : motivo === "invitacion" ? 48 : 1; // bienvenida 24 h, invitación de un usuario 48 h
  await db.kvSet("reset:" + hashTok(tok), JSON.stringify({ id: u.id, exp: Date.now() + horas * 3600e3 }));
  const link = `${origin}/#reset=${tok}`;
  if (esDueno(u)) {
    let emp = "SkyNet Genesis (Superadministrador)";
    if (!u.staff && u.tenant_id) { const t = await db.getDoc("tenants/" + u.tenant_id); emp = t.exists ? t.data.name : u.tenant_id; }
    await send(DUENO_CORREO, `Agente-IA · enlace de contraseña de ${u.email}`, `Enlace para crear o cambiar la contraseña de Agente-IA.\n\nCuenta: ${u.email}\nEmpresa: ${emp}\nPerfil: ${u.staff ? "Superadministrador" : ({ admin: "Administrador", supervisor: "Supervisor", asesor: "Asesor" })[u.role] || u.role}\n\nAbra este enlace (vale por ${horas === 1 ? "1 hora" : horas + " horas"}):\n${link}\n\nSi usted no lo pidió, ignore este correo: la contraseña sigue igual.`);
    return { dueno: true };
  }
  if (motivo === "invitacion") {
    let emp = "su empresa"; if (u.tenant_id) { const t = await db.getDoc("tenants/" + u.tenant_id); if (t.exists) emp = t.data.name || emp; }
    const rol = ({ admin: "Administrador", supervisor: "Supervisor", asesor: "Asesor" })[u.role] || u.role;
    await send(u.email, `Su acceso a Agente-IA · ${emp}`, `${emp} le dio acceso a Agente-IA como ${rol}.\n\nAbra este enlace (vale por 48 horas) y cree su contraseña:\n${link}\n\nDespués ingrese en ${origin} con este correo (${u.email}).\n\nSi no esperaba este correo, ignórelo.\n\nAgente-IA es un producto de SkyNet Genesis · WhatsApp 304 437 5758`);
    return { dueno: false };
  }
  if (motivo === "registro") {
    await send(u.email, "Bienvenido a Agente-IA · cree su contraseña", `¡Bienvenido a Agente-IA!\n\nSu empresa ya tiene 15 días de prueba gratis, sin tarjeta.\n\nAbra este enlace (vale por 24 horas) y cree su contraseña:\n${link}\n\nDespués ingrese con este correo (${u.email}) y complete la base de conocimiento de su empresa: con eso SofIA empieza a responderles a sus clientes.\n\nSi usted no creó esta cuenta, ignore este correo.\n\nSoporte: WhatsApp 304 437 5758 · contacto@skynetgenesis.com\nAgente-IA es un producto de SkyNet Genesis.`);
    return { dueno: false };
  }
  const txt = motivo === "sa"
    ? `SkyNet Genesis le envía un enlace para crear o cambiar su contraseña de Agente-IA.\n\nAbra este enlace (vale por 1 hora) y escriba la nueva contraseña:\n${link}\n\nSi no esperaba este correo, ignórelo.`
    : `Recibimos una solicitud para cambiar la contraseña de Agente-IA.\n\nAbra este enlace (vale por 1 hora) y escriba la nueva contraseña:\n${link}\n\nSi usted no lo pidió, ignore este correo: su contraseña sigue igual.`;
  await send(u.email, "Recuperar su contraseña · Agente-IA", txt);
  return { dueno: false };
}
async function forgot(email, origin, send) {
  const e = String(email || "").trim().toLowerCase(); if (!e) return;
  const lim = "resetlim:" + e + ":" + Math.floor(Date.now() / 3600e3);
  const n = Number(await db.kvGet(lim)) || 0; if (n >= 3) return; await db.kvSet(lim, n + 1);
  const r = await db.pool.query("SELECT id, email, active, tenant_id, role, staff FROM auth_users WHERE lower(email)=$1", [e]); const u = r.rows[0];
  if (!u || !u.active || u.tenant_id === DEMO_TID) return;
  await enviarEnlace(u, origin, send);
}
async function resetPassword(tok, password) {
  if (!tok || !password || String(password).length < 8) return { error: "La nueva contraseña debe tener al menos 8 caracteres." };
  const k = "reset:" + hashTok(tok); const v = await db.kvGet(k);
  const d = v ? JSON.parse(v) : null;
  if (!d || d.exp < Date.now()) return { error: "El enlace venció o ya se usó. Pida uno nuevo." };
  await upsertUser({ id: d.id, password }); await db.pool.query("UPDATE auth_users SET pass_set=true WHERE id=$1", [d.id]); await db.pool.query("DELETE FROM kv WHERE k=$1", [k]);
  const r = await db.pool.query("SELECT email FROM auth_users WHERE id=$1", [d.id]); { const em = String(r.rows[0]?.email || "").toLowerCase(); for (const kk of [...fails.keys()]) if (kk === em || kk.startsWith(em + "|")) fails.delete(kk); }
  return { ok: true };
}

module.exports = { SA_EMAIL, DUENO_CORREO, DUENO_CUENTAS, esDueno, enviarEnlace, bootstrapDemo, demoLogin, forgot, resetPassword, DEMO_TID, login, middleware, upsertUser, bootstrap, forget };
