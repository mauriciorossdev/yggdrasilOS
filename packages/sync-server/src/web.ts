import type { IncomingMessage, ServerResponse } from "node:http";
import type Database from "better-sqlite3";
import { getBundle, getShare } from "./db.js";

/**
 * Browser pages for people who don't use the desktop app (see
 * routes.ts's createWebLink). These routes are public on purpose — they only
 * serve page shells and the plugin's own static code; the actual shared
 * content still goes through the authenticated /v1/shares/:id API (link key +
 * email gate), called from the browser.
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export type BundleMeta = { project: { id: string; name: string }; pluginId: string; pluginName: string; storageKey: string };

export function webRoute(req: IncomingMessage, res: ServerResponse, db: Database.Database): boolean {
  if (req.method !== "GET") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean); // ["w", shareId, ...]
  if (parts[0] !== "w" || !parts[1]) return false;
  const shareId = parts[1];

  if (parts.length === 2) {
    // Unknown share ids get the same shell — the page itself reports the API's
    // 403/404, so this route can't be used to probe which ids exist.
    send(res, 200, MIME[".html"], viewerHtml(shareId));
    return true;
  }

  if (parts.length === 3 && parts[2] === "ygg-web.js") {
    const bundle = getBundle(db, shareId);
    const share = getShare(db, shareId);
    if (!bundle || !share) {
      send(res, 404, MIME[".txt"], "not found");
      return true;
    }
    const meta = JSON.parse(bundle.project_json) as Partial<BundleMeta>;
    send(res, 200, MIME[".js"], yggWebShim(shareId, meta, share.resource_key));
    return true;
  }

  if (parts.length === 4 && parts[2] === "app") {
    const bundle = getBundle(db, shareId);
    const name = decodeURIComponent(parts[3]);
    const files = bundle ? (JSON.parse(bundle.files_json) as Record<string, string>) : {};
    if (!Object.prototype.hasOwnProperty.call(files, name)) {
      send(res, 404, MIME[".txt"], "not found");
      return true;
    }
    let body = files[name];
    if (name === "index.html") body = body.split("ygg-plugin://sdk/ygg.js").join(`/w/${encodeURIComponent(shareId)}/ygg-web.js`);
    send(res, 200, MIME[extOf(name)] ?? "application/octet-stream", body);
    return true;
  }

  return false;
}

/**
 * Browser stand-in for the desktop's `window.ygg` SDK (app-desktop's
 * main/pluginSdk.ts), covering only what a shared plugin needs to show and
 * edit its one shared storage key: ready/storage/app.theme/on. fs/panes/
 * gateway are deliberately absent — plugins already guard those with
 * `typeof ... === "function"`, so those features just switch off on the web.
 */
