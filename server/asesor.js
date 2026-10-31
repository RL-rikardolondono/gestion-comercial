// Módulo del Market «Asesor con IA para su página web» (basado en Dayana, la asesora de poliandes.com).
// SofIA atiende el chat de la página de la empresa con inteligencia artificial en CADA respuesta, con lo que dice la
// página web de la empresa (la lee el servidor), sus Notas y su base de conocimiento. Objetivo comercial: llevar a la
// compra y no dejar ir ningún contacto. Se cobra con los mismos paquetes de respuestas con IA (Bold), con los mismos topes.
// Para que cada respuesta quepa en el 45 % de lo pagado, el texto que se manda a la IA tiene un tope fijo (ver TOPE_*).
const dns = require("dns").promises;
const net = require("net");
const db = require("./db");

const MAX_URLS = 8;
const TOPE_PAGINA = 7000; // caracteres de la página web que se mandan a la IA en cada respuesta
const TOPE_NOTAS = 2500;
const MAX_BYTES = 600 * 1024;
const UA = "SkyNetGenesis-AgenteIA/1.0 (lector de la página de la empresa)";

const cfgOf = (config) => { const a = (config && config.asesor) || {}; return {
  on: !!a.on, urls: (Array.isArray(a.urls) ? a.urls : []).map((u) => String(u).trim()).filter(Boolean).slice(0, MAX_URLS),
  notas: String(a.notas || "").slice(0, TOPE_NOTAS), casos: String(a.casos || "").slice(0, 600), wa: String(a.wa || "").replace(/\D/g, "").slice(0, 15),
  dominios: (Array.isArray(a.dominios) ? a.dominios : String(a.dominios || "").split(/[\s,]+/)).map(limpiarDominio).filter(Boolean).slice(0, 10) }; };
