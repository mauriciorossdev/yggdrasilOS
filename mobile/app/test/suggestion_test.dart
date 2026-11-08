import 'dart:convert';

import 'package:app/pi/pi_settings.dart';
import 'package:app/profiles/connection_profile.dart';
import 'package:app/standalone/local_chat.dart';
import 'package:app/standalone/local_message.dart';
import 'package:app/standalone/providers/provider_client.dart';
import 'package:app/standalone/standalone_chat_engine.dart';
import 'package:app/standalone/suggestion.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Replays canned replies and records what the engine sent.
class _FakeClient implements ProviderClient {
  final List<ProviderChatResult> replies;
  final List<List<Map<String, dynamic>>> toolSpecsSeen = [];
  final List<String?> systemPromptsSeen = [];

  _FakeClient(this.replies);

  @override
  String get defaultModel => 'fake';

  @override
  Future<ProviderChatResult> chat({
    required String apiKey,
    required String? model,
    required List<LocalMessage> history,
    required List<Map<String, dynamic>> toolSpecs,
    String? systemPrompt,
  }) async {
    toolSpecsSeen.add(toolSpecs);
    systemPromptsSeen.add(systemPrompt);
    return replies.removeAt(0);
  }
}

LocalToolCall _suggest(Map<String, dynamic> args, {String id = 'c1'}) =>
    LocalToolCall(id: id, name: suggestActionToolName, args: args);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('Suggestion.fromCall', () {
    test('reads a valid new_chat offer', () {
      final s = Suggestion.fromCall(_suggest({
        'kind': 'new_chat',
        'title': ' App de recetas ',
        'summary': 'Definir el alcance',
        'seed_context': 'Hablamos de una app para guardar recetas.',
      }))!;
      expect(s.kind, SuggestionKind.newChat);
      expect(s.title, 'App de recetas');
      expect(s.seedContext, contains('recetas'));
      expect(s.callId, 'c1');
    });

    test('rejects an unknown kind, a missing title and other tools', () {
      expect(Suggestion.fromCall(_suggest({'kind': 'delete_everything', 'title': 'x'})), isNull);
      expect(Suggestion.fromCall(_suggest({'kind': 'new_chat', 'title': '  '})), isNull);
      expect(Suggestion.fromCall(LocalToolCall(id: 'c', name: 'phone_open_app', args: {'kind': 'new_chat', 'title': 'x'})), isNull);
    });
  });

  group('what the model is told', () {
    List kinds(bool projects) =>
        (buildSuggestActionSpec(projectsAvailable: projects)['parameters']['properties'] as Map)['kind']['enum'] as List;

    test('new_project is only offered when there is a host to create it on', () {
      expect(kinds(false), ['new_chat']);
      expect(kinds(true), ['new_chat', 'new_project']);
      expect(buildSuggestionGuidance(projectsAvailable: false), isNot(contains('new_project')));
      expect(buildSuggestionGuidance(projectsAvailable: true), contains('new_project'));
    });

    test('kind and title are required', () {
      final params = buildSuggestActionSpec(projectsAvailable: true)['parameters'] as Map<String, dynamic>;
      expect(params['required'], ['kind', 'title']);
    });
  });

  group('engine', () {
    final profile = ConnectionProfile(id: 'p', name: 'p', type: ConnectionProfileType.direct, provider: DirectProvider.anthropic);

    Future<LocalChat> run(List<ProviderChatResult> replies, _FakeClient client) async {
      final chat = LocalChat(id: 'chat', profileId: 'p');
      await StandaloneChatEngine(profile, client: client).sendMessage(
        chat: chat,
        userText: 'estoy pensando en una app de recetas',
        onThinkingStart: () {},
        onThinkingEnd: () {},
        onMessageAdded: (_) {},
        onToolActivity: (_, _) {},
        onInteractiveProgress: (_, _) {},
        onConfirmModerateAction: (_, _) async => true,
      );
      return chat;
    }

    test('offers the tool and the guidance, and answers a suggestion with a pending result', () async {
      final client = _FakeClient([
        ProviderChatResult(text: '', toolCalls: [
          _suggest({'kind': 'new_chat', 'title': 'App de recetas', 'seed_context': 'ctx'}),
        ]),
        ProviderChatResult(text: 'Te dejé una idea para profundizar.'),
      ]);
      final chat = await run(client.replies, client);

      expect(client.toolSpecsSeen.first.map((s) => s['name']), contains(suggestActionToolName));
      expect(client.systemPromptsSeen.first, contains('suggest_action'));
      expect(client.systemPromptsSeen.first, isNot(contains('new_project')));

      // user, assistant(toolCalls), tool result, assistant text
      expect(chat.messages.map((m) => m.role),
          [LocalRole.user, LocalRole.assistant, LocalRole.tool, LocalRole.assistant]);
      expect(suggestionsOf(chat.messages[1]), hasLength(1));
      expect(chat.messages[2].toolCallId, 'c1');
      expect(suggestionStatusOf(chat, 'c1'), suggestionPending);
      expect(chat.messages.last.text, contains('idea'));
    });

    test('with a host configured the model may also offer a project', () async {
      await PiSettingsStore.save(PiSettings(baseUrl: 'https://pi.example', apiKey: 'k'));
      final client = _FakeClient([ProviderChatResult(text: 'hola')]);
      await run(client.replies, client);
      final spec = client.toolSpecsSeen.first.firstWhere((s) => s['name'] == suggestActionToolName);
      expect((spec['parameters']['properties'] as Map)['kind']['enum'], contains('new_project'));
      expect(client.systemPromptsSeen.first, contains('new_project'));
    });

    test('a malformed suggestion is answered with an error and no card', () async {
      final client = _FakeClient([
        ProviderChatResult(text: '', toolCalls: [_suggest({'kind': 'nope', 'title': 'x'})]),
        ProviderChatResult(text: 'ok'),
      ]);
      final chat = await run(client.replies, client);
      expect(suggestionsOf(chat.messages[1]), isEmpty);
      expect(jsonDecode(chat.messages[2].text)['error'], 'invalid_suggestion');
      expect(chat.messages[2].toolOk, isFalse);
    });

    test('the decision is stored in the tool result and survives a JSON round trip', () async {
      final client = _FakeClient([
        ProviderChatResult(text: '', toolCalls: [_suggest({'kind': 'new_chat', 'title': 'T'})]),
        ProviderChatResult(text: 'listo'),
      ]);
      final chat = await run(client.replies, client);

      setSuggestionStatus(chat, 'c1', suggestionAccepted);
      final reloaded = LocalChat.fromJson(chat.toJson());
      expect(suggestionStatusOf(reloaded, 'c1'), suggestionAccepted);
      expect(suggestionsOf(reloaded.messages[1]).single.title, 'T');
    });
  });
}
