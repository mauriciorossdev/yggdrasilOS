import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

/// https -> wss, http -> ws (same rule as YggdrasilClient).
Uri wsUriFor(String baseUrl) {
  final parsed = Uri.parse(baseUrl);
  return parsed.replace(scheme: (parsed.scheme == 'https' || parsed.scheme == 'wss') ? 'wss' : 'ws');
}

/// One authenticated JSON-RPC call over a short-lived socket — no device-tool
/// registration or event stream, unlike YggdrasilClient.
Future<dynamic> hubRpc(
  String baseUrl,
  String apiKey,
  String method,
  Map<String, dynamic> params, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  final channel = WebSocketChannel.connect(wsUriFor(baseUrl));
  final done = Completer<dynamic>();
  final sub = channel.stream.listen(
    (data) {
      final msg = jsonDecode(data.toString());
      if (msg is! Map) return;
      if (msg['id'] == 'auth') {
        if (msg['error'] != null) {
          if (!done.isCompleted) done.completeError(StateError('unauthorized'));
          return;
        }
        channel.sink.add(jsonEncode({'id': 'call', 'method': method, 'params': params}));
      } else if (msg['id'] == 'call' && !done.isCompleted) {
        if (msg['error'] != null) {
          done.completeError(StateError((msg['error'] as Map)['message']?.toString() ?? 'error'));
        } else {
          done.complete(msg['result']);
        }
      }
    },
    onError: (Object e) {
      if (!done.isCompleted) done.completeError(e);
    },
    onDone: () {
      if (!done.isCompleted) done.completeError(StateError('connection closed'));
    },
  );
  try {
    channel.sink.add(jsonEncode({'id': 'auth', 'method': 'auth', 'params': {'apiKey': apiKey}}));
    return await done.future.timeout(timeout);
  } finally {
    await sub.cancel();
    await channel.sink.close();
  }
}

/// True if a gateway answers at [baseUrl] and accepts [apiKey] within [timeout].
Future<bool> probeGateway(String baseUrl, String apiKey, {Duration timeout = const Duration(seconds: 3)}) async {
  try {
    await hubRpc(baseUrl, apiKey, 'workspace.info', const {}, timeout: timeout);
    return true;
  } catch (_) {
    return false;
  }
}
