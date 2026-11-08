import 'dart:convert';

import 'package:app/assistant/assistant_usage.dart';
import 'package:app/profiles/connection_profile.dart';
import 'package:app/standalone/local_message.dart';
import 'package:app/standalone/model_catalog.dart';
import 'package:app/standalone/providers/anthropic_client.dart';
import 'package:app/standalone/standalone_chat_engine.dart';
import 'package:app/standalone/token_usage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _haiku = 'claude-haiku-4-5-20251001';

Future<dynamic> _chatWith(Map<String, dynamic> responseBody) {
  final client = AnthropicClient(
    httpClient: MockClient((_) async => http.Response(jsonEncode(responseBody), 200)),
  );
  return client.chat(apiKey: 'k', model: null, history: [LocalMessage(role: LocalRole.user, text: 'hi')], toolSpecs: const []);
}

void main() {
  group('AnthropicClient usage', () {
    test('maps usage, cache fields and the answering model', () async {
      final result = await _chatWith({
        'model': _haiku,
        'content': [
          {'type': 'text', 'text': 'hello'}
        ],
        'usage': {
          'input_tokens': 120,
          'output_tokens': 30,
          'cache_read_input_tokens': 500,
          'cache_creation_input_tokens': 40,
        },
      });
      expect(result.text, 'hello');
      expect(result.usage!.inTokens, 120);
      expect(result.usage!.outTokens, 30);
      expect(result.usage!.cacheRead, 500);
      expect(result.usage!.cacheWrite, 40);
      expect(result.usage!.model, _haiku);
      expect(result.usage!.contextTokens, 660);
    });

    test('a response without usage yields none instead of failing', () async {
      final result = await _chatWith({'content': []});
      expect(result.usage, isNull);
    });
  });

  group('UsageSummary', () {
    AssistantModel? lookup(String? id) => findModel(DirectProvider.anthropic, id);

    test('is empty with no calls', () {
      expect(UsageSummary.of(const [], lookup).isEmpty, isTrue);
    });

    test('sums tokens and prices each reply with the model that produced it', () {
      final summary = UsageSummary.of(const [
        TokenUsage(inTokens: 1000000, outTokens: 0, model: _haiku), // $1.00 at 1 USD/M in
        TokenUsage(inTokens: 10, outTokens: 20, model: 'some-unpriced-model'),
      ], lookup);
      expect(summary.calls, 2);
      expect(summary.inTokens, 1000010);
      expect(summary.outTokens, 20);
      expect(summary.costUsd, closeTo(1.0, 1e-9));
      // The unpriced call is reported, not guessed at.
      expect(summary.unpricedCalls, 1);
      expect(summary.lastModel, 'some-unpriced-model');
    });

    test('no known price anywhere means no cost figure at all', () {
      final summary = UsageSummary.of(const [TokenUsage(inTokens: 5, outTokens: 5, model: 'x')], lookup);
      expect(summary.costUsd, isNull);
      expect(summary.unpricedCalls, 1);
    });
  });

  group('storage', () {
    test('a message saved before usage existed still loads', () {
      final m = LocalMessage.fromJson({'role': 'assistant', 'text': 'old'});
      expect(m.usage, isNull);
      expect(m.toJson().containsKey('usage'), isFalse);
    });

    test('usage round-trips through the message JSON', () {
      final m = LocalMessage(
        role: LocalRole.assistant,
        text: 'x',
        usage: const TokenUsage(inTokens: 1, outTokens: 2, cacheRead: 3, cacheWrite: 4, model: _haiku),
      );
      final back = LocalMessage.fromJson(jsonDecode(jsonEncode(m.toJson())) as Map<String, dynamic>);
      expect(back.usage!.inTokens, 1);
      expect(back.usage!.outTokens, 2);
      expect(back.usage!.cacheRead, 3);
      expect(back.usage!.cacheWrite, 4);
      expect(back.usage!.model, _haiku);
    });
  });

  group('model selection', () {
    test('only providers with a catalog are switchable from the chat', () {
      expect(modelsFor(DirectProvider.anthropic), isNotEmpty);
      expect(modelsFor(DirectProvider.openai), isEmpty);
      expect(modelsFor(DirectProvider.ollamaCloud), isEmpty);
      expect(findModel(DirectProvider.anthropic, 'nope'), isNull);
    });

    test('the engine runs on the profile model, else the provider default', () {
      final profile = ConnectionProfile(id: 'p', name: 'p', type: ConnectionProfileType.direct, provider: DirectProvider.anthropic);
      final engine = StandaloneChatEngine(profile);
      expect(engine.currentModel, isNotEmpty);
      final defaultModel = engine.currentModel;
      profile.model = _haiku;
      expect(engine.currentModel, _haiku);
      profile.model = '';
      expect(engine.currentModel, defaultModel);
    });
  });
}
