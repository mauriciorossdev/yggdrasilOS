/**
 * `window.ygg` — served as a plain script at ygg-plugin://sdk/ygg.js (see
 * pluginProtocol.ts) so a plugin's index.html can just
 * `<script src="ygg-plugin://sdk/ygg.js"></script>` without any bundler.
 * Deliberately plain ES5-ish JS (not TypeScript, not built) — it runs
 * unmodified inside the plugin's own sandboxed document, which has no build
 * step of its own.
 *
 * The plugin's iframe has NO `allow-same-origin` (see PluginFrame.tsx) — its
 * document origin is opaque, so `event.origin` is always the string "null"
 * and can never be used as a postMessage targetOrigin. This SDK therefore
 * identifies the host by `event.source === window.parent` instead (stronger
 * than an origin string anyway, since it's a direct object identity check),
 * and always posts with targetOrigin "*" — safe here because the message
 * only ever reaches the one contentWindow the host itself created.
 */
export const PLUGIN_SDK_SOURCE = `(function () {
  if (window.ygg) return;
  var pending = new Map();
  var listeners = { theme: new Set(), visibility: new Set(), "fs.changed": new Set(), "storage.changed": new Set() };
  var readyResolve;
  var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });
  // ygg.tools.register — handlers for calls the HOST initiates (ygg:toolcall),
  // the opposite direction from the ygg:req/ygg:res round trip below (there
  // the plugin asks the host for something; here the host asks the plugin's
  // own registered logic to run and report back via ygg:toolresult).
  var toolHandlers = new Map();

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "id-" + Math.random().toString(36).slice(2) + Date.now();
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ygg:res") {
      var p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || "plugin host error"));
    } else if (msg.type === "ygg:event") {
      if (msg.name === "init") readyResolve(msg.payload);
      var set = listeners[msg.name];
      if (set) {
        set.forEach(function (fn) {
          try {
            fn(msg.payload);
          } catch (e) {
            /* a listener's own error must not break delivery to the others */
          }
        });
      }
    } else if (msg.type === "ygg:toolcall") {
      var handler = toolHandlers.get(msg.tool);
      if (!handler) {
        window.parent.postMessage(
          { type: "ygg:toolresult", callId: msg.callId, ok: false, error: "tool no registrada: " + msg.tool },
          "*",
        );
        return;
      }
      Promise.resolve()
        .then(function () {
          return handler(msg.params);
        })
        .then(function (result) {
          window.parent.postMessage({ type: "ygg:toolresult", callId: msg.callId, ok: true, result: result }, "*");
        })
        .catch(function (err) {
          window.parent.postMessage(
            { type: "ygg:toolresult", callId: msg.callId, ok: false, error: (err && err.message) || String(err) },
            "*",
          );
        });
    }
  });

  function call(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = uuid();
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(new Error("ygg." + method + " timed out"));
      }, timeoutMs || 30000);
      pending.set(id, {
        resolve: function (v) {
          clearTimeout(timer);
          resolve(v);
        },
        reject: function (e) {
          clearTimeout(timer);
          reject(e);
        },
      });
      window.parent.postMessage({ type: "ygg:req", id: id, method: method, params: params }, "*");
    });
  }

  window.ygg = {
    ready: function () {
      return readyPromise;
    },
    call: call,
    storage: {
      get: function (key) {
        return call("storage.get", { key: key });
      },
      set: function (key, value) {
        return call("storage.set", { key: key, value: value });
      },
      delete: function (key) {
        return call("storage.delete", { key: key });
      },
      keys: function () {
        return call("storage.keys", {});
      },
    },
    fs: {
      list: function (relativePath) {
        return call("fs.list", { relativePath: relativePath || "" });
      },
      read: function (relativePath) {
        return call("fs.read", { relativePath: relativePath });
      },
      write: function (relativePath, content) {
        return call("fs.write", { relativePath: relativePath, content: content });
      },
      mkdir: function (relativePath) {
        return call("fs.mkdir", { relativePath: relativePath });
      },
    },
    gateway: {
      call: function (method, params) {
        return call("gateway.call", { method: method, params: params });
      },
    },
    mic: {
      start: function () {
        return call("mic.start", {});
      },
      stop: function () {
        return call("mic.stop", {});
      },
      transcribe: function () {
        return call("mic.transcribe", {}, 600000);
      },
    },
    panes: {
      list: function () {
        return call("panes.list", {});
      },
      create: function (spec) {
        return call("panes.create", spec || {});
      },
      write: function (id, text, pressEnter) {
        return call("panes.write", { id: id, text: text, pressEnter: pressEnter !== false });
      },
    },
    app: {
      openFile: function (relativePath) {
        return call("app.openFile", { relativePath: relativePath });
      },
      openTab: function (tab) {
        return call("app.openTab", { tab: tab });
      },
      theme: function () {
        return call("app.theme", {});
      },
      notify: function (title, body) {
        return call("app.notify", { title: title, body: body });
      },
      info: function () {
        return call("app.info", {});
      },
    },
    on: function (name, fn) {
      var set = listeners[name];
      if (!set) return function () {};
      set.add(fn);
      return function () {
        set.delete(fn);
      };
    },
    tools: {
      /** Registers what runs when this tool is called from outside (a claude/agy terminal session, see pluginsControlMcpShim.ts) — even while this complemento isn't open. Call this synchronously at load, not behind ygg.ready()'s await: a toolcall can arrive the instant ygg:ready fires. */
      register: function (name, handler) {
        if (toolHandlers.has(name)) {
          console.warn('ygg.tools.register: "' + name + '" ya estaba registrada, se reemplaza');
        }
        toolHandlers.set(name, handler);
      },
    },
  };

  // Console/error capture — additive, unsolicited postMessages (not part of
  // the ygg:req/ygg:res round trip above). Feeds StudioPreview's log panel;
  // a normal (non-Studio) PluginFrame just never listens for these two
  // message types, so this has zero effect outside the Estudio tab. Each
  // arg is serialized defensively (a circular ref or huge object must never
  // break the plugin's own real console call).
  function safeStringifyArg(a) {
    try {
      if (typeof a === "string") return a;
      return JSON.stringify(a);
    } catch (e) {
      try {
        return String(a);
      } catch (e2) {
        return "[unserializable]";
      }
    }
  }
  ["log", "warn", "error"].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      try {
        window.parent.postMessage(
          {
            type: "ygg:console",
            level: level,
            args: Array.prototype.slice.call(arguments).map(safeStringifyArg),
            timestamp: Date.now(),
          },
          "*",
        );
      } catch (e) {
        /* capture must never break the caller's real log call */
      }
      return orig.apply(console, arguments);
    };
  });
  window.addEventListener("error", function (e) {
    window.parent.postMessage(
      {
        type: "ygg:error",
        message: e.message || "Error",
        stack: e.error && e.error.stack ? String(e.error.stack) : undefined,
        timestamp: Date.now(),
      },
      "*",
    );
  });
  window.addEventListener("unhandledrejection", function (e) {
    var reason = e.reason;
    window.parent.postMessage(
      {
        type: "ygg:error",
        message: "Unhandled promise rejection: " + safeStringifyArg(reason),
        stack: reason && reason.stack ? String(reason.stack) : undefined,
        timestamp: Date.now(),
      },
      "*",
    );
  });

  window.parent.postMessage({ type: "ygg:ready" }, "*");
})();
`;
