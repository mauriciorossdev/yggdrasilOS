/// Mirrors the relevant fields of desktop's PluginManifest
/// (packages/app-desktop/src/main/plugins.ts) — mobile reads the exact
/// same manifest.json a complemento already has, it just only ever cares
/// whether "mobile" is in `views`. `tools`/`permissions` beyond `views`
/// aren't acted on yet (see notes/.../mobile-complementos-design.md v1
/// scope: mobile only renders, it doesn't expose `ygg.tools.register` to
/// MCP or grant `fs:write`/`panes`/`gateway.call`).
class ComplementoManifest {
  final String id;
  final String name;
  final String? icon;
  final String entry;
  final List<String> views;

  ComplementoManifest({
    required this.id,
    required this.name,
    required this.entry,
    required this.views,
    this.icon,
  });

  factory ComplementoManifest.fromJson(Map<String, dynamic> json) {
    final id = json['id']?.toString() ?? '';
    final entry = json['entry']?.toString();
    return ComplementoManifest(
      id: id,
      name: json['name']?.toString() ?? id,
      icon: json['icon']?.toString(),
      entry: (entry != null && entry.isNotEmpty) ? entry : 'index.html',
      views: ((json['views'] as List?) ?? const []).map((v) => v.toString()).toList(),
    );
  }

  bool get supportsMobile => views.contains('mobile');

  /// Desktop tells an emoji/text icon apart from a relative file by
  /// checking for a "." — same heuristic, see PluginsSection.tsx.
  bool get iconIsFile => icon != null && icon!.contains('.');
}
