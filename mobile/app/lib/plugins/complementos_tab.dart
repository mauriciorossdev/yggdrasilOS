import 'package:flutter/material.dart';

import '../chat/projects_screen.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import 'complemento_manifest.dart';
import 'complemento_webview_screen.dart';
import 'complementos_repo.dart';

/// Project detail's "Complementos" tab — same nullable-client convention as
/// FilesTab/WorkflowsTab (project_detail_screen.dart's `_terminalsClient`):
/// complementos live under the project's own .yggdrasil/plugins, readable
/// only through that project's live gateway. `project` is only needed for
/// its id (ComplementoWebViewScreen's storage key namespace) — same reason
/// SessionsTab/AgentFlowTab take the whole ProjectRecord rather than
/// threading an id through on its own.
class ComplementosTab extends StatefulWidget {
  final YggdrasilClient? client;
  final ProjectRecord project;

  const ComplementosTab({super.key, required this.client, required this.project});

  @override
  State<ComplementosTab> createState() => _ComplementosTabState();
}

class _ComplementosTabState extends State<ComplementosTab> {
  List<ComplementoManifest> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.client != null) _load();
  }

  Future<void> _load() async {
    final client = widget.client;
    if (client == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await ComplementosRepo(client).list();
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final client = widget.client;
    if (client == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            AppStrings.t('projects.notOpenOnComputer'),
            textAlign: TextAlign.center,
            style: const TextStyle(color: YggColors.textFaint),
          ),
        ),
      );
    }
    if (_loading) return const Center(child: CircularProgressIndicator(color: YggColors.accent));
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Text('${AppStrings.t('common.errorPrefix')}: $_error', style: const TextStyle(color: YggColors.textMuted)),
      );
    }
    if (_items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            AppStrings.t('projects.noComplementos'),
            textAlign: TextAlign.center,
            style: const TextStyle(color: YggColors.textFaint),
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: _items.length,
        itemBuilder: (_, i) {
          final item = _items[i];
          return ListTile(
            leading: item.iconIsFile || item.icon == null
                ? const Icon(Icons.extension_outlined, color: YggColors.accent)
                : Text(item.icon!, style: const TextStyle(fontSize: 20)),
            title: Text(item.name, style: const TextStyle(fontSize: 14.5, color: YggColors.text)),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => ComplementoWebViewScreen(client: client, projectId: widget.project.id, manifest: item),
              ),
            ),
          );
        },
      ),
    );
  }
}
