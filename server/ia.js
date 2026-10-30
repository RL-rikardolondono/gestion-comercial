// Módulo de pago «SofIA con inteligencia artificial» (Market de Agente-IA).
// Directiva de SkyNet Genesis: la IA se cobra aparte de la mensualidad, por paquetes prepagados con Bold,
// y el servidor pone topes para que NUNCA se pierda dinero:
//   1) Cada respuesta con IA gasta 1 crédito del paquete; sin créditos, SofIA sigue respondiendo por reglas (gratis).
//   2) La IA solo se usa cuando las reglas no saben responder (lo demás lo resuelven las reglas sin costo).
//   3) Tope de gasto por empresa: lo que cuesta su IA no puede pasar del 45 % de lo que pagó por sus paquetes.
//   4) Tope de gasto mensual de toda la plataforma (AI_TOPE_USD_MES).
//   5) Máximo de respuestas con IA por conversación al día (contra abusos de un solo visitante).
// Los precios se calcularon con el costo más alto (Claude Haiku 4.5: US$1 entrada / US$5 salida por millón de tokens,
// dólar a $4.300) + comisión de Bold + margen. Con Haiku 5.5 el costo real es unas 10 veces menor.
const db = require("./db");
const cobro = require("./cobro");

const PACKS = {
  ia500: { n: 500, price: 59000, label: "500 respuestas" },
  ia2000: { n: 2000, price: 179000, label: "2.000 respuestas" },
  ia6000: { n: 6000, price: 449000, label: "6.000 respuestas" },
};
const DIAS = 30; // cada paquete vale 30 días desde la compra
const PLANES_CON_IA = ["pro", "empresarial"];
const POR_CONVERSACION_DIA = 25;
const env = (k, d) => Number(process.env[k]) || d;
const precioIn = () => env("AI_PRECIO_ENTRADA", 1.0); // US$ por millón de tokens (se cobra como el modelo más caro)
const precioOut = () => env("AI_PRECIO_SALIDA", 5.0);
const copUsd = () => env("COP_USD", 4300);
const topeMes = () => env("AI_TOPE_USD_MES", 40);
const MES = () => cobro.HOY().slice(0, 7);
// Empresas internas de SkyNet Genesis (POLIANDES, Reina Elizabeth, Anglocolombiano…): usan la IA sin paquetes, con el saldo
// gratis de la cuenta de Anthropic de SkyNet Genesis (directiva 30 oct 2026). Su gasto se cuenta aparte, con tope total propio.
const topeInternas = () => env("AI_TOPE_INTERNAS_USD", 200);
async function gastoInternas() { return Number(await db.kvGet("iausdint")) || 0; }
const esInterna = async (tid) => { const t = await db.getDoc("tenants/" + tid); return !!(t.exists && t.data.interna); };
const on = () => !!process.env.ANTHROPIC_API_KEY && process.env.AI_ENABLED !== "false";

const usdDe = (usage) => ((Number(usage?.input_tokens) || 0) * precioIn() + (Number(usage?.output_tokens) || 0) * precioOut()) / 1e6;

// Estado de la IA de una empresa (para la pantalla y para decidir si se usa)
function estado(t, hoy = cobro.HOY()) {
  if (t && t.interna) return { activa: true, interna: true, left: 0, until: null, usd: 0, budgetUSD: 0, total: 0, sinSaldo: false };
  const ia = (t && t.ia) || {};
  const vigente = !!(ia.until && ia.until >= hoy && (ia.left || 0) > 0);
  const budget = ia.budgetUSD || 0, usado = ia.usd || 0;
  return { activa: vigente && usado < budget, left: vigente ? ia.left || 0 : 0, until: ia.until || null, usd: usado, budgetUSD: budget, total: ia.total || 0, sinSaldo: vigente && usado >= budget };
}
// ¿Puede comprar? Solo planes con el módulo, ya pagando (no en prueba) y con el acceso abierto
function puedeComprar(t) {
  if (!t || t.demo) return "En la demostración no se compran paquetes.";
  if (t.interna) return "Empresa interna de SkyNet Genesis: ya usa la inteligencia artificial con el saldo de SkyNet Genesis, sin comprar paquetes.";
  if (!PLANES_CON_IA.includes(t.plan)) return "La inteligencia artificial está disponible desde el plan Profesional.";
  const e = cobro.estado(t);
  if (e.k === "prueba" || !t.paidOnce) return "La inteligencia artificial se compra después del primer pago de la mensualidad (no está en la prueba gratis).";
  if (e.k === "cerrada") return "Primero pague la mensualidad: el acceso está cerrado.";
  return "";
}

