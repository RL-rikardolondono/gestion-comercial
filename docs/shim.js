/* Agente-IA — conexión de la app con el servidor.
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
    document.documentElement.style.background = "#F4F8FB";
    var w = document.createElement("div");
    w.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;padding:16px;background:#F4F8FB;font-family:\'Public Sans\',system-ui,sans-serif;color:#1C2B39">' +
      '<form id="gc-login" style="background:#fff;border:1px solid #DCE5EE;box-shadow:0 1px 3px rgba(11,79,138,.08),0 8px 24px rgba(11,79,138,.08);border-radius:14px;padding:28px;width:min(380px,100%);display:flex;flex-direction:column;gap:12px">' +
      '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:32px;font-weight:700;color:#0B4F8A">Agente-<span style="color:#14A38B">IA</span></div>' +
      '<div style="color:#5D6B78;margin-top:-8px">Ingrese con su correo y contraseña.</div>' +
      '<label style="font-size:13px;font-weight:600">Correo<input name="email" type="email" required autocomplete="username" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #DCE5EE;border-radius:8px;font:inherit"></label>' +
      '<label style="font-size:13px;font-weight:600">Contraseña<input name="password" type="password" required autocomplete="current-password" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #DCE5EE;border-radius:8px;font:inherit"></label>' +
      '<button style="padding:12px;border:0;border-radius:8px;background:#14A38B;color:#fff;font-weight:600;font-size:15px;cursor:pointer">Ingresar</button>' +
      '<div id="gc-err" role="status" style="color:#B93A27;font-size:13px"></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px"><a href="#" id="gc-forgot" style="color:#0B4F8A">¿Olvidó su contraseña?</a><a href="#" id="gc-demo" style="color:#0E8571;font-weight:600">Probar la demostración</a></div>' +
      '<a href="#registro" id="gc-reg" style="display:block;text-align:center;padding:11px;border:1.5px solid #0B4F8A;border-radius:8px;color:#0B4F8A;font-weight:700;text-decoration:none">Crear la cuenta de mi empresa · 15 días gratis</a>' +
      '<div id="gc-demobox" hidden style="border:1px solid #DCE5EE;border-radius:10px;padding:10px;background:#E3F6F2;font-size:13px">Entre a la «Empresa Demo» como:<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
      '<button type="button" data-demo="admin" style="padding:8px 10px;border:0;border-radius:8px;background:#14A38B;color:#fff;font-weight:600;cursor:pointer">Administrador</button>' +
      '<button type="button" data-demo="supervisor" style="padding:8px 10px;border:0;border-radius:8px;background:#14A38B;color:#fff;font-weight:600;cursor:pointer">Supervisor</button>' +
      '<button type="button" data-demo="asesor" style="padding:8px 10px;border:0;border-radius:8px;background:#14A38B;color:#fff;font-weight:600;cursor:pointer">Asesor</button></div></div>' +
      '<div style="display:flex;align-items:center;gap:8px;border-top:1px solid #DCE5EE;padding-top:12px;font-size:12px;color:#5D6B78"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="26" height="26" aria-hidden="true"><rect x="4" y="4" width="192" height="192" rx="46" fill="#1E3A4C"/><g stroke="#FFFFFF" stroke-linecap="round"><polygon points="100,42 150.2,71 150.2,129 100,158 49.8,129 49.8,71" fill="none" stroke-opacity=".35" stroke-width="4"/><path d="M100 100L100 42M100 100L150.2 71M100 100L150.2 129M100 100L100 158M100 100L49.8 129M100 100L49.8 71" stroke-width="6"/></g><g fill="#FFFFFF"><circle cx="150.2" cy="71" r="10"/><circle cx="150.2" cy="129" r="10"/><circle cx="100" cy="158" r="10"/><circle cx="49.8" cy="129" r="10"/><circle cx="49.8" cy="71" r="10"/></g><circle cx="100" cy="42" r="13" fill="#E0A21A"/><circle cx="100" cy="100" r="20" fill="#E0A21A"/></svg><span>Un producto de <b style="font-family:\'Barlow Condensed\',sans-serif;letter-spacing:.02em"><span style="color:#1E3A4C">SKYNET</span> <span style="color:#E0A21A">GENESIS</span></b><br>Soporte: WhatsApp 304 437 5758</span></div></form></div>';
    document.body.innerHTML = ""; document.body.appendChild(w);
    function enter(j) {
      try { localStorage.setItem(TOK_KEY, j.token); localStorage.setItem("atd_me", JSON.stringify(j.user.id)); if (j.user.tid) localStorage.setItem("atd_tid", JSON.stringify(j.user.tid)); localStorage.setItem("atd_view", JSON.stringify(j.user.staff ? "clientes" : j.user.role === "asesor" ? "midia" : "panel")); } catch (e) {}
      location.hash = ""; location.reload();
    }
    var post = function (u, b) { return fetch(API + u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }); };
    var errEl = document.getElementById("gc-err");
    document.getElementById("gc-demo").onclick = function (e) { e.preventDefault(); var b = document.getElementById("gc-demobox"); b.hidden = !b.hidden; };
    w.querySelectorAll("[data-demo]").forEach(function (b) { b.onclick = function () { errEl.textContent = "Entrando a la demostración…"; post("/api/auth/demo", { role: b.dataset.demo }).then(function (x) { if (!x.ok) { errEl.textContent = x.j.error || "La demostración no está disponible."; return; } enter(x.j); }).catch(function () { errEl.textContent = "No hay conexión con el servidor."; }); }; });
    document.getElementById("gc-forgot").onclick = function (e) {
      e.preventDefault(); var f = document.getElementById("gc-login"), em = f.email.value.trim();
      if (!em) { errEl.textContent = "Escriba su correo arriba y vuelva a pulsar «¿Olvidó su contraseña?»."; f.email.focus(); return; }
      errEl.style.color = "#5D6B78"; errEl.textContent = "Enviando…";
      post("/api/auth/olvido", { email: em }).then(function (x) { errEl.style.color = "#0E8571"; var mk = em.replace(/^(.{2})[^@]*(@.*)$/, function (_, a, d) { return a + "\u2022\u2022\u2022\u2022\u2022\u2022" + d; }); errEl.textContent = "Si " + mk + " tiene una cuenta, le enviamos un enlace para crear una contraseña nueva. Revise también la carpeta de correo no deseado."; }).catch(function () { errEl.style.color = "#B93A27"; errEl.textContent = "No hay conexión con el servidor."; });
    };
    // Registro propio de la empresa (15 días de prueba gratis, sin tarjeta)
    var IN = 'display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #DCE5EE;border-radius:8px;font:inherit';
    function registro() {
      var f0 = document.getElementById("gc-login");
      var sec = ["Salud / IPS", "Odontología", "Colegio / educación", "Instituto técnico / cursos", "Comercio / ferretería", "Inmobiliaria", "Restaurante", "Taller / servicios técnicos"];
      f0.innerHTML = '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:28px;font-weight:700;color:#0B4F8A">Cree la cuenta de su empresa</div>' +
        '<div style="color:#5D6B78;margin-top:-8px;font-size:14px">15 días de prueba gratis, sin tarjeta. Al terminar, si quiere seguir, paga la mensualidad en línea.</div>' +
        '<label style="font-size:13px;font-weight:600">Nombre de la empresa<input name="empresa" required maxlength="80" autocomplete="organization" style="' + IN + '"></label>' +
        '<label style="font-size:13px;font-weight:600">Sector<select name="sector" style="' + IN + '"><option value="" selected>Seleccione su sector…</option>' + sec.map(function (x) { return '<option>' + x + '</option>'; }).join("") + '<option value="">Otro</option></select></label>' +
        '<label style="font-size:13px;font-weight:600">Ciudad<input name="ciudad" maxlength="60" autocomplete="address-level2" style="' + IN + '"></label>' +
        '<label style="font-size:13px;font-weight:600">Su nombre completo<input name="nombre" required maxlength="80" autocomplete="name" style="' + IN + '"></label>' +
        '<label style="font-size:13px;font-weight:600">Su correo (aquí le llega el enlace para crear la contraseña)<input name="correo" type="email" required maxlength="120" autocomplete="email" style="' + IN + '"></label>' +
        '<label style="font-size:13px;font-weight:600">Celular<input name="celular" type="tel" required maxlength="20" inputmode="tel" placeholder="300 123 4567" autocomplete="tel" style="' + IN + '"></label>' +
        '<label style="font-size:13px;font-weight:600">Plan que quiere probar<select name="plan" style="' + IN + '"><option value="basico">Básico · $190.000/mes</option><option value="pro" selected>Profesional · $390.000/mes</option><option value="empresarial">Empresarial · $790.000/mes</option></select></label>' +
        '<input name="web" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">' +
        '<label style="display:grid;grid-template-columns:20px 1fr;gap:8px;font-size:12px;color:#5D6B78"><input name="acepto" type="checkbox" style="margin-top:2px"><span>Acepto las condiciones del servicio de Agente-IA y autorizo a SkyNet Genesis a tratar estos datos para crear y atender mi cuenta, según la Ley 1581 de 2012. Puedo pedir que los borren escribiendo a contacto@skynetgenesis.com.</span></label>' +
        '<button style="padding:12px;border:0;border-radius:8px;background:#14A38B;color:#fff;font-weight:600;font-size:15px;cursor:pointer">Crear mi cuenta gratis</button><div id="gc-err3" role="status" style="font-size:13px"></div><a href="#" id="gc-back2" style="font-size:13px;color:#0B4F8A">← Ya tengo cuenta: ingresar</a>';
      document.getElementById("gc-back2").onclick = function (e) { e.preventDefault(); location.hash = ""; location.reload(); };
      f0.onsubmit = function (e) {
        e.preventDefault(); var m = document.getElementById("gc-err3"), bt = f0.querySelector("button");
        var d = { empresa: f0.empresa.value, sector: f0.sector.value, ciudad: f0.ciudad.value, nombre: f0.nombre.value, correo: f0.correo.value, celular: f0.celular.value, plan: f0.plan.value, acepto: f0.acepto.checked, web: f0.web.value };
        if (!d.acepto) { m.style.color = "#B93A27"; m.textContent = "Para crear la cuenta debe aceptar las condiciones y el tratamiento de datos."; return; }
        m.style.color = "#5D6B78"; m.textContent = "Creando su cuenta…"; bt.disabled = true;
        post("/api/public/registro", d).then(function (x) {
          bt.disabled = false;
          if (!x.ok) { m.style.color = "#B93A27"; m.textContent = x.j.error || "No se pudo crear la cuenta."; return; }
          f0.innerHTML = '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:28px;font-weight:700;color:#0B4F8A">¡Listo! Revise su correo</div>' +
            '<p style="margin:0">Le enviamos a <b>' + String(x.j.correo || d.correo).replace(/[<>&"]/g, "") + '</b> un enlace para crear su contraseña (vale por 24 horas). Si no lo ve, revise la carpeta de correo no deseado.</p>' +
            (x.j.correoOk === false ? '<p style="margin:0;color:#B93A27">El correo no salió en este momento. Use «¿Olvidó su contraseña?» con su correo en unos minutos, o escríbanos por WhatsApp (304 437 5758).</p>' : '') +
            '<p style="margin:0;color:#5D6B78;font-size:14px">Su prueba gratis de 15 días ya empezó. Al ingresar, complete la base de conocimiento: con eso SofIA empieza a responderles a sus clientes.</p>' +
            '<a href="#" id="gc-back3" style="font-size:14px;color:#0B4F8A;font-weight:600">Ir al ingreso</a>';
          document.getElementById("gc-back3").onclick = function (ev) { ev.preventDefault(); location.hash = ""; location.reload(); };
        }).catch(function () { bt.disabled = false; m.style.color = "#B93A27"; m.textContent = "No hay conexión con el servidor. Intente de nuevo."; });
      };
    }
    document.getElementById("gc-reg").onclick = function (e) { e.preventDefault(); location.hash = "registro"; registro(); };
    if (/registro/.test(location.hash)) { registro(); return; }
    // Enlace directo a la demostración desde skynetgenesis.com (#demo): entra como Administrador de la Empresa Demo
    if (/^#demo/.test(location.hash)) { var dmb = w.querySelector('[data-demo="admin"]'); history.replaceState(null, "", location.pathname); if (dmb) { dmb.click(); return; } }
    var rt = (location.hash.match(/reset=([A-Za-z0-9_-]+)/) || [])[1];
    if (rt) {
      var f0 = document.getElementById("gc-login");
      f0.innerHTML = '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:28px;font-weight:700;color:#0B4F8A">Nueva contraseña</div>' +
        '<label style="font-size:13px;font-weight:600">Escriba la nueva contraseña (mínimo 8 caracteres)<input name="np" type="password" minlength="8" required autocomplete="new-password" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #DCE5EE;border-radius:8px;font:inherit"></label>' +
        '<button style="padding:12px;border:0;border-radius:8px;background:#14A38B;color:#fff;font-weight:600;font-size:15px;cursor:pointer">Guardar contraseña</button><div id="gc-err2" role="status" style="font-size:13px"></div><a href="#" id="gc-back" style="font-size:13px;color:#0B4F8A">← Volver al ingreso</a>';
      f0.onsubmit = function (e) { e.preventDefault(); var m = document.getElementById("gc-err2"); m.textContent = "Guardando…";
        post("/api/auth/reset", { token: rt, password: f0.np.value }).then(function (x) { if (!x.ok) { m.style.color = "#B93A27"; m.textContent = x.j.error; return; } m.style.color = "#0E8571"; m.textContent = "Listo. Ya puede ingresar con su nueva contraseña."; setTimeout(function () { location.hash = ""; location.reload(); }, 1800); }).catch(function () { m.style.color = "#B93A27"; m.textContent = "No hay conexión con el servidor. Intente de nuevo."; }); };
      document.getElementById("gc-back").onclick = function (e) { e.preventDefault(); location.hash = ""; location.reload(); };
      return;
    }
    document.getElementById("gc-login").onsubmit = function (e) {
      e.preventDefault(); var f = e.target, err = document.getElementById("gc-err"); err.textContent = "Ingresando…";
      fetch(API + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: f.email.value, password: f.password.value }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) { err.textContent = x.j.error || "No se pudo ingresar."; return; } if (x.j) { enter(x.j); return; }
          try { localStorage.setItem(TOK_KEY, x.j.token); localStorage.setItem("atd_me", JSON.stringify(x.j.user.id)); if (x.j.user.tid) localStorage.setItem("atd_tid", JSON.stringify(x.j.user.tid)); localStorage.setItem("atd_view", JSON.stringify(x.j.user.staff ? "clientes" : x.j.user.role === "asesor" ? "midia" : "panel")); } catch (e2) {}
          location.reload();
        }).catch(function () { err.textContent = "No hay conexión con el servidor."; });
    };
  }
  // Botón Mostrar / Ocultar en todos los campos de contraseña (directiva: ingreso como el panel de skynetgenesis.com/admin)
  function eyes(root) {
    (root || document).querySelectorAll('input[type="password"]:not([data-eye])').forEach(function (i) {
      i.setAttribute("data-eye", "1");
      var w = document.createElement("span"); w.style.cssText = "position:relative;display:block";
      i.parentNode.insertBefore(w, i); w.appendChild(i); i.style.paddingRight = "86px";
      var b = document.createElement("button"); b.type = "button"; b.textContent = "Mostrar"; b.setAttribute("aria-label", "Mostrar la contraseña");
      b.style.cssText = "position:absolute;right:6px;top:50%;transform:translateY(-50%);border:1px solid #DCE5EE;background:#FFFFFF;color:#0B4F8A;border-radius:6px;padding:4px 10px;font:600 12px system-ui,sans-serif;cursor:pointer";
      b.onclick = function () { var show = i.type === "password"; i.type = show ? "text" : "password"; b.textContent = show ? "Ocultar" : "Mostrar"; b.setAttribute("aria-label", show ? "Ocultar la contraseña" : "Mostrar la contraseña"); i.focus(); };
      w.appendChild(b);
    });
  }
  try { new MutationObserver(function () { eyes(document); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  eyes(document); setTimeout(function () { eyes(document); }, 300);
  document.addEventListener("DOMContentLoaded", function () { eyes(document); });

  // Un enlace para crear la contraseña (o el registro) se atiende aunque el navegador tenga una sesión abierta (por ejemplo la demo)
  if (token && (/reset=/.test(location.hash) || (/registro/.test(location.hash) && (function () { try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).demo; } catch (e) { return true; } })()))) { try { localStorage.removeItem(TOK_KEY); localStorage.removeItem("atd_me"); localStorage.removeItem("atd_tid"); localStorage.removeItem("atd_view"); } catch (e) {} token = null; }
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
