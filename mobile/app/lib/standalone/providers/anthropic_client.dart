import 'dart:convert';
import 'package:http/http.dart' as http;

import '../local_message.dart';
import 'provider_client.dart';

/// Anthropic Messages API. No provider plugin exists for this server-side
/// yet (remote-access-analysis.md §1.1 "Hallazgo aparte" — confirmed TODO,
/// not prioritized there) — this is independent of that: standalone mode
/// talks to the provider directly from the phone, so it was never blocked
/// on a gateway-side plugin existing.
class AnthropicClient implements ProviderClient {
  static const _baseUrl = 'https://api.anthropic.com/v1/messages';
  static const _apiVersion = '2023-06-01';
  static const _defaultModel = 'claude-sonnet-5';
  static const _maxTokens = 4096;

  @override
  Future<ProviderChatResult> chat({
    required String apiKey,
    required String? model,
    required List<LocalMessage> history,
    required List<Map<String, dynamic>> toolSpecs,
  }) async {
    final messages = _toWireMessages(history);
    final tools = toolSpecs
        .map((spec) => {
              'name': spec['name'],
              'description': spec['description'],
              'input_schema': spec['parameters'],
            })
        .toList();

    final response = await http.post(
      Uri.parse(_baseUrl),
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': _apiVersion,
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'model': model?.isNotEmpty == true ? model : _defaultModel,
        'max_tokens': _maxTokens,
        'messages': messages,
        'tools': tools,
      }),
    );

    if (response.statusCode != 200) {
      throw Exception('${response.statusCode}: ${_truncate(response.body)}');
    }

    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final blocks = decoded['content'] as List<dynamic>? ?? [];
    final textBuffer = StringBuffer();
    final toolCalls = <LocalToolCall>[];
    for (final raw in blocks) {
      final block = raw as Map<String, dynamic>;
      if (block['type'] == 'text') {
        textBuffer.write(block['text']?.toString() ?? '');
      } else if (block['type'] == 'tool_use') {
        toolCalls.add(LocalToolCall(
          id: block['id']?.toString() ?? '',
          name: block['name']?.toString() ?? '',
          args: (block['input'] as Map?)?.cast<String, dynamic>() ?? {},
        ));
      }
    }
    return ProviderChatResult(text: textBuffer.toString(), toolCalls: toolCalls);
  }

  // Anthropic has no separate "tool" role — a tool result is a "user"
  // message whose content is one or more tool_result blocks, and ALL
  // pending tool_results for a given assistant turn must land in a single
  // user message, not one per call. Consecutive LocalRole.tool entries are
  // merged here into one such message.
  List<Map<String, dynamic>> _toWireMessages(List<LocalMessage> history) {
    final out = <Map<String, dynamic>>[];
    var i = 0;
    while (i < history.length) {
      final m = history[i];
      if (m.role == LocalRole.tool) {
        final blocks = <Map<String, dynamic>>[];
        while (i < history.length && history[i].role == LocalRole.tool) {
          final t = history[i];
          blocks.add({
            'type': 'tool_result',
            'tool_use_id': t.toolCallId,
            'content': t.text,
            if (t.toolOk == false) 'is_error': true,
          });
          i++;
        }
        out.add({'role': 'user', 'content': blocks});
        continue;
      }
      if (m.role == LocalRole.user) {
        out.add({'role': 'user', 'content': m.text});
      } else {
        final content = <Map<String, dynamic>>[];
        if (m.text.isNotEmpty) content.add({'type': 'text', 'text': m.text});
        for (final tc in m.toolCalls ?? const <LocalToolCall>[]) {
          content.add({'type': 'tool_use', 'id': tc.id, 'name': tc.name, 'input': tc.args});
        }
        out.add({'role': 'assistant', 'content': content});
      }
      i++;
    }
    return out;
  }

  String _truncate(String s) => s.length <= 500 ? s : '${s.substring(0, 500)}…';
}
