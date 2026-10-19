import 'dart:async';

import 'package:shared_preferences/shared_preferences.dart';

import '../assistant/assistant_home_screen.dart' show assistantAgentId, assistantSessionKey;
import '../assistant/assistant_tts.dart';
import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';
import '../services/yggdrasil_client.dart';
import 'bubble_permissions.dart';

/// One-line, spoken-friendly description of an approval request ("alarm 07:30").
String describeApproval(String toolName, Map<dynamic, dynamic>? args) {
  final name = toolName.replaceFirst('phone_', '').replaceAll('_', ' ');
  final values = (args ?? const {})
      .values
      .where((v) => v is String || v is num || v is bool)
      .map((v) => '$v')
      .where((v) => v.isNotEmpty)
      .take(3)
      .join(', ');
  final line = values.isEmpty ? name : '$name: $values';
  return line.length > 90 ? '${line.substring(0, 89)}…' : line;
}

/// Result of one spoken exchange: the reply text, and whether Dart already
/// spoke it (false -> native falls back to Android's own text-to-speech).
class BubbleReply {
  final String text;
  final bool spoken;

  const BubbleReply(this.text, {required this.spoken});

  Map<String, dynamic> toMap() => {'text': text, 'spoken': spoken};
}

/// The bubble's brain: runs inside a headless Flutter engine (BubbleBrain.kt),
/// talks to the gateway on its own connection and speaks the reply — nothing
/// of the conversation is ever drawn on screen. The exchange lands in the same
/// persistent `assistant:main` session as the chat.
class BubbleAssistantSession {
  BubbleAssistantSession({
    required this.reportState,
    required this.requestApproval,
    required this.requestAndroidPermissions,
    YggdrasilClient Function(String baseUrl, String apiKey)? clientFactory,
  }) : _clientFactory = clientFactory ?? ((u, k) => YggdrasilClient(baseUrl: u, apiKey: k));

  /// 'thinking' | 'speaking' | 'idle' — drives the bubble's animation.
  final void Function(String state) reportState;

  /// Shows an approve/reject card natively (the user answers via [answerApproval]).
  final void Function(String requestId, String toolName, String summary, String riskLevel) requestApproval;

  /// Shows Android's permission dialog through the native side (this engine has no Activity).
  final Future<bool> Function(List<String> androidPermissions) requestAndroidPermissions;

  final YggdrasilClient Function(String baseUrl, String apiKey) _clientFactory;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  YggdrasilClient? _client;
  String? _connectedTo;

  Future<YggdrasilClient> _ensureClient() async {
    final profile = await ProfileStore.getActive();
    if (profile == null || profile.type == ConnectionProfileType.direct || (profile.baseUrl ?? '').isEmpty) {
      throw StateError('gateway_required');
    }
    final target = '${profile.baseUrl}|${profile.apiKey}';
    var client = _client;
    if (client == null || _connectedTo != target) {
      client?.disconnect();
      client = _client = _clientFactory(profile.baseUrl!, profile.apiKey ?? '');
      _connectedTo = target;
      client.permissionRequester = (permissions) => requestInBackground(permissions, requestAndroidPermissions);
      client.connectToMirror((dynamic message) {
        if (message is Map<String, dynamic> && message['type'] == 'event') _events.add(message);
      });
    }
    await client.whenOpen();
    await client.whenDeviceRegistered();
    return client;
  }

  /// Sends [text] to the assistant and speaks the answer.
  Future<BubbleReply> ask(String text) async {
    // SharedPreferences caches per isolate: pick up what the app changed since
    // (auto-approve, TTS voice) before deciding anything.
    await (await SharedPreferences.getInstance()).reload();
    final client = await _ensureClient();
    reportState('thinking');

    final done = Completer<String>();
    final sub = _events.stream.listen((m) {
      final payload = (m['payload'] as Map?) ?? const {};
      if (payload['sessionKey'] != assistantSessionKey) return;
      switch (m['event']) {
        case 'chat.final':
          if (!done.isCompleted) done.complete(payload['text']?.toString() ?? '');
        case 'tool.approval.requested':
          requestApproval(
            payload['requestId']?.toString() ?? '',
            payload['toolName']?.toString() ?? '',
            describeApproval(payload['toolName']?.toString() ?? '', payload['args'] as Map?),
            payload['riskLevel']?.toString() ?? 'moderate',
          );
      }
    });

    try {
      client.sendMessage(text, sessionKey: assistantSessionKey, agentId: assistantAgentId);
      final reply = (await done.future.timeout(const Duration(minutes: 3))).trim();
      if (reply.isEmpty) return const BubbleReply('', spoken: true);

      reportState('speaking');
      final tts = AssistantTts.instance;
      await tts.load();
      await tts.speak(client, reply); // spoken regardless of the chat's "read aloud" switch
      return BubbleReply(reply, spoken: tts.lastError == null);
    } finally {
      await sub.cancel();
      reportState('idle');
    }
  }

  /// Answer to an approval card shown natively.
  Future<void> answerApproval(String requestId, bool approved) async {
    final client = _client;
    if (client == null || requestId.isEmpty) return;
    await client.call('tools.approve', {'requestId': requestId, 'approved': approved});
  }

  void dispose() {
    _client?.disconnect();
    _client = null;
    _events.close();
  }
}
