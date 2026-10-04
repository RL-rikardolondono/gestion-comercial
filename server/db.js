// Base de datos: PostgreSQL. Un almacén de documentos JSON por ruta (igual que la app),
// más tablas para usuarios (contraseñas) y secretos de conexión (cifrados).
const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "") ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 5000, // cierra conexiones ociosas para que Neon pueda "dormir" y no gaste horas de cómputo
});
// Revisiones en memoria: la app pregunta cada pocos segundos si algo cambió;
// se responde desde aquí sin tocar la base de datos.
const mem = { col: new Map(), doc: new Map(), n: 0 };
const bumpCol = (parent) => mem.col.set(parent, "m" + (++mem.n) + "." + Date.now());

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS docs (
      path TEXT PRIMARY KEY,
      parent TEXT NOT NULL,
      data JSONB NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      tenant_id TEXT,
      role TEXT NOT NULL,
      staff BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS secrets (
      tenant_id TEXT NOT NULL,
      k TEXT NOT NULL,
      v TEXT NOT NULL,
      PRIMARY KEY (tenant_id, k)
    );
    CREATE TABLE IF NOT EXISTS leases (
      path TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);
}

const parentOf = (path) => path.split("/").slice(0, -1).join("/");
const idOf = (path) => path.split("/").pop();
const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function validPath(path, wantDoc) {
  if (typeof path !== "string" || !path) return false;
  const s = path.split("/");
  if (s.length > 16 || s.some((x) => !SEG.test(x) || x === "." || x === "..")) return false;
  return wantDoc ? s.length % 2 === 0 : s.length % 2 === 1;
}

async function getDoc(path) {
  const r = await pool.query("SELECT data, version, updated_at FROM docs WHERE path=$1", [path]);
  return r.rows[0] ? { exists: true, data: r.rows[0].data, version: r.rows[0].version, updatedAt: Number(r.rows[0].updated_at) } : { exists: false };
}
async function setDoc(path, data) {
  const now = Date.now();
  const r = await pool.query(
    `INSERT INTO docs(path,parent,data,version,updated_at) VALUES($1,$2,$3,1,$4)
     ON CONFLICT(path) DO UPDATE SET data=EXCLUDED.data, version=docs.version+1, updated_at=EXCLUDED.updated_at
     RETURNING version`,
    [path, parentOf(path), JSON.stringify(data), now]
  );
  mem.doc.set(path, r.rows[0].version + ":" + now); bumpCol(parentOf(path));
  return r.rows[0].version;
}
async function delDoc(path) { await pool.query("DELETE FROM docs WHERE path=$1", [path]); mem.doc.set(path, "del"); bumpCol(parentOf(path)); }
async function listCol(path) {
  const r = await pool.query("SELECT path, data, version, updated_at FROM docs WHERE parent=$1 ORDER BY path", [path]);
  return r.rows.map((x) => ({ id: idOf(x.path), data: x.data, version: x.version, updatedAt: Number(x.updated_at) }));
}
async function colRev(path) {
  const r = await pool.query("SELECT COUNT(*)::int AS n, COALESCE(MAX(updated_at),0) AS m, COALESCE(SUM(version),0) AS v FROM docs WHERE parent=$1", [path]);
  return `${r.rows[0].n}.${r.rows[0].m}.${r.rows[0].v}`;
}
async function acquire(path, holder, ttlMs) {
  const now = Date.now();
  const ttl = Math.min(600000, Math.max(1000, Number(ttlMs) || 30000));
  const r = await pool.query(
    `INSERT INTO leases(path,holder,expires) VALUES($1,$2,$3)
     ON CONFLICT(path) DO UPDATE SET holder=EXCLUDED.holder, expires=EXCLUDED.expires
     WHERE leases.expires < $4 OR leases.holder = EXCLUDED.holder
     RETURNING holder`,
    [path, holder, now + ttl, now]
  );
  return { acquired: r.rowCount > 0, expiresAt: new Date(now + ttl).toISOString() };
}

// Secretos cifrados (tokens de Meta, claves de API). AES-256-GCM con SECRET_KEY.
const KEY = crypto.createHash("sha256").update(process.env.SECRET_KEY || "cambie-esta-clave").digest();
function enc(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const out = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), out.toString("base64")].join(".");
}
function dec(blob) {
  const [iv, tag, data] = String(blob).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
async function setSecret(tid, k, v) {
  if (v === null || v === "") return pool.query("DELETE FROM secrets WHERE tenant_id=$1 AND k=$2", [tid, k]);
  await pool.query("INSERT INTO secrets(tenant_id,k,v) VALUES($1,$2,$3) ON CONFLICT(tenant_id,k) DO UPDATE SET v=EXCLUDED.v", [tid, k, enc(v)]);
}
async function getSecrets(tid) {
  const r = await pool.query("SELECT k, v FROM secrets WHERE tenant_id=$1", [tid]);
  const o = {}; for (const x of r.rows) { try { o[x.k] = dec(x.v); } catch { /* clave cambiada */ } } return o;
}
async function findTenantBySecret(k, value) {
  const r = await pool.query("SELECT tenant_id, v FROM secrets WHERE k=$1", [k]);
  for (const x of r.rows) { try { if (dec(x.v) === String(value)) return x.tenant_id; } catch {} }
  return null;
}
async function kvGet(k) { const r = await pool.query("SELECT v FROM kv WHERE k=$1", [k]); return r.rows[0]?.v ?? null; }
async function kvSet(k, v) { await pool.query("INSERT INTO kv(k,v) VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v", [k, String(v)]); }

module.exports = { mem, bumpCol, pool, init, validPath, parentOf, idOf, getDoc, setDoc, delDoc, listCol, colRev, acquire, setSecret, getSecrets, findTenantBySecret, kvGet, kvSet };
