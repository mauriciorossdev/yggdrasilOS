/// Vendor-neutral message shape for standalone (direct-to-provider) chats.
/// Kept independent of any single provider's wire format — the OpenAI-compat
/// and Anthropic clients each translate to/from this on every call, so a
/// chat's stored history never has to be re-shaped if the user later talks
/// to a different provider (not that chats migrate across profiles per
/// remote-access-analysis.md §7.3, but there's no reason to couple storage
/// to one vendor's shape either).
library;

class LocalToolCall {
  final String id;
  final String name;
  final Map<String, dynamic> args;

  LocalToolCall({required this.id, required this.name, required this.args});

  factory LocalToolCall.fromJson(Map<String, dynamic> json) => LocalToolCall(
        id: json['id']?.toString() ?? '',
        name: json['name']?.toString() ?? '',
        args: (json['args'] as Map?)?.cast<String, dynamic>() ?? {},
      );

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'args': args};
}

enum LocalRole { user, assistant, tool }

class LocalMessage {
  LocalRole role;
  String text;
  List<LocalToolCall>? toolCalls; // assistant messages that requested tool calls
  String? toolCallId; // role == tool: which call this answers
  String? toolName; // role == tool: for display
  bool? toolOk; // role == tool: whether the call succeeded

  LocalMessage({
    required this.role,
    this.text = '',
    this.toolCalls,
    this.toolCallId,
    this.toolName,
    this.toolOk,
  });

  factory LocalMessage.fromJson(Map<String, dynamic> json) => LocalMessage(
        role: LocalRole.values.firstWhere((r) => r.name == json['role'], orElse: () => LocalRole.user),
        text: json['text']?.toString() ?? '',
        toolCalls: (json['toolCalls'] as List<dynamic>?)
            ?.map((e) => LocalToolCall.fromJson(e as Map<String, dynamic>))
            .toList(),
        toolCallId: json['toolCallId']?.toString(),
        toolName: json['toolName']?.toString(),
        toolOk: json['toolOk'] as bool?,
      );

  Map<String, dynamic> toJson() => {
        'role': role.name,
        'text': text,
        if (toolCalls != null) 'toolCalls': toolCalls!.map((c) => c.toJson()).toList(),
        if (toolCallId != null) 'toolCallId': toolCallId,
        if (toolName != null) 'toolName': toolName,
        if (toolOk != null) 'toolOk': toolOk,
      };
}
