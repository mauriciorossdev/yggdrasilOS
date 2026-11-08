import 'dart:convert';

import 'package:app/standalone/local_message.dart';
import 'package:app/standalone/providers/anthropic_client.dart';
import 'package:app/standalone/providers/openai_compat_client.dart';
import 'package:app/standalone/system_prompt_builder.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('SystemPromptBuilder', () {
    test('names the user and answers in the app language', () {
      final es = SystemPromptBuilder.build(userName: ' Ana ', locale: 'es');
      expect(es, contains('The user\'s name is Ana.'));
      expect(es, contains('Spanish'));
      expect(SystemPromptBuilder.build(locale: 'en'), contains('English'));
    });

    test('Spanish replies ask for tuteo and English ones do not mention it', () {
      expect(SystemPromptBuilder.build(locale: 'es'), allOf(contains('tuteo'), contains('never voseo')));
      expect(SystemPromptBuilder.build(locale: 'en'), isNot(contains('voseo')));
    });

    test('a blank name is left out and extra sections are appended in order', () {
      final p = SystemPromptBuilder.build(userName: '  ', locale: 'es', extraSections: ['PERSONA', '', 'TOOLS']);
      expect(p, isNot(contains('name is')));
      expect(p.indexOf('PERSONA'), lessThan(p.indexOf('TOOLS')));
    });
  });

  final history = [LocalMessage(role: LocalRole.user, text: 'hola')];

  test('Anthropic sends the prompt as the top-level system field', () async {
    late Map<String, dynamic> body;
    final client = AnthropicClient(
      httpClient: MockClient((req) async {
        body = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'content': [{'type': 'text', 'text': 'ok'}]}), 200);
      }),
    );
    await client.chat(apiKey: 'k', model: null, history: history, toolSpecs: const [], systemPrompt: 'SYS');
    expect(body['system'], 'SYS');
    await client.chat(apiKey: 'k', model: null, history: history, toolSpecs: const []);
    expect(body.containsKey('system'), isFalse);
  });

  test('OpenAI-compatible sends the prompt as the first system message', () async {
    late Map<String, dynamic> body;
    final client = OpenAiCompatClient(
      baseUrl: 'https://x/v1',
      defaultModel: 'm',
      httpClient: MockClient((req) async {
        body = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'choices': [{'message': {'content': 'ok'}}]}), 200);
      }),
    );
    await client.chat(apiKey: 'k', model: null, history: history, toolSpecs: const [], systemPrompt: 'SYS');
    final messages = body['messages'] as List;
    expect(messages.first, {'role': 'system', 'content': 'SYS'});
    expect(messages.length, 2);
    await client.chat(apiKey: 'k', model: null, history: history, toolSpecs: const []);
    expect((body['messages'] as List).length, 1);
  });
}
