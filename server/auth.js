// Inicio de sesión con correo y contraseña. Token JWT de 30 días.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const SECRET = process.env.JWT_SECRET || process.env.SECRET_KEY || "cambie-esta-clave";
const sign = (u) => jwt.sign({ id: u.id, tid: u.tenant_id || null, role: u.role, staff: !!u.staff }, SECRET, { expiresIn: "30d" });

async function login(email, password) {
  const r = await db.pool.query("SELECT * FROM auth_users WHERE lower(email)=lower($1)", [String(email || "").trim()]);
  const u = r.rows[0];
  if (!u || !u.active || !(await bcrypt.compare(String(password || ""), u.pass_hash))) return null;
  return { token: sign(u), user: { id: u.id, email: u.email, tid: u.tenant_id, role: u.role, staff: u.staff } };
}

function middleware(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: "Inicie sesión", code: "unauthenticated" });
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ error: "La sesión venció. Inicie sesión de nuevo.", code: "unauthenticated" }); }
}

async function upsertUser({ id, email, password, tid, role, staff, active }) {
  const ex = await db.pool.query("SELECT * FROM auth_users WHERE id=$1", [id]);
  if (ex.rows[0]) {
    const u = ex.rows[0];
    const hash = password ? await bcrypt.hash(String(password), 10) : u.pass_hash;
    await db.pool.query("UPDATE auth_users SET email=$2, pass_hash=$3, tenant_id=$4, role=$5, staff=$6, active=$7 WHERE id=$1",
      [id, email || u.email, hash, tid ?? u.tenant_id, role || u.role, staff ?? u.staff, active ?? u.active]);
  } else {
    if (!email || !password) throw new Error("Para crear el acceso se necesitan correo y contraseña.");
    await db.pool.query("INSERT INTO auth_users(id,email,pass_hash,tenant_id,role,staff,active,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, email, await bcrypt.hash(String(password), 10), tid || null, role, !!staff, active !== false, Date.now()]);
  }
}

// Primer arranque: crea la cuenta del proveedor con ADMIN_EMAIL y ADMIN_PASSWORD.
async function bootstrap() {
  const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD;
  if (!email || !pass) return;
  const r = await db.pool.query("SELECT id FROM auth_users WHERE staff=true LIMIT 1");
  if (r.rows[0]) return;
  const id = "s-admin";
  await upsertUser({ id, email, password: pass, tid: null, role: "proveedor", staff: true });
  await db.setDoc("staff/" + id, { name: process.env.ADMIN_NAME || "Proveedor", email, createdAt: Date.now() });
  console.log("Cuenta de proveedor creada para", email);
}

module.exports = { login, middleware, upsertUser, bootstrap };
