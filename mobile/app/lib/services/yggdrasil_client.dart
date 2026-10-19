import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../capabilities/capability_registry.dart';
import '../capabilities/device_capability.dart';
import 'capabilities_store.dart';
import 'device_tool_specs.dart';
import 'phone_auto_approve_store.dart';

// Names/params match notes/yggdrasil-mobile/phone-gateway-connectivity-design.md
// section 3.1 — shared with the standalone tool-loop via device_tool_specs.dart
// so gateway and standalone never declare these 4 tools differently.

class YggdrasilClient {
  final String baseUrl;
  final String apiKey;
  WebSocketChannel? _channel;
  int _nextId = 1;
  final Map<String, Completer<dynamic>> _pendingRequests = {};

  // Only one interactive device-tool call (SAF picker) can be in flight at a
  // time — matches the single native pick in MainActivity.kt and the mobile
  // UI's own "composer blocked during any turn" rule. Tracked so a
  // device.tool.invoke.cancel for this requestId can trigger the native
  // picker to close.
  String? _pendingInteractiveRequestId;
  String? _pendingInteractiveTool;

  String? currentProvider;
  String? currentModel;

  // Auto-reconnect state. The socket drops whenever the gateway redeploys,
  // the phone sleeps or switches wifi<->mobile data; without this every
  // screen holding this client would fail on a dead socket until app restart.
  void Function(dynamic)? _onMessage;
  void Function()? _onDisconnected;
  bool _intentionalClose = false;
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;
  Completer<void>? _reopenWaiter;

  /// Called each time this phone finishes registering its tools with the gateway
  /// (every connect and reconnect) — e.g. to register its push token.
  void Function()? onDeviceRegistered;

  /// Set by callers that have no Activity (the bubble's UI-less engine) so phone tools
  /// can still get their runtime permissions; null = ask with the normal dialog.
  PermissionRequester? permissionRequester;

  Completer<void> _deviceRegistered = Completer<void>();

  /// Completes once this connection has told the gateway which phone tools it
  /// offers (every connect and reconnect). A turn started before that links the
  /// chat session to a connection with no tools, so headless callers (the
  /// bubble) wait for it first. Never throws: after [timeout] it just returns.
  Future<void> whenDeviceRegistered({Duration timeout = const Duration(seconds: 10)}) =>
      _deviceRegistered.future.timeout(timeout, onTimeout: () {});

  YggdrasilClient({required this.baseUrl, required this.apiKey});

  // Set once the socket closes (see connectToMirror's onDone) — lets a
  // long-lived owner (PiChatScreen) notice and reconnect instead of polling
  // a dead channel forever.
  bool _closed = false;
  bool get isClosed => _closed;

  /// [timeout] is opt-in: gateway chat turns can legitimately run for
  /// minutes, so existing callers keep waiting indefinitely as before.
  Future<dynamic> call(String method, Map<String, dynamic> params, {Duration? timeout}) {
    if (_closed) return Future.error(StateError('WebSocket closed'));
    final id = (_nextId++).toString();
    final payload = jsonEncode({"id": id, "method": method, "params": params});
    final completer = Completer<dynamic>();
    _pendingRequests[id] = completer;
    
    print("Enviando vía WS: $payload");
    _channel?.sink.add(payload);
    if (timeout == null) return completer.future;
    return completer.future.timeout(timeout, onTimeout: () {
      _pendingRequests.remove(id);
      throw TimeoutException('$method timed out', timeout);
    });
  }

  Future<void> refreshConfig() async {
    final res = await call("config.get", {});
    final config = res['config'] ?? {};
    currentProvider = config['provider']?.toString();
    currentModel = config['model']?.toString();
    print("Configuración refrescada: Provider=$currentProvider, Model=$currentModel");
  }

  Future<List<dynamic>> getSlashCommands() async {
    final List<dynamic> tuiCommands = [
      {"name": "reset", "description": "Clear session history"},
      {"name": "config", "description": "Open configuration menu"},
      {"name": "sessions", "description": "List all sessions"},
      {"name": "agents", "description": "Manage agents"},
      {"name": "model", "description": "Jump to model selector"},
      {"name": "status", "description": "Show status"},
      {"name": "help", "description": "List all commands"},
      {"name": "new", "description": "Start a new isolated session"},
    ];

    try {
      final res = await call("skills.commands", {});
      final cmds = res['commands'] ?? [];
      return [...tuiCommands, ...cmds];
    } catch (e) {
      print("Error obteniendo comandos dinámicos: $e");
      return tuiCommands;
    }
  }

