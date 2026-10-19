import 'local_message.dart';

/// One standalone (direct-to-provider) chat — shape per
/// remote-access-analysis.md §7.3. Lives only on this device; unrelated to
/// gateway sessionKey/SessionStore.
class LocalChat {
  final String id;
  final String profileId;
  String? title;
  List<LocalMessage> messages;
  final int createdAt;
  int updatedAt;

  LocalChat({
    required this.id,
    required this.profileId,
    this.title,
    List<LocalMessage>? messages,
    int? createdAt,
    int? updatedAt,
  })  : messages = messages ?? [],
        createdAt = createdAt ?? DateTime.now().millisecondsSinceEpoch,
        updatedAt = updatedAt ?? DateTime.now().millisecondsSinceEpoch;

  factory LocalChat.fromJson(Map<String, dynamic> json) => LocalChat(
        id: json['id']?.toString() ?? '',
        profileId: json['profileId']?.toString() ?? '',
        title: json['title']?.toString(),
        messages: (json['messages'] as List<dynamic>?)
            ?.map((e) => LocalMessage.fromJson(e as Map<String, dynamic>))
            .toList(),
        createdAt: (json['createdAt'] as num?)?.toInt(),
        updatedAt: (json['updatedAt'] as num?)?.toInt(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'profileId': profileId,
        if (title != null) 'title': title,
        'messages': messages.map((m) => m.toJson()).toList(),
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  /// Same truncation the doc's preview logic uses for lastMessagePreview —
  /// last user/assistant message with non-empty text, flattened, ~120 chars.
  String? get lastMessagePreview {
    for (final m in messages.reversed) {
      if (m.role == LocalRole.tool) continue;
      final flat = m.text.replaceAll(RegExp(r'\s+'), ' ').trim();
      if (flat.isEmpty) continue;
      return flat.length <= 120 ? flat : '${flat.substring(0, 119)}…';
    }
    return null;
  }
}
