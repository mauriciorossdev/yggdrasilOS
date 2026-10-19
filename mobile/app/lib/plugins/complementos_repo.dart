import 'dart:convert';

import '../services/yggdrasil_client.dart';
import 'complemento_manifest.dart';

/// Same folder desktop's Estudio writes to (packages/app-desktop/src/main/
/// plugins.ts's projectPluginsDir) — mobile is a pure reader of it via the
/// project's own fs.list/fs.read RPCs, no gateway changes needed. Only
/// project-scoped complementos are visible here; desktop's "global"
/// (Electron userData) scope lives outside any project folder, so it's not
/// reachable from a phone at all (same reasoning StudioCreateForm.tsx's
/// "Mobile" checkbox disables for scope === "global").
const String complementosDir = '.yggdrasil/plugins';

class ComplementosRepo {
  final YggdrasilClient client;

  ComplementosRepo(this.client);

  Future<List<ComplementoManifest>> list() async {
    List<dynamic> entries;
    try {
      final res = await client.call('fs.list', {'relativePath': complementosDir});
      entries = (res is Map ? res['entries'] : null) as List<dynamic>? ?? [];
    } catch (_) {
      // No .yggdrasil/plugins yet — nothing's been created for this
      // project, same as an empty list.
      return [];
    }

    final manifests = <ComplementoManifest>[];
    for (final e in entries) {
      final map = e as Map;
      if (map['type'] != 'directory') continue;
      final id = map['name']?.toString();
      if (id == null || id.isEmpty) continue;
      try {
        final manifest = await readManifest(id);
        if (manifest.supportsMobile) manifests.add(manifest);
      } catch (_) {
        // Broken/missing manifest.json for this folder — skip it rather
        // than surfacing a "broken complemento" entry (desktop does that
        // for its own sidebar; not worth the extra UI for a read-only
        // mobile list).
      }
    }
    return manifests;
  }

  Future<ComplementoManifest> readManifest(String id) async {
    final content = await readFile(id, 'manifest.json');
    return ComplementoManifest.fromJson(jsonDecode(content) as Map<String, dynamic>);
  }

  Future<String> readFile(String id, String relativeFileName) async {
    final res = await client.call('fs.read', {'relativePath': '$complementosDir/$id/$relativeFileName'});
    return (res is Map ? res['content'] : null)?.toString() ?? '';
  }
}
