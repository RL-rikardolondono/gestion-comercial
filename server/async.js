// Express 4 no atrapa los errores de las funciones async: una falla de la base dejaba la petición colgada.
// Esto envuelve cada ruta para que responda 503 (y lo deje en el registro) en vez de quedarse esperando.
function wrap(fn) {
  if (typeof fn !== "function" || fn.length >= 4) return fn; // los manejadores de error se dejan igual
  return function (req, res, next) {
    let p; try { p = fn(req, res, next); } catch (e) { p = Promise.reject(e); }
    if (p && typeof p.catch === "function") p.catch((e) => { console.error("ruta", req.method, req.path, e && e.message); if (!res.headersSent) res.status(503).json({ error: "El servicio no respondió. Intente de nuevo en unos segundos." }); });
  };
}
function proteger(r) {
  for (const m of ["get", "post", "put", "delete", "use"]) {
    const orig = r[m].bind(r);
    r[m] = (...args) => orig(...args.map((a) => (Array.isArray(a) ? a.map(wrap) : wrap(a))));
  }
  return r;
}
module.exports = { proteger, wrap };
