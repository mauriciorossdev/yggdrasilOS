/// Mobile's `window.ygg` — a deliberate subset of desktop's SDK
/// (pluginSdk.ts's PLUGIN_SDK_SOURCE). `ready/storage.*/fs.list+read/
/// app.notify+theme+info` round-trip through the `YggBridge` JavaScript
/// channel (ComplementoWebViewScreen's addJavaScriptChannel) using the same
/// request/response-by-id shape desktop's postMessage protocol uses, just
/// one layer shallower — Flutter's WebView already runs the page
/// out-of-process, so there's no parent/iframe split to relay through.
/// `panes.*`/`gateway.call`/`tools.register` reject immediately client-side
/// with a clear error instead of round-tripping to Dart just to bounce —
/// there's no terminal session *on the phone* to spawn panes for or expose
/// a tool to, see the mobile complementos design doc's v1 scope.
const String yggBridgeJs = r'''
(function () {
  var pending = {};
  var nextId = 1;
  var listeners = {};

  function send(method, params) {
    return new Promise(function (resolve, reject) {
      var id = String(nextId++);
      pending[id] = { resolve: resolve, reject: reject };
      window.YggBridge.postMessage(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }

  window.__yggReceive = function (msg) {
    if (msg.type === 'res') {
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    } else if (msg.type === 'event') {
      (listeners[msg.name] || []).forEach(function (fn) {
        try {
          fn(msg.data);
        } catch (e) {
          /* a listener's own error shouldn't break event dispatch for others */
        }
      });
    }
  };

  function unsupported(name) {
    return function () {
      return Promise.reject(new Error('ygg.' + name + ' is not available on mobile'));
    };
  }

  window.ygg = {
    ready: function () {
      return send('ready');
    },
    storage: {
      get: function (key) {
        return send('storage.get', { key: key });
      },
      set: function (key, value) {
        return send('storage.set', { key: key, value: value });
      },
      delete: function (key) {
        return send('storage.delete', { key: key });
      },
      keys: function () {
        return send('storage.keys');
      },
    },
    fs: {
      // Read-only on mobile, and unlike desktop's "fs" permission not
      // gated by the manifest at all — it's the same project the user
      // already has full read access to via the app's own Files tab, so a
      // complemento reading it gains no new exposure.
      list: function (relativePath) {
        return send('fs.list', { relativePath: relativePath });
      },
      read: function (relativePath) {
        return send('fs.read', { relativePath: relativePath });
      },
      write: unsupported('fs.write'),
      mkdir: unsupported('fs.mkdir'),
    },
    panes: {
      list: unsupported('panes.list'),
      create: unsupported('panes.create'),
      write: unsupported('panes.write'),
    },
    gateway: { call: unsupported('gateway.call') },
    tools: { register: unsupported('tools.register') },
    app: {
      notify: function (title, body) {
        return send('app.notify', { title: title, body: body });
      },
      theme: function () {
        return send('app.theme');
      },
      info: function () {
        return send('app.info');
      },
      openFile: unsupported('app.openFile'),
      openTab: unsupported('app.openTab'),
    },
    on: function (name, fn) {
      listeners[name] = listeners[name] || [];
      listeners[name].push(fn);
      return function () {
        listeners[name] = (listeners[name] || []).filter(function (f) {
          return f !== fn;
        });
      };
    },
  };
})();
''';