async function gastoPlataforma() { return Number(await db.kvGet("iausd:" + MES())) || 0; }
// Reserva 1 crédito de forma atómica antes de llamar a la IA (dos mensajes al tiempo no gastan el mismo crédito)
async function reservar(tid, leadId) {
  if (!on()) return false;
  const hoy = cobro.HOY();
  const kc = `iaconv:${tid}:${leadId}:${hoy}`;
  if ((Number(await db.kvGet(kc)) || 0) >= POR_CONVERSACION_DIA) return false;
  const sumaConv = () => db.pool.query("INSERT INTO kv (k, v) VALUES ($1, '1') ON CONFLICT (k) DO UPDATE SET v = (COALESCE(NULLIF(kv.v, ''), '0')::bigint + 1)::text", [kc]);
  if (await esInterna(tid)) { if ((await gastoInternas()) >= topeInternas()) return false; await sumaConv(); return { interna: true }; }
  if ((await gastoPlataforma()) >= topeMes()) return false;
  const r = await db.pool.query(
    `UPDATE docs SET data = jsonb_set(data, '{ia,left}', to_jsonb(((data->'ia'->>'left')::int - 1))), version = version + 1, updated_at = $3
     WHERE path = $1 AND (data->'ia'->>'left')::int > 0 AND data->'ia'->>'until' >= $2
       AND COALESCE((data->'ia'->>'usd')::numeric, 0) < COALESCE((data->'ia'->>'budgetUSD')::numeric, 0)
     RETURNING data->'ia' AS ia`, ["tenants/" + tid, hoy, Date.now()]);
  if (!r.rows[0]) return false;
  db.mem.doc.set("tenants/" + tid, "ia" + Date.now()); db.bumpCol("tenants");
  await db.pool.query("INSERT INTO kv (k, v) VALUES ($1, '1') ON CONFLICT (k) DO UPDATE SET v = (COALESCE(NULLIF(kv.v, ''), '0')::bigint + 1)::text", [kc]);
  return r.rows[0].ia;
}
// Si la IA falló, se devuelve el crédito
async function devolver(tid) {
  if (await esInterna(tid)) return; // las internas no gastan créditos
  await db.pool.query(`UPDATE docs SET data = jsonb_set(data, '{ia,left}', to_jsonb(((data->'ia'->>'left')::int + 1))) WHERE path = $1 AND data ? 'ia'`, ["tenants/" + tid]);
  db.mem.doc.set("tenants/" + tid, "ia" + Date.now());
}
// Se anota lo que costó de verdad (por empresa y en toda la plataforma)
async function anotar(tid, usage) {
  const usd = usdDe(usage);
  if (await esInterna(tid)) {
    for (const k of ["iausdint", "iausdint:" + tid + ":" + MES()]) await db.pool.query("INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = (COALESCE(NULLIF(kv.v, ''), '0')::numeric + $2::numeric)::text", [k, String(usd)]);
    return usd;
  }
  await db.pool.query(`UPDATE docs SET data = jsonb_set(jsonb_set(data, '{ia,usd}', to_jsonb(COALESCE((data->'ia'->>'usd')::numeric, 0) + $2::numeric)), '{ia,used}', to_jsonb(COALESCE((data->'ia'->>'used')::int, 0) + 1)) WHERE path = $1 AND data ? 'ia'`, ["tenants/" + tid, usd]);
  await db.pool.query("INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = (COALESCE(NULLIF(kv.v, ''), '0')::numeric + $2::numeric)::text", ["iausd:" + MES(), String(usd)]);
  db.mem.doc.set("tenants/" + tid, "ia" + Date.now());
  return usd;
}
// Al aprobarse el pago de un paquete: suma las respuestas y el tope de gasto, y deja 30 días desde hoy
function sumarPaquete(t, packId, valor) {
  const p = PACKS[packId]; const hoy = cobro.HOY(); const ia = { ...((t && t.ia) || {}) };
  const vigente = ia.until && ia.until >= hoy;
  ia.left = (vigente ? ia.left || 0 : 0) + p.n;
  ia.budgetUSD = Number(((vigente ? Math.max(0, (ia.budgetUSD || 0) - (ia.usd || 0)) : 0) + (Number(valor) * 0.45) / copUsd()).toFixed(4));
  ia.usd = 0; ia.used = 0; ia.until = cobro.addD(hoy, DIAS); ia.total = (ia.total || 0) + p.n; ia.lastPack = { id: packId, at: Date.now(), valor: Number(valor) };
  return ia;
}
// Aviso por correo al administrador cuando quedan pocas respuestas con IA y cuando se acaban (una vez por paquete)
async function avisar(tid, ia) {
  if (!ia || ia.interna) return; const left = Number(ia.left) || 0, lim = Math.max(20, Math.round((ia.total || 500) * 0.1));
  const tipo = left === 0 ? "0" : left === lim ? "poco" : ""; if (!tipo) return;
  const k = `iaaviso:${tid}:${ia.until}:${tipo}`; if (await db.kvGet(k)) return; await db.kvSet(k, Date.now());
  const ch = require("./channels"); const t = await db.getDoc("tenants/" + tid); if (!t.exists || !ch.mailOn()) return;
  const admins = (await db.listCol(`tenants/${tid}/users`)).map((x) => x.data).filter((u) => u.role === "admin" && u.active !== false && u.email);
  const txt = tipo === "0"
    ? `Hola, ${t.data.name}. Se acabaron las respuestas con inteligencia artificial de su paquete. SofIA sigue atendiendo a sus clientes con las respuestas automáticas de siempre (sin costo). Si quiere que vuelva a responder con IA, compre otro paquete en Agente-IA › Plan y consumo.`
    : `Hola, ${t.data.name}. A su paquete de inteligencia artificial le quedan ${left} respuestas (vence el ${ia.until}). Cuando se acaben, SofIA sigue respondiendo con las respuestas automáticas. Puede comprar otro paquete en Agente-IA › Plan y consumo.`;
  for (const a of admins) { try { await ch.sendEmail(a.email, tipo === "0" ? "Agente-IA · se acabaron las respuestas con IA" : "Agente-IA · quedan pocas respuestas con IA", txt, { sistema: true }); } catch {} }
}
module.exports = { gastoInternas, topeInternas, avisar, PACKS, DIAS, PLANES_CON_IA, on, estado, puedeComprar, reservar, devolver, anotar, sumarPaquete, gastoPlataforma, topeMes, usdDe };