  Future<List<dynamic>> getProviders() async {
    final res = await call("providers.list", {});
    return res['providers'] ?? [];
  }

  // Workflows (notes/automation/workflows-design.md §7.5/§8.3) — the mobile
  // tab only lists/runs/cancels and reads run history/artifacts; it never
  // edits a workflow or grants one (that stays desktop-only, §6.2's
  // isLoopbackConnection gate on workflows.grant).
  Future<List<dynamic>> listWorkflows() async {
    final res = await call("workflows.list", {});
    return res['workflows'] ?? [];
  }

  Future<Map<String, dynamic>?> getWorkflow(String id) async {
    final res = await call("workflows.get", {"id": id});
    final workflow = res is Map ? res['workflow'] : null;
    return workflow is Map ? workflow.cast<String, dynamic>() : null;
  }

  /// Fires as a "mobile" trigger server-side (this connection isn't
  /// loopback) — the gateway requires the workflow's `allowRemoteTrigger`
  /// setting to be on, same gate the webhook route uses. A denied/skipped
  /// run comes back as `{run: null, skipped: true, reason: "..."}`, not an
  /// error — callers should check `result['run']` rather than only catching.
  Future<Map<String, dynamic>> runWorkflow(String id, {Map<String, dynamic>? input}) async {
    final res = await call("workflows.run", {"id": id, if (input != null) "input": input});
    return (res as Map).cast<String, dynamic>();
  }

  Future<bool> cancelWorkflowRun(String runId) async {
    final res = await call("workflows.cancel", {"runId": runId});
    return res is Map && res['ok'] == true;
  }

  Future<List<dynamic>> listWorkflowRuns({String? workflowId, int? limit}) async {
    final res = await call("workflows.runs.list", {
      if (workflowId != null) "workflowId": workflowId,
      if (limit != null) "limit": limit,
    });
    return res['runs'] ?? [];
  }

  Future<Map<String, dynamic>?> getWorkflowRun(String runId) async {
    final res = await call("workflows.runs.get", {"runId": runId});
    final run = res is Map ? res['run'] : null;
    return run is Map ? run.cast<String, dynamic>() : null;
  }

  /// No node type in this build produces an artifact yet — always throws
  /// server-side ("workflows.artifacts.get: no node type in this build
  /// produces artifacts yet"). Wrapper exists so the RPC surface matches
  /// the design doc now; callers shouldn't treat a thrown error here as
  /// unusual until some node actually returns an ArtifactRef.
  Future<dynamic> getWorkflowArtifact(String runId, String artifactId) async {
    return await call("workflows.artifacts.get", {"runId": runId, "artifactId": artifactId});
  }

  Future<dynamic> getConfig() async {
    return await call("config.get", {});
  }

  /// `patch` must already be shaped as `config.patch` expects: allowed
  /// top-level keys directly (agents/providers/language/...), never wrapped
  /// in a `{config: ...}` envelope — packages/config/src/patch.ts's
  /// validateConfigPatch rejects any key it doesn't recognize by name, and
  /// "config" itself isn't one of them (confirmed on-device: wrapping like
  /// this used to fail every save with "forbidden keys: config").
  Future<void> updateConfig(Map<String, dynamic> patch) async {
    await call("config.patch", patch);
    await refreshConfig(); // Actualizamos la config local tras patch
  }

  // Google connector (external-actions-and-connectors-analysis.md §1.3-b) —
  // token lives only on the gateway, never here. Shape confirmed with
  // Backend (redirect_uri is fixed server-side via GOOGLE_OAUTH_REDIRECT_URI
  // env var, single source of truth — the client never sends one).
  Future<({String authUrl, String state})> getGoogleAuthUrl() async {
    final res = await call("connectors.google.authUrl", {});
    if (res is! Map) return (authUrl: '', state: '');
    return (authUrl: res['authUrl']?.toString() ?? '', state: res['state']?.toString() ?? '');
  }

  // `state` is the CSRF nonce getGoogleAuthUrl() returned — required, the
  // gateway validates it against what it issued (single-use, 10min TTL).
  Future<bool> completeGoogleAuth({required String code, required String state}) async {
    final res = await call("connectors.google.completeAuth", {"code": code, "state": state});
    return res is Map && res['ok'] == true;
  }