function yggWebShim(shareId: string, meta: Partial<BundleMeta>, resourceKey: string): string {
  const config = {
    shareId,
    storageKey: meta.storageKey || resourceKey.split(":").pop() || "",
    project: meta.project ?? { id: "", name: "" },
    plugin: { id: meta.pluginId ?? "", name: meta.pluginName ?? "", scope: "project", permissions: [] },
  };
  return `(function () {
  if (window.ygg) return;
  var CFG = ${JSON.stringify(config)};
  var THEME = { colorScheme: "dark", accent: "#4a9eff", border: "transparent", bg: "#14161a", panel: "#191b20", line: "#2a2d33", fg: "#e6e6e6", muted: "#8a8f98" };
  var version = null;
  var role = "view";
  var queue = Promise.resolve();

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function notify(kind, text) { try { window.parent.postMessage({ type: "ygg-web:notice", kind: kind, text: text }, window.location.origin); } catch (e) {} }

  function api(method, body) {
    var headers = { "Authorization": "Bearer " + (lsGet("ygs:" + CFG.shareId) || ""), "X-Share-Email": encodeURIComponent(lsGet("ygs-email:" + CFG.shareId) || "") };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch("/v1/shares/" + encodeURIComponent(CFG.shareId), { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }

  function authFailure(r) {
    if (r.status === 401 || r.status === 403 || r.status === 429) { notify("auth", (r.body && r.body.error) || "No autorizado"); return true; }
    return false;
  }

  var local = {};
  function localKey(k) { return "ygs-local:" + CFG.shareId + ":" + k; }

  function getShared() {
    return api("GET").then(function (r) {
      if (authFailure(r)) throw new Error("No autorizado");
      if (r.status !== 200) throw new Error((r.body && r.body.error) || "Error " + r.status);
      version = r.body.version;
      role = r.body.role;
      notify("role", role);
      try { return JSON.parse(r.body.content); } catch (e) { return null; }
    });
  }

  function putShared(value) {
    if (role === "view") { notify("warn", "Solo lectura: tus cambios no se guardan."); return Promise.resolve(null); }
    queue = queue.then(function () {
      return api("PUT", { content: JSON.stringify(value === undefined ? null : value), expectedVersion: version }).then(function (r) {
        if (r.status === 200) { version = r.body.version; notify("saved", "Guardado"); return null; }
        if (r.status === 409) { notify("conflict", "Alguien más editó esto. Recarga para ver la última versión (tu último cambio no se guardó)."); return null; }
        if (authFailure(r)) return null;
        notify("warn", (r.body && r.body.error) || "No se pudo guardar");
        return null;
      });
    }).catch(function () { notify("warn", "Sin conexión: no se pudo guardar"); return null; });
    return queue;
  }

  var info = { plugin: CFG.plugin, project: CFG.project, theme: THEME, visible: true };
  function noop() { return function () {}; }

  window.ygg = {
    ready: function () { return Promise.resolve(info); },
    storage: {
      get: function (key) {
        if (key === CFG.storageKey) return getShared();
        var raw = lsGet(localKey(key));
        if (raw == null) return Promise.resolve(local[key] === undefined ? null : local[key]);
        try { return Promise.resolve(JSON.parse(raw)); } catch (e) { return Promise.resolve(null); }
      },
      set: function (key, value) {
        if (key === CFG.storageKey) return putShared(value);
        local[key] = value;
        lsSet(localKey(key), JSON.stringify(value));
        return Promise.resolve(null);
      },
      delete: function (key) {
        if (key === CFG.storageKey) return Promise.resolve(null);
        delete local[key];
        try { localStorage.removeItem(localKey(key)); } catch (e) {}
        return Promise.resolve(null);
      },
      keys: function () { return Promise.resolve([CFG.storageKey]); }
    },
    app: {
      theme: function () { return Promise.resolve(THEME); },
      info: function () { return Promise.resolve(info); }
    },
    on: noop,
    tools: { register: function () {} }
  };
})();
`;
}

