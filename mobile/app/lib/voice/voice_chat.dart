import '../l10n/app_strings.dart';
import '../profiles/connection_profile.dart';
import '../standalone/local_chat.dart';
import '../standalone/local_chat_store.dart';
import '../standalone/local_message.dart';
import '../standalone/persona.dart';
import '../standalone/standalone_chat_engine.dart';

/// The provider could not answer.
class VoiceReplyException implements Exception {
  final String message;
  const VoiceReplyException(this.message);

  @override
  String toString() => message;
}

/// The chat behind a voice conversation: sends what was said through the direct
/// chat engine (in voice mode) and hands back the assistant's final answer.
/// Everything lands in a normal saved chat, so the conversation can be read
/// afterwards in the chat list.
class VoiceChat {
  final StandaloneChatEngine engine;
  final LocalChat chat;

  /// Asked before a tool that needs the user's go-ahead (the engine's own gate).
  final Future<bool> Function(String toolName, Map<String, dynamic> args) confirm;

  VoiceChat({required this.engine, required this.chat, required this.confirm});

  /// A new saved chat for a voice session, on the default personality.
  static Future<VoiceChat> start(
    ConnectionProfile profile, {
    required Future<bool> Function(String toolName, Map<String, dynamic> args) confirm,
    StandaloneChatEngine? engine,
  }) async {
    final chat = LocalChat(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      profileId: profile.id,
      title: AppStrings.t('voice.mode.chatTitle'),
      personaId: await PersonaStore.defaultId(),
    );
    await LocalChatStore.upsert(chat);
    return VoiceChat(engine: engine ?? StandaloneChatEngine(profile), chat: chat, confirm: confirm);
  }

  /// Sends [text] and returns what the assistant answered once it is done with
  /// any tools; throws [VoiceReplyException] when the provider call fails.
  Future<String> ask(String text) async {
    var reply = '';
    Object? failure;
    await engine.sendMessage(
      chat: chat,
      userText: text,
      voiceMode: true,
      onThinkingStart: () {},
      onThinkingEnd: () {},
      onMessageAdded: (m) {
        // The final answer is the last assistant message that isn't asking for tools.
        if (m.role == LocalRole.assistant && (m.toolCalls == null || m.toolCalls!.isEmpty) && m.text.trim().isNotEmpty) {
          reply = m.text;
        }
      },
      onToolActivity: (_, _) {},
      onInteractiveProgress: (_, _) {},
      onConfirmModerateAction: confirm,
      onProviderError: (e) => failure = e,
    );
    if (failure != null) throw VoiceReplyException('$failure');
    return reply;
  }
}