function limpiarDominio(d) { const s = String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, ""); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s.replace(/^www\./, "") : ""; }
// ¿El chat viene de una página registrada por la empresa? (si no registró dominios, se acepta de cualquier página)
function origenOk(config, origin) {
  const c = cfgOf(config); if (!c.on || !c.dominios.length) return true;
  let h = ""; try { h = new URL(String(origin || "")).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
  return c.dominios.some((d) => h === d || h.endsWith("." + d));
}

/* ---------- Leer la página de la empresa (con protección: solo direcciones públicas de internet) ---------- */
// Solo para las pruebas en el computador de desarrollo (nunca en Render): deja leer páginas locales
const LOCAL_OK = () => process.env.SIMULACION_LOCAL === "1" && process.env.ASESOR_LOCAL === "1" && !process.env.RENDER;
// Direcciones privadas o internas (también IPv4 escritas dentro de IPv6, como ::ffff:7f00:1)
const BL = new net.BlockList();
[["10.0.0.0", 8], ["127.0.0.0", 8], ["0.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10], ["224.0.0.0", 3], ["198.18.0.0", 15]].forEach(([a, n]) => BL.addSubnet(a, n, "ipv4"));
[["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]].forEach(([a, n]) => BL.addSubnet(a, n, "ipv6"));
const privada = (ip) => { if (LOCAL_OK()) return false;
  try {
    if (net.isIPv4(ip)) return BL.check(ip, "ipv4");
    if (!net.isIPv6(ip)) return true;
    const x = ip.toLowerCase();
    // IPv4 dentro de IPv6 (::ffff:1.2.3.4, ::ffff:102:304, 64:ff9b::/96, 2002::/16): se revisa la IPv4 de adentro
    const m = x.match(/^(?:::ffff:|::ffff:0:|64:ff9b::)(.+)$/);
    if (m) { const t = m[1]; if (net.isIPv4(t)) return BL.check(t, "ipv4"); const h = t.split(":"); if (h.length === 2) { const n = (parseInt(h[0], 16) << 16 >>> 0) + parseInt(h[1], 16); return BL.check([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join("."), "ipv4"); } return true; }
    if (x.startsWith("2002:")) return true;
    return BL.check(ip, "ipv6");
  } catch { return true; }
};
async function urlSegura(u) {
  let url; try { url = new URL(u); } catch { throw new Error("Dirección no válida"); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Solo direcciones http o https");
  if (!LOCAL_OK() && url.port && !["80", "443"].includes(url.port)) throw new Error("Puerto no permitido");
  if (url.username || url.password) throw new Error("Dirección no válida");
  const h = url.hostname.replace(/^\[|\]$/g, "");
  if (!LOCAL_OK() && /^(localhost|.*\.local|.*\.internal)$/i.test(h)) throw new Error("Dirección no permitida");
  const ips = net.isIP(h) ? [h] : (await dns.lookup(h, { all: true })).map((x) => x.address);
  if (!ips.length || ips.some(privada)) throw new Error("Dirección no permitida");
  return url;
}
// La conexión usa un «lookup» propio que vuelve a revisar la IP (evita que un dominio cambie a una IP interna entre la revisión y la descarga)
function lookupSeguro(host, opts, cb) {
  dns.lookup(host, { all: true }).then((xs) => { const ok = xs.filter((x) => !privada(x.address)); if (!ok.length || ok.length !== xs.length) return cb(new Error("Dirección no permitida"));
    if (opts && opts.all) return cb(null, ok); cb(null, ok[0].address, ok[0].family); }).catch(cb);
}
function bajar(u, saltos = 0) {
  return urlSegura(u).then((url) => new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? require("https") : require("http");
    const rq = mod.get(url, { headers: { "User-Agent": UA, Accept: "text/html,text/plain" }, lookup: lookupSeguro, timeout: 10000 }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); if (saltos >= 3) return reject(new Error("Demasiadas redirecciones")); return bajar(new URL(r.headers.location, url).toString(), saltos + 1).then(resolve, reject); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error("La página respondió " + r.statusCode)); }
      if (!/text\/(html|plain)|application\/xhtml/i.test(r.headers["content-type"] || "")) { r.resume(); return reject(new Error("No es una página web")); }
      const parts = []; let n = 0;
      r.on("data", (c) => { n += c.length; if (n <= MAX_BYTES) parts.push(c); else r.destroy(); });
      r.on("end", () => resolve(Buffer.concat(parts).toString("utf8"))); r.on("close", () => resolve(Buffer.concat(parts).toString("utf8"))); r.on("error", reject);
    });
    rq.on("timeout", () => rq.destroy(new Error("La página tardó demasiado"))); rq.on("error", reject);
  }));
}
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", uuml: "ü", iexcl: "¡", iquest: "¿" };
const deco = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m);
function textoDe(html) {
  const title = deco((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
  const desc = deco((html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || [])[1] || "").trim();
  let t = html.replace(/<head[\s\S]*?<\/head>/i, " ").replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|br|tr|td|th|header|footer|nav|main|aside|form|label|button|option)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  t = deco(t).split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 1);
  return { title, desc, lines: t };
}
// Lee las direcciones que escribió la empresa y guarda el texto (sin repetir menús ni pies de página)
async function leer(tid) {
  const cfg = await db.getDoc(`tenants/${tid}/config/main`); const c = cfgOf(cfg.data);
  const vistas = new Set(), pages = []; let total = "";
  for (const u of c.urls) {
    try {
      const { title, desc, lines } = textoDe(await bajar(u));
      const nuevas = lines.filter((x) => { const k = x.toLowerCase(); if (vistas.has(k)) return false; vistas.add(k); return true; });
      const txt = [desc, ...nuevas].filter(Boolean).join("\n");
      total += `\n## ${title || u} (${u})\n${txt}`; pages.push({ url: u, title, ok: true, chars: txt.length });
    } catch (e) { pages.push({ url: u, ok: false, error: String(e.message).slice(0, 120) }); }
  }
  const data = { at: Date.now(), pages, text: total.trim().slice(0, 60000) };
  await db.kvSet("asesorweb:" + tid, JSON.stringify(data)); mem.delete(tid);
  return { at: data.at, pages, chars: data.text.length, usados: Math.min(data.text.length, TOPE_PAGINA) };
}
const mem = new Map();
async function guardado(tid) {
  const c = mem.get(tid); if (c && Date.now() - c.t < 10 * 60000) return c.d;
  let d = null; try { d = JSON.parse((await db.kvGet("asesorweb:" + tid)) || "null"); } catch {}
  mem.set(tid, { t: Date.now(), d }); if (mem.size > 2000) mem.clear(); return d;
}
// Lo que se manda a la IA: Notas de la empresa + texto de la página (con tope fijo)
async function conocimiento(tid, config) {
  const c = cfgOf(config), d = await guardado(tid);
  return { notas: c.notas, pagina: d && d.text ? d.text.slice(0, TOPE_PAGINA) : "", leida: d ? d.at : null, casos: c.casos };
}
// Datos sensibles que escriba el visitante (tarjetas, contraseñas) no se guardan ni se mandan a la IA
function ocultar(s) {
  return String(s || "").replace(/\b\d(?:[ -]?\d){12,18}\b/g, "[número oculto]").replace(/\b(contraseña|clave|password|pin|cvv|cvc)(\s*(?:es|:|=)?\s*)\S+/gi, "$1$2[oculta]");
}
// Relectura semanal: los lunes desde las 7 a. m. (una vez por semana y por empresa)
let semHecha = "";
async function semanal(now = Date.now()) {
  const l = new Date(now - 5 * 3600e3); if (l.getUTCDay() !== 1 || l.getUTCHours() < 7) return 0;
  const sem = l.toISOString().slice(0, 10); let n = 0;
  if (semHecha === sem) return 0; const g = "asesorsem:" + sem; if (await db.kvGet(g)) { semHecha = sem; return 0; } await db.kvSet(g, now); semHecha = sem;
  for (const t of await db.listCol("tenants")) {
    if (t.data.demo || t.data.status === "suspendido" || !["pro", "empresarial"].includes(t.data.plan)) continue;
    const cfg = await db.getDoc(`tenants/${t.id}/config/main`); const c = cfgOf(cfg.data); if (!c.on || !c.urls.length) continue;
    const k = `asesorlee:${t.id}:${sem}`; if (await db.kvGet(k)) continue; await db.kvSet(k, now);
    try { await leer(t.id); n++; } catch (e) { console.error("asesor semanal", t.id, e.message); }
  }
  return n;
}
module.exports = { cfgOf, origenOk, leer, guardado, conocimiento, ocultar, semanal, limpiarDominio, urlSegura, textoDe, TOPE_PAGINA, MAX_URLS };
