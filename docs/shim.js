/* Gestión ComercIAl — conexión de la app con el servidor.
   Ofrece a la app las mismas funciones que tenía en Claude (datos, IA y descargas),
   pero contra el servidor propio, con inicio de sesión. */
(function () {
  var META = (document.querySelector('meta[name="gc-api"]') || {}).content || "";
  var API = (window.GC_API || (META && META.indexOf("__") !== 0 ? META : "") || location.origin).replace(/\/$/, "");
  window.GC_API = API; window.GC_SERVER = true;
  var TOK_KEY = "gc_token";
  var token = null; try { token = localStorage.getItem(TOK_KEY); } catch (e) {}

  function req(method, url, body) {
    return fetch(API + url, { method: method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        if (r.status === 401) { logout(); return Promise.reject({ code: "revoked", message: "Sesión vencida" }); }
        return r.json().then(function (j) { if (!r.ok) return Promise.reject({ code: j.code || "unavailable", message: j.error || "Error", text: j.text }); return j; });
      });
  }
  window.GC_req = req;
  function logout() { try { localStorage.removeItem(TOK_KEY); localStorage.removeItem("atd_me"); } catch (e) {} location.reload(); }
  window.GC_logout = logout;

  /* ---------- pantalla de ingreso ---------- */
  function loginScreen() {
    document.documentElement.style.background = "#EEF2F1";
    var w = document.createElement("div");
    w.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;padding:16px;background:#EEF2F1;font-family:\'Public Sans\',system-ui,sans-serif;color:#15232B">' +
      '<form id="gc-login" style="background:#fff;border:1px solid #D2DBDA;border-radius:14px;padding:28px;width:min(380px,100%);display:flex;flex-direction:column;gap:12px">' +
      '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:32px;font-weight:700;color:#1E3A4C">Gestión Comerc<span style="color:#E0A21A">IA</span>l</div>' +
      '<div style="color:#3E4F57;margin-top:-8px">Ingrese con su correo y contraseña.</div>' +
      '<label style="font-size:13px;font-weight:600">Correo<input name="email" type="email" required autocomplete="username" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #D2DBDA;border-radius:8px;font:inherit"></label>' +
      '<label style="font-size:13px;font-weight:600">Contraseña<input name="password" type="password" required autocomplete="current-password" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #D2DBDA;border-radius:8px;font:inherit"></label>' +
      '<button style="padding:12px;border:0;border-radius:8px;background:#1E3A4C;color:#fff;font-weight:600;font-size:15px;cursor:pointer">Ingresar</button>' +
      '<div id="gc-err" role="status" style="color:#B93A27;font-size:13px"></div></form></div>';
    document.body.innerHTML = ""; document.body.appendChild(w);
    document.getElementById("gc-login").onsubmit = function (e) {
      e.preventDefault(); var f = e.target, err = document.getElementById("gc-err"); err.textContent = "Ingresando…";
      fetch(API + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: f.email.value, password: f.password.value }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) { err.textContent = x.j.error || "No se pudo ingresar."; return; }
          try { localStorage.setItem(TOK_KEY, x.j.token); localStorage.setItem("atd_me", JSON.stringify(x.j.user.id)); if (x.j.user.tid) localStorage.setItem("atd_tid", JSON.stringify(x.j.user.tid)); localStorage.setItem("atd_view", JSON.stringify(x.j.user.staff ? "clientes" : x.j.user.role === "asesor" ? "midia" : "panel")); } catch (e2) {}
          location.reload();
        }).catch(function () { err.textContent = "No hay conexión con el servidor."; });
    };
  }
  if (!token) { window.GC_NEEDS_LOGIN = true; document.addEventListener("DOMContentLoaded", loginScreen); return; }
  try { var p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); window.GC_USER = p; if (p.exp * 1000 < Date.now()) { logout(); return; } } catch (e) { logout(); return; }

  /* ---------- datos: misma interfaz que el almacén de Claude ---------- */
  var subs = new Set();
  function snapDoc(path, j) { return { id: path.split("/").pop(), exists: !!j.exists, data: function () { return j.exists ? j.data : undefined; }, metadata: { fromCache: false, hasPendingWrites: false } }; }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path: path,
      get: function () { return req("GET", "/api/doc?path=" + encodeURIComponent(path)).then(function (j) { return snapDoc(path, j); }); },
      set: function (data) { return req("PUT", "/api/doc", { path: path, data: data }).then(function () { kick(); }); },
      update: function (data) { var self = this; return self.get().then(function (s) { return self.set(Object.assign({}, s.data() || {}, data)); }); },
      delete: function () { return req("DELETE", "/api/doc?path=" + encodeURIComponent(path)).then(function () { kick(); }); },
      acquire: function (o) { return req("POST", "/api/acquire", { path: path, holder: o && o.holder, ttlMs: o && o.ttlMs }); },
      collection: function (sub) { return colRef(path + "/" + sub); },
      onSnapshot: function (next, err) {
        var s = { kind: "doc", path: path, next: next, err: err, last: null, alive: true }; subs.add(s); poll(s);
        return function () { s.alive = false; subs.delete(s); };
      }
    };
  }
  function colRef(path) {
    var q = {
      path: path,
      doc: function (id) { return docRef(path + "/" + (id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 9)))); },
      add: function (data) { var r = q.doc(); return r.set(data).then(function () { return r; }); },
      where: function () { return q; }, orderBy: function () { return q; }, limit: function () { return q; },
      get: function () { return req("GET", "/api/col?path=" + encodeURIComponent(path)).then(function (j) { return colSnap(j.docs); }); },
      onSnapshot: function (next, err) {
        var s = { kind: "col", path: path, next: next, err: err, rev: null, alive: true }; subs.add(s); poll(s);
        return function () { s.alive = false; subs.delete(s); };
      }
    };
    return q;
  }
  function colSnap(list) {
    var docs = (list || []).map(function (d) { return { id: d.id, exists: true, data: function () { return d.data; }, metadata: { fromCache: false, hasPendingWrites: false } }; });
    return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function poll(s) {
    if (!s.alive) return Promise.resolve();
    if (s.kind === "doc") return req("GET", "/api/doc?path=" + encodeURIComponent(s.path) + (s.last ? "&v=" + encodeURIComponent(s.last) : "")).then(function (j) {
      if (j.same) return; var sig = j.v || (j.exists ? String(j.version) + ":" + j.updatedAt : "del"); if (sig !== s.last) { s.last = sig; s.next(snapDoc(s.path, j)); }
    }).catch(function (e) { if (e && e.code === "revoked" && s.err) s.err(e); });
    return req("GET", "/api/col?path=" + encodeURIComponent(s.path) + (s.rev ? "&rev=" + encodeURIComponent(s.rev) : "")).then(function (j) {
      if (j.same) return; s.rev = j.rev; s.next(colSnap(j.docs));
    }).catch(function (e) { if (e && e.code === "revoked" && s.err) s.err(e); });
  }
  var kickT = null;
  function kick() { clearTimeout(kickT); kickT = setTimeout(function () { subs.forEach(poll); }, 600); }
  setInterval(function () { if (document.visibilityState !== "hidden") subs.forEach(poll); }, 5000);
  var dbApi = { doc: docRef, collection: colRef };

  /* ---------- IA ---------- */
  function sample(input, opts) {
    opts = opts || {};
    return req("POST", "/api/ai", { input: input, tier: opts.modelTier || "quick" }).then(function (j) {
      if (opts.onText) try { opts.onText({ text: j.text, delta: j.text }); } catch (e) {}
      return { text: j.text, truncated: !!j.truncated, modelTierApplied: opts.modelTier || "quick" };
    });
  }
  sample.json = function (input, opts) { return req("POST", "/api/ai", { input: input, json: true, tier: (opts && opts.modelTier) || "quick" }).then(function (j) { return j.data; }); };
  sample.limits = function () { return Promise.resolve({ maxPromptBytes: 262144 }); };

  /* ---------- descargas ---------- */
  var downloads = { save: function (o) {
    var blob = o.data instanceof Blob ? o.data : new Blob([o.data]); var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = o.filename || "archivo"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    return Promise.resolve({ status: "saved" });
  } };

  // La IA está apagada por costo: la app usa el asistente por reglas (sin costo por mensaje).
  window.claude = { use: function (name) { return Promise.resolve(name === "db" ? dbApi : name === "sample" ? (window.GC_AI_ON ? sample : null) : name === "downloads" ? downloads : null); } };
})();
