// Llamadas a la IA (Anthropic). La clave va en ANTHROPIC_API_KEY.
const MODELS = {
  quick: process.env.AI_MODEL_QUICK || "claude-haiku-4-5-20251001",
  default: process.env.AI_MODEL || "claude-haiku-4-5-20251001",
  complex: process.env.AI_MODEL_COMPLEX || "claude-sonnet-5-5",
};
const db = require("./db");

async function ask(input, { tier = "quick", maxTokens = 900, tid = null } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error("La IA no está configurada (falta ANTHROPIC_API_KEY)."), { code: "sampling_disabled" });
  const messages = typeof input === "string" ? [{ role: "user", content: input }] : input.map((m) => ({ role: m.role, content: String(m.content) }));
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELS[tier] || MODELS.default, max_tokens: maxTokens, messages }),
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || "Error de IA"), { code: r.status === 429 ? "rate_limited" : "upstream_error" });
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  if (tid) await trackUsage(tid, j.usage).catch(() => {});
  return { text, truncated: j.stop_reason === "max_tokens", usage: j.usage };
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  const c = text.indexOf("["), d = text.lastIndexOf("]"); if (c >= 0 && d > c) { try { return JSON.parse(text.slice(c, d + 1)); } catch {} }
  throw Object.assign(new Error("La respuesta no fue JSON"), { code: "invalid_json", text });
}
async function askJSON(input, opts = {}) {
  const prompt = typeof input === "string" ? input + "\n\nResponde solo con JSON válido." : input;
  const r = await ask(prompt, opts);
  return parseJSON(r.text);
}

// Consumo real de tokens por empresa y mes (para Plan y consumo)
async function trackUsage(tid, usage) {
  if (!usage) return;
  const d = new Date(Date.now() - 5 * 3600e3); const m = d.toISOString().slice(0, 7);
  const path = `tenants/${tid}/usage/${m}`;
  const cur = await db.getDoc(path);
  const u = cur.exists ? cur.data : { calls: 0, inTok: 0, outTok: 0 };
  await db.setDoc(path, { calls: (u.calls || 0) + 1, inTok: (u.inTok || 0) + (usage.input_tokens || 0), outTok: (u.outTok || 0) + (usage.output_tokens || 0), month: m, real: true });
}

module.exports = { ask, askJSON, parseJSON };
