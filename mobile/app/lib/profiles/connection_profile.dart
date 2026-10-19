/// Shape confirmed by Architect, remote-access-analysis.md §7.1 — contract,
/// not a guess. Wire values ("gateway"|"direct", provider names) are fixed;
/// don't rename them without re-checking that section.
library;

enum ConnectionProfileType { gateway, direct }

enum DirectProvider { anthropic, openai, ollamaCloud }

extension DirectProviderLabel on DirectProvider {
  String get label => switch (this) {
        DirectProvider.anthropic => 'Anthropic (Claude)',
        DirectProvider.openai => 'OpenAI',
        DirectProvider.ollamaCloud => 'Ollama Cloud',
      };

  String get wireName => switch (this) {
        DirectProvider.anthropic => 'anthropic',
        DirectProvider.openai => 'openai',
        DirectProvider.ollamaCloud => 'ollama-cloud',
      };

  static DirectProvider? fromWireName(String? name) {
    for (final p in DirectProvider.values) {
      if (p.wireName == name) return p;
    }
    return null;
  }
}

class ConnectionProfile {
  final String id;
  String name;
  ConnectionProfileType type;

  // type == gateway
  String? baseUrl;
  String? apiKey;

  // type == direct
  DirectProvider? provider;
  String? model;

  final int createdAt;
  int? lastUsedAt;

  /// Set when the profile came from the Railway hub's desktop directory
  /// (hub/desktop_discovery.dart): lets the app re-find that desktop project
  /// on its own when its port changes after a restart.
  String? hubDesktopId;
  String? hubProjectId;

  ConnectionProfile({
    required this.id,
    required this.name,
    required this.type,
    this.baseUrl,
    this.apiKey,
    this.provider,
    this.model,
    int? createdAt,
    this.lastUsedAt,
    this.hubDesktopId,
    this.hubProjectId,
  }) : createdAt = createdAt ?? DateTime.now().millisecondsSinceEpoch;

  factory ConnectionProfile.fromJson(Map<String, dynamic> json) {
    final type = json['type'] == 'direct' ? ConnectionProfileType.direct : ConnectionProfileType.gateway;
    return ConnectionProfile(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      type: type,
      baseUrl: json['baseUrl']?.toString(),
      apiKey: json['apiKey']?.toString(),
      provider: DirectProviderLabel.fromWireName(json['provider']?.toString()),
      model: json['model']?.toString(),
      createdAt: (json['createdAt'] as num?)?.toInt(),
      lastUsedAt: (json['lastUsedAt'] as num?)?.toInt(),
      hubDesktopId: json['hubDesktopId']?.toString(),
      hubProjectId: json['hubProjectId']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'type': type == ConnectionProfileType.direct ? 'direct' : 'gateway',
        if (baseUrl != null) 'baseUrl': baseUrl,
        if (apiKey != null) 'apiKey': apiKey,
        if (provider != null) 'provider': provider!.wireName,
        if (model != null) 'model': model,
        'createdAt': createdAt,
        if (lastUsedAt != null) 'lastUsedAt': lastUsedAt,
        if (hubDesktopId != null) 'hubDesktopId': hubDesktopId,
        if (hubProjectId != null) 'hubProjectId': hubProjectId,
      };

  bool get isFromHub => hubDesktopId != null && hubProjectId != null;

  String get subtitle => type == ConnectionProfileType.gateway
      ? (baseUrl?.isNotEmpty ?? false) ? baseUrl! : 'Gateway'
      : (provider?.label ?? 'Provider directo');
}
