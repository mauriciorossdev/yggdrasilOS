import '../local_message.dart';

/// Result of one non-streaming provider turn. v1 scope decision (Frontend):
/// the design doc says "parsear el streaming de tool-calls del proveedor",
/// but both OpenAI-compat and Anthropic support a plain non-streaming
/// request/response mode that returns the same tool-calls, just all at
/// once instead of token-by-token. Cutting streaming removes SSE parsing
/// and partial-JSON tool-argument accumulation entirely — the two riskiest
/// parts of a from-scratch client-side tool-loop — while keeping the loop
/// itself (and its correctness) identical. The chat UI still shows
/// "Pensando…" while this is in flight; it just reveals the reply as one
/// chunk instead of streaming it. Revisit if perceived latency matters more
/// than implementation risk later.
class ProviderChatResult {
  final String text;
  final List<LocalToolCall> toolCalls;

  ProviderChatResult({required this.text, this.toolCalls = const []});
}

abstract class ProviderClient {
  Future<ProviderChatResult> chat({
    required String apiKey,
    required String? model,
    required List<LocalMessage> history,
    required List<Map<String, dynamic>> toolSpecs,
  });
}
