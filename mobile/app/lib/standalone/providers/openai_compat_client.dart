import 'dart:convert';
import 'package:http/http.dart' as http;

import '../local_message.dart';
import 'provider_client.dart';

/// Chat Completions API (OpenAI, and Ollama Cloud which speaks the same
/// shape — packages/provider-openai-compat/src/provider.ts:18 already
/// resolves "Ollama Cloud" as a model on this same endpoint style
/// server-side, mirrored here for the standalone/direct path).
class OpenAiCompatClient implements ProviderClient {
  final String baseUrl;
  final String defaultModel;

  OpenAiCompatClient({required this.baseUrl, required this.defaultModel});

  factory OpenAiCompatClient.openAi() => OpenAiCompatClient(
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
      );

  factory OpenAiCompatClient.ollamaCloud() => OpenAiCompatClient(
        baseUrl: 'https://ollama.com/v1',
        defaultModel: 'gemma4:31b-cloud',
      );

  @override
  Future<ProviderChatResult> chat({
    required String apiKey,
    required String? model,
    required List<LocalMessage> history,
    required List<Map<String, dynamic>> toolSpecs,
  }) async {
    final messages = history.map(_toWireMessage).toList();
    final tools = toolSpecs
        .map((spec) => {
              'type': 'function',
              'function': {
                'name': spec['name'],
                'description': spec['description'],
                'parameters': spec['parameters'],
              },
            })
        .toList();

    final response = await http.post(
      Uri.parse('$baseUrl/chat/completions'),
      headers: {
        'Authorization': 'Bearer $apiKey',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'model': model?.isNotEmpty == true ? model : defaultModel,
        'messages': messages,
        'tools': tools,
      }),
    );

    if (response.statusCode != 200) {
      throw Exception('${response.statusCode}: ${_truncate(response.body)}');
    }

    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final choices = decoded['choices'] as List<dynamic>?;
    if (choices == null || choices.isEmpty) {
      throw Exception('Respuesta sin choices: ${_truncate(response.body)}');
    }
    final message = (choices.first as Map<String, dynamic>)['message'] as Map<String, dynamic>? ?? {};
    final text = message['content']?.toString() ?? '';
    final rawToolCalls = message['tool_calls'] as List<dynamic>?;
    final toolCalls = (rawToolCalls ?? []).map((raw) {
      final call = raw as Map<String, dynamic>;
      final function = call['function'] as Map<String, dynamic>? ?? {};
      Map<String, dynamic> args;
      try {
        args = jsonDecode(function['arguments']?.toString() ?? '{}') as Map<String, dynamic>;
      } catch (_) {
        args = {};
      }
      return LocalToolCall(id: call['id']?.toString() ?? '', name: function['name']?.toString() ?? '', args: args);
    }).toList();

    return ProviderChatResult(text: text, toolCalls: toolCalls);
  }

  Map<String, dynamic> _toWireMessage(LocalMessage m) {
    switch (m.role) {
      case LocalRole.user:
        return {'role': 'user', 'content': m.text};
      case LocalRole.tool:
        return {'role': 'tool', 'tool_call_id': m.toolCallId, 'content': m.text};
      case LocalRole.assistant:
        if (m.toolCalls == null || m.toolCalls!.isEmpty) {
          return {'role': 'assistant', 'content': m.text};
        }
        return {
          'role': 'assistant',
          'content': m.text.isEmpty ? null : m.text,
          'tool_calls': m.toolCalls!
              .map((tc) => {
                    'id': tc.id,
                    'type': 'function',
                    'function': {'name': tc.name, 'arguments': jsonEncode(tc.args)},
                  })
              .toList(),
        };
    }
  }

  String _truncate(String s) => s.length <= 500 ? s : '${s.substring(0, 500)}…';
}
