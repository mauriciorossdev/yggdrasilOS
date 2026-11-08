import 'package:flutter/material.dart';

import '../chat/projects_screen.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';
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
      return YggEmptyState(icon: Icons.extension_outlined, message: AppStrings.t('projects.notOpenOnComputer'));
    }
    if (_loading) return Center(child: CircularProgressIndicator(color: YggColors.accent));
    if (_error != null) {
      return YggEmptyState(
        icon: Icons.error_outline,
        message: '${AppStrings.t('common.errorPrefix')}: $_error',
        action: OutlinedButton(onPressed: _load, child: Text(AppStrings.t('common.retry'))),
      );
    }
    if (_items.isEmpty) {
      return YggEmptyState(
        icon: Icons.extension_outlined,
        message: AppStrings.t('projects.noComplementos'),
        hint: AppStrings.t('complementos.hint'),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          YggSectionLabel(AppStrings.tp('complementos.enabledForMobile', {'n': '${_items.length}'})),
          YggListGroup(
            children: [
              for (final item in _items)
                YggListRow(
                  leading: Container(
                    width: 40,
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: YggColors.accentSoft, borderRadius: BorderRadius.circular(YggRadius.md)),
                    child: item.iconIsFile || item.icon == null
                        ? Icon(Icons.extension_outlined, size: 20, color: YggColors.accent)
                        : Text(item.icon!, style: const TextStyle(fontSize: 20)),
                  ),
                  title: item.name,
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => ComplementoWebViewScreen(client: client, projectId: widget.project.id, manifest: item),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 22),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              AppStrings.t('complementos.hint'),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, height: 1.5, color: YggColors.textFainter),
            ),
          ),
        ],
      ),
    );
  }
}