function viewerHtml(shareId: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<link rel="icon" href="data:," />
<title>Yggdrasil compartido</title>
<style>
  :root { --bg:#f6f7f9; --panel:#ffffff; --fg:#1b1d22; --muted:#667085; --line:#e3e6eb; --accent:#2f6fde; --danger:#c2410c; --ok:#15803d; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161a; --panel:#191b20; --fg:#e6e6e6; --muted:#8a8f98; --line:#2a2d33; --accent:#4a9eff; --danger:#f97316; --ok:#4ade80; } }
  /* Plugins get the desktop's fixed dark palette (ygg-web.js THEME) — match it around the iframe. */
  :root.dark { --bg:#14161a; --panel:#191b20; --fg:#e6e6e6; --muted:#8a8f98; --line:#2a2d33; --accent:#4a9eff; --danger:#f97316; --ok:#4ade80; }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  body { display:flex; flex-direction:column; }
  header { display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid var(--line); background:var(--panel); }
  header .title { font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  header .role { font-size:12px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:2px 10px; }
  #banner { display:none; padding:8px 16px; font-size:14px; border-bottom:1px solid var(--line); }
  #banner.show { display:flex; gap:12px; align-items:center; }
  #banner.conflict, #banner.warn, #banner.auth { background:color-mix(in srgb, var(--danger) 14%, var(--panel)); }
  #banner.saved { background:color-mix(in srgb, var(--ok) 14%, var(--panel)); }
  main { flex:1; min-height:0; display:flex; }
  .center { margin:auto; width:100%; max-width:380px; padding:24px 16px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:24px; }
  .card h1 { font-size:18px; margin:0 0 6px; }
  .card p { margin:0 0 16px; color:var(--muted); font-size:14px; }
  input[type=email] { width:100%; padding:10px 12px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--fg); font:inherit; }
  button { font:inherit; padding:8px 14px; border-radius:8px; border:1px solid var(--line); background:var(--panel); color:var(--fg); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button:disabled { opacity:.5; cursor:default; }
  .card button.primary { width:100%; margin-top:12px; padding:10px; }
  .err { color:var(--danger); font-size:13px; min-height:1.4em; margin-top:8px; }
  iframe { flex:1; border:0; width:100%; }
  .notes { flex:1; display:grid; grid-template-columns:1fr 1fr; min-height:0; }
  .notes.view { grid-template-columns:1fr; }
  .notes textarea { resize:none; border:0; border-right:1px solid var(--line); padding:16px; background:var(--bg); color:var(--fg); font:14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; outline:none; }
  .notes .preview { overflow:auto; padding:16px 24px; }
  .notes .preview pre { overflow:auto; background:var(--panel); padding:12px; border-radius:8px; }
  .notes .preview img { max-width:100%; }
  @media (max-width: 720px) { .notes { grid-template-columns:1fr; grid-template-rows:1fr 1fr; } .notes textarea { border-right:0; border-bottom:1px solid var(--line); } }
</style>
</head>
<body>
<header><span class="title" id="title">Yggdrasil</span><span class="role" id="role" hidden></span><span id="actions"></span></header>
<div id="banner"><span id="bannerText"></span><button id="bannerReload" hidden>Recargar</button></div>
<main id="main"></main>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></script>
<script>
(function () {
  var SHARE_ID = ${JSON.stringify(shareId)};
  var KEY_LS = "ygs:" + SHARE_ID, EMAIL_LS = "ygs-email:" + SHARE_ID;
  var main = document.getElementById("main");
  var $ = function (id) { return document.getElementById(id); };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // The link key arrives in the URL fragment (never sent to the server);
  // move it into storage and scrub it from the address bar/history.
  var m = /[#&]k=([^&]+)/.exec(location.hash);
  if (m) { lsSet(KEY_LS, decodeURIComponent(m[1])); history.replaceState(null, "", location.pathname); }
  var key = lsGet(KEY_LS);

  function headers(json) {
    var h = { "Authorization": "Bearer " + (key || ""), "X-Share-Email": encodeURIComponent(lsGet(EMAIL_LS) || "") };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }
  function call(method, path, body) {
    return fetch("/v1/shares/" + encodeURIComponent(SHARE_ID) + path, { method: method, headers: headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }

  var bannerTimer = null;
  function banner(kind, text, withReload) {
    var b = $("banner");
    b.className = "show " + kind;
    $("bannerText").textContent = text;
    $("bannerReload").hidden = !withReload;
    clearTimeout(bannerTimer);
    if (kind === "saved") bannerTimer = setTimeout(function () { b.className = ""; }, 1500);
  }
  $("bannerReload").onclick = function () { location.reload(); };

  function setRole(role) { var r = $("role"); r.hidden = false; r.textContent = role === "view" ? "Solo lectura" : "Puede editar"; }

  var ERRORS = { email_mismatch: "Ese correo no tiene acceso a este link.", email_required: "Ingresa tu correo.", too_many_attempts: "Demasiados intentos. Espera 15 minutos." };

  function fatal(text) {
    main.innerHTML = "";
    var c = document.createElement("div"); c.className = "center";
    c.innerHTML = '<div class="card"><h1>No se puede abrir</h1><p></p></div>';
    c.querySelector("p").textContent = text;
    main.appendChild(c);
  }

  function askEmail(errorText) {
    main.innerHTML = "";
    var c = document.createElement("div"); c.className = "center";
    c.innerHTML = '<form class="card"><h1>Confirma tu correo</h1><p>Ingresa el correo con el que te compartieron este contenido.</p>' +
      '<input type="email" required autocomplete="email" placeholder="tu@correo.com" /><button class="primary" type="submit">Entrar</button><div class="err"></div></form>';
    main.appendChild(c);
    var form = c.querySelector("form"), input = c.querySelector("input"), err = c.querySelector(".err"), btn = c.querySelector("button");
    if (errorText) err.textContent = errorText;
    input.focus();
    form.onsubmit = function (e) {
      e.preventDefault();
      btn.disabled = true; err.textContent = "";
      var email = input.value.trim();
      call("POST", "/verify-email", { email: email }).then(function (r) {
        btn.disabled = false;
        if (r.status === 200) { lsSet(EMAIL_LS, email); load(); return; }
        err.textContent = ERRORS[r.body && r.body.error] || (r.body && r.body.error) || "No se pudo verificar";
      }, function () { btn.disabled = false; err.textContent = "Sin conexión"; });
    };
  }

  function load() {
    if (!key) return fatal("Este link está incompleto. Pide a quien te lo compartió que te lo envíe de nuevo.");
    if (!lsGet(EMAIL_LS)) return askEmail();
    call("GET", "").then(function (r) {
      if (r.status === 401 || (r.status === 403 && r.body && r.body.error === "email_mismatch")) { lsDel(EMAIL_LS); return askEmail(ERRORS[r.body.error]); }
      if (r.status === 429) return fatal(ERRORS.too_many_attempts);
      if (r.status === 403 || r.status === 404) return fatal("Este link ya no es válido (fue revocado o no existe).");
      if (r.status !== 200) return fatal((r.body && r.body.error) || "Error " + r.status);
      setRole(r.body.role);
      if (r.body.resourceType === "notes-file") renderNotes(r.body);
      else renderPlugin(r.body);
    }, function () { fatal("Sin conexión con el servidor."); });
  }

  function renderPlugin(share) {
    $("title").textContent = "Tablero compartido";
    document.documentElement.classList.add("dark");
    main.innerHTML = "";
    var frame = document.createElement("iframe");
    frame.src = "/w/" + encodeURIComponent(SHARE_ID) + "/app/index.html";
    frame.title = "Complemento compartido";
    main.appendChild(frame);
    window.addEventListener("message", function (e) {
      if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
      var msg = e.data || {};
      if (msg.type !== "ygg-web:notice") return;
      if (msg.kind === "role") return setRole(msg.text);
      if (msg.kind === "auth") { lsDel(EMAIL_LS); return askEmail(ERRORS[msg.text]); }
      banner(msg.kind, msg.text, msg.kind === "conflict");
    });
  }

  function renderNotes(share) {
    // resourceKey is "notes:<projectId>:<relativePath>" (app-desktop's notesResourceKey).
    var name = String(share.resourceKey || "").replace(/^notes:[^:]*:/, "").split("/").pop() || "Documento";
    $("title").textContent = name;
    document.title = name;
    var version = share.version, canEdit = share.role !== "view", dirty = false;
    main.innerHTML = "";
    var wrap = document.createElement("div"); wrap.className = "notes" + (canEdit ? "" : " view");
    var preview = document.createElement("div"); preview.className = "preview";
    function renderPreview(text) {
      var html = window.marked && window.DOMPurify ? DOMPurify.sanitize(marked.parse(text)) : null;
      if (html === null) { preview.textContent = text; return; }
      preview.innerHTML = html;
      preview.querySelectorAll("a").forEach(function (a) { a.target = "_blank"; a.rel = "noopener noreferrer"; });
    }
    if (canEdit) {
      var ta = document.createElement("textarea");
      ta.value = share.content; ta.spellcheck = false;
      ta.oninput = function () { dirty = true; save.disabled = false; renderPreview(ta.value); };
      wrap.appendChild(ta);
      var save = document.createElement("button"); save.className = "primary"; save.textContent = "Guardar"; save.disabled = true;
      $("actions").innerHTML = ""; $("actions").appendChild(save);
      save.onclick = function () { doSave(ta.value, version); };
      document.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (dirty) doSave(ta.value, version); } });
      window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
      function doSave(text, expected) {
        save.disabled = true;
        call("PUT", "", { content: text, expectedVersion: expected }).then(function (r) {
          if (r.status === 200) { version = r.body.version; dirty = false; banner("saved", "Guardado"); return; }
          save.disabled = false;
          if (r.status === 409) {
            banner("conflict", "Alguien más editó este documento. Recarga para ver su versión, o guarda de nuevo para sobrescribirla.", true);
            version = r.body.currentVersion;
            return;
          }
          if (r.status === 401 || r.status === 429 || (r.body && r.body.error === "email_mismatch")) { banner("auth", ERRORS[r.body.error] || "No autorizado"); return; }
          banner("warn", (r.body && r.body.error) || "No se pudo guardar");
        }, function () { save.disabled = false; banner("warn", "Sin conexión: no se guardó"); });
      }
    }
    wrap.appendChild(preview);
    main.appendChild(wrap);
    renderPreview(share.content);
  }

  load();
})();
</script>
</body>
</html>`;
}