  Future<bool> getGoogleConnectionStatus() async {
    final res = await call("connectors.google.status", {});
    return res is Map && res['connected'] == true;
  }

  // Device-local only — "memory_add" isn't a real gateway method (it was
  // never registered server-side, see methods.ts), so this always errored.
  // A per-device UI preference (last-picked provider/model, saved base URL)
  // belongs on the device anyway, not synced through the gateway.
  static const _prefPrefix = "yggdrasil_pref_";

  Future<void> savePreference(String key, String value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('$_prefPrefix$key', value);
  }

  Future<String?> loadPreference(String key) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('$_prefPrefix$key');
  }

  // A stable id for THIS phone, generated once and persisted — lets a
  // workflow's `phone.tool` node or "mobile" trigger address "that same
  // phone" across reconnects (packages/gateway/src/methods.ts's
  // deviceId<->connectionId maps), unlike connectionId (a fresh randomUUID
  // per WS socket). No uuid package in this app yet, so a timestamp + a
  // few bytes of math.Random entropy is good enough for "collision-free
  // within one household of phones", which is all this needs to be.
  static const _deviceIdKey = "${_prefPrefix}device_id";

  Future<String> getOrCreateDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_deviceIdKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final random = Random();
    final id =
        'phone-${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-${random.nextInt(0xFFFFFF).toRadixString(36)}';
    await prefs.setString(_deviceIdKey, id);
    return id;
  }

  static const _baseUrlKey = "${_prefPrefix}base_url";

  /// Static (not an instance method) since the saved URL is what the
  /// YggdrasilClient constructor itself needs, before any instance exists.
  static Future<String?> loadSavedBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_baseUrlKey);
  }

  static Future<void> saveBaseUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_baseUrlKey, url);
  }

  Future<String> getGatewayStatus() async {
    final response = await http.get(Uri.parse('$baseUrl/status'));
    if (response.statusCode == 200) {
      return response.body;
    } else {
      throw Exception('Failed to load status: ${response.statusCode}');
    }
  }

  void connectToMirror(Function(dynamic) onMessage, {void Function()? onDisconnected}) {
    _onMessage = onMessage;
    _onDisconnected = onDisconnected;
    _intentionalClose = false;
    _reconnectAttempt = 0;
    _open();
  }

  /// Completes once the socket is (re)opened; fails after [timeout]. Lets
  /// callers ride out a reconnect instead of failing on a closed socket.
  Future<void> whenOpen({Duration timeout = const Duration(seconds: 20)}) {
    if (!_closed) return Future.value();
    return (_reopenWaiter ??= Completer<void>()).future.timeout(timeout);
  }

  void _scheduleReconnect() {
    if (_intentionalClose) return;
    _reconnectTimer?.cancel();
    final seconds = [1, 2, 4, 8, 15][_reconnectAttempt.clamp(0, 4)];
    _reconnectAttempt++;
    _reconnectTimer = Timer(Duration(seconds: seconds), () {
      if (_intentionalClose) return;
      _closed = false;
      _open();
      _reopenWaiter?.complete();
      _reopenWaiter = null;
    });
  }

  void _open() {
    final onMessage = _onMessage!;
    final onDisconnected = _onDisconnected;
    // No apiKey in the query string (remote-access-analysis.md §4 item 1 —
    // over a real network, even with Tailscale/TLS, a URL query param ends
    // up logged by proxies/servers/history in a way the message body below
    // doesn't). The gateway doesn't need it there either: server.ts's
    // {method:"auth"} fallback below is a complete auth path on its own.
    // https -> wss (e.g. `tailscale serve`'s TLS endpoint); anything else
    // keeps the old plain-ws behavior.
    final parsed = Uri.parse(baseUrl);
    final uri = parsed.replace(scheme: (parsed.scheme == 'https' || parsed.scheme == 'wss') ? 'wss' : 'ws');
    _channel = WebSocketChannel.connect(uri);
    final channel = _channel!;
    // A failed connect (DNS, refused, TLS) is reported on `ready` AND on the
    // stream; the stream's onError/onDone below already handle it, so this
    // only keeps `ready` from surfacing as an unhandled exception.
    _channel!.ready.catchError((_) {});

    // Must be the first message sent: with no query apiKey, the connection
    // starts unauthenticated whenever isGatewayAuthRequired is true, and
    // server.ts:163-176 requires exactly this {method:"auth",...} as the
    // first WS message to authenticate — any other first message (e.g.
    // device.tools.register) gets read as the auth attempt instead, fails,
    // and wastes a round trip before the real auth message goes through.
    // Harmless no-op when auth isn't required at all.
    _channel!.sink.add(jsonEncode({
      "id": "init-auth",
      "method": "auth",
      "params": {"apiKey": apiKey}
    }));

    if (_deviceRegistered.isCompleted) _deviceRegistered = Completer<void>();
    final registered = _deviceRegistered;
    enabledDeviceToolSpecs()
        .then((tools) async {
          final deviceId = await getOrCreateDeviceId();
          return call("device.tools.register", {"deviceId": deviceId, "tools": tools});
        })
        .then((_) => onDeviceRegistered?.call())
        .catchError((_) {})
        .whenComplete(() {
          if (!registered.isCompleted) registered.complete();
        }); // socket closed before it was answered — nothing to register on

    _channel!.stream.listen(
      (data) {
        final response = jsonDecode(data.toString());
        print("Respuesta recibida: $response");
        if (response['id'] == 'init-auth' && response['error'] == null) _reconnectAttempt = 0;
        if (response['id'] != null && _pendingRequests.containsKey(response['id'])) {
          final completer = _pendingRequests.remove(response['id']);
          if (response['error'] != null) {
            completer!.completeError(response['error']);
          } else {
            completer!.complete(response['result']);
          }
        } else if (response['type'] == 'event' &&
            response['event'] == 'device.tool.invoke.requested') {
          _handleDeviceToolInvoke(response['payload'] as Map<String, dynamic>);
          onMessage(response); // also forwarded so the UI can show device-tool activity
        } else if (response['type'] == 'event' && response['event'] == 'tool.approval.requested') {
          unawaited(_routeApprovalRequest(response, onMessage));
        } else if (response['type'] == 'event' &&
            response['event'] == 'device.tool.invoke.cancel') {
          _handleDeviceToolCancel(response['payload'] as Map<String, dynamic>);
          onMessage(response); // UI also reacts to this (chat_screen.dart)
        } else {
          onMessage(response);
        }
      },
      onError: (error) => print('Error WS: $error'),
      onDone: () {
        print('Conexión cerrada. Código: ${channel.closeCode}, Razón: ${channel.closeReason}');
        // A stale socket's late onDone must not mark the live one closed.
        if (!identical(channel, _channel)) return;
        _closed = true;
        // Nothing will ever answer these now — fail them instead of leaving
        // their callers awaiting forever.
        final pending = Map.of(_pendingRequests);
        _pendingRequests.clear();
        for (final c in pending.values) {
          if (!c.isCompleted) c.completeError(StateError('WebSocket closed'));
        }
        onDisconnected?.call();
        _scheduleReconnect();
      },
    );
  }

  /// Phone-capability approvals are answered here when the user turned on
  /// auto-accept (PhoneAutoApproveStore) — before any chat UI, so it works from
  /// any screen. Falls back to the normal approval card if the answer fails.
  Future<void> _routeApprovalRequest(Map<String, dynamic> response, Function(dynamic) onMessage) async {
    final payload = (response['payload'] as Map?)?.cast<String, dynamic>() ?? {};
    if (capabilityByName(payload['toolName']?.toString()) != null &&
        await PhoneAutoApproveStore.isEnabled()) {
      try {
        await call("tools.approve", {"requestId": payload['requestId'], "approved": true});
        return;
      } catch (_) {
        // fall through to the normal card
      }
    }
    onMessage(response);
  }

  /// Re-sends device.tools.register with the freshly-filtered tool list —
  /// capabilities-settings-design.md §4 point 3. Called by the Capabilities
  /// screen after each toggle so a change applies mid-connection without
  /// forcing a reconnect (device.tools.register isn't connect-only, see
  /// phone-gateway-connectivity-design.md §3.1).
  Future<void> refreshRegisteredTools() async {
    final deviceId = await getOrCreateDeviceId();
    await call("device.tools.register", {"deviceId": deviceId, "tools": await enabledDeviceToolSpecs()});
  }

  Future<void> _handleDeviceToolInvoke(Map<String, dynamic> payload) async {
    final requestId = payload['requestId'];
    final toolName = payload['toolName'];
    final args = (payload['args'] as Map?)?.cast<String, dynamic>() ?? {};

    // Defense-in-depth (capabilities-settings-design.md §4 point 5) — the
    // model shouldn't be able to request a disabled tool at all under the
    // "disappears from the list" design, so this only covers the edge case
    // of a toggle landing between the model's decision to call it and this
    // handler running, or a stale cached tool list.
    if (!(await CapabilitiesStore.isEnabled(toolName as String))) {
      _channel?.sink.add(jsonEncode({
        "method": "device.tools.result",
        "params": {"requestId": requestId, "ok": false, "error": "capability_disabled"}
      }));
      return;
    }

    try {
      final capability = capabilityByName(toolName);
      if (capability == null) {
        throw PlatformException(code: 'unsupported_tool', message: 'Unknown device tool: $toolName');
      }
      final Map<String, dynamic> result;
      if (capability.isInteractive) {
        // Design doc §3.3 — fire "waiting on the user" before awaiting the
        // picker (the pick itself can take minutes). Fire-and-forget: a
        // slow/failed progress call shouldn't block or fail the pick.
        _pendingInteractiveRequestId = requestId as String?;
        _pendingInteractiveTool = toolName;
        unawaited(call("device.tool.invoke.progress", {"requestId": requestId, "status": "awaiting_user"}));
        try {
          result = await capability.invoke(args, requestPermissions: permissionRequester);
        } finally {
          if (_pendingInteractiveRequestId == requestId) {
            _pendingInteractiveRequestId = null;
            _pendingInteractiveTool = null;
          }
        }
      } else {
        result = await capability.invoke(args, requestPermissions: permissionRequester);
      }
      _channel?.sink.add(jsonEncode({
        "method": "device.tools.result",
        "params": {"requestId": requestId, "ok": true, "result": result}
      }));
    } on PlatformException catch (e) {
      _channel?.sink.add(jsonEncode({
        "method": "device.tools.result",
        "params": {
          "requestId": requestId,
          "ok": false,
          "error": e.message ?? e.code,
          if (e.details != null) "details": e.details,
        }
      }));
    } catch (e) {
      // Anything else (e.g. MissingPluginException on an engine without that native
      // channel) must still answer: left alone, the gateway waits out its 30 s timeout
      // and the model only learns "timeout".
      _channel?.sink.add(jsonEncode({
        "method": "device.tools.result",
        "params": {"requestId": requestId, "ok": false, "error": '$e'}
      }));
    }
  }

  // Best-effort UI cleanup for the picker that's actually open on this
  // device — the gateway has already resolved the tool call optimistically
  // by the time this event arrives (methods.ts:841-851), so this never sends
  // a device.tools.result of its own; native cancelPickDocument() just
  // closes the stale system picker.
  void _handleDeviceToolCancel(Map<String, dynamic> payload) {
    final requestId = payload['requestId'];
    if (requestId == null || requestId != _pendingInteractiveRequestId) return;
    capabilityByName(_pendingInteractiveTool)?.cancel?.call();
  }

  void sendMessage(String text, {String? sessionKey, String? agentId, String? model}) {
    final params = <String, dynamic>{
      "message": text,
      "sessionKey": sessionKey ?? "tui",
      "channelId": "tui",
    };

    // Bug fix (found running the real E2E against the Samsung, 2026-09-04):
    // this used to always include "agentId": agentId, which for the common
    // no-agentId-picked case sent literal JSON null. methods.ts:881 only
    // checks `params.agentId !== undefined` — null passes that check, so it
    // became the string "null" (String(null)), a bogus agent id that made
    // every chat.send silently fall back to the echo test harness instead of
    // the real LLM. Omitting the key entirely when unset lets the gateway's
    // own defaultAgent fallback apply instead.
    if (agentId != null) params["agentId"] = agentId;
    // The gateway applies a per-message provider/model ahead of the agent's
    // own (turn-kernel.ts dispatchToHarness), so an explicitly chosen agent —
    // e.g. the assistant pinned to Anthropic/Haiku — must not be overridden
    // by the gateway-wide defaults cached here.
    if (agentId == null) {
      if (currentProvider != null) params["provider"] = currentProvider!;
      if (currentModel != null) params["model"] = currentModel!;
    } else if (model != null) {
      // Explicit per-chat model choice (assistant model picker): model only,
      // never provider — the agent keeps owning which provider runs it.
      params["model"] = model;
    }

    call("chat.send", params);
  }

  void disconnect() {
    _intentionalClose = true;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
  }
}
