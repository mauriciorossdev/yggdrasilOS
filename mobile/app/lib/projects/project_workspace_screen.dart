import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import 'terminal_chat_view.dart';
import 'workspace_preview_panel.dart';

class _Pane {
  final String id;
  final String title;
  final bool working;
  final String? command;

  _Pane({required this.id, required this.title, required this.working, this.command});

  factory _Pane.fromJson(Map<String, dynamic> json) => _Pane(
    id: json['id']?.toString() ?? '',
    title: json['title']?.toString() ?? '',
    working: json['working'] == true,
    command: json['command']?.toString(),
  );
}

/// AIDE-style split view for one project: chat with a live pane (defaults to
/// the first one from terminals.list — usually the orchestrator, since it's
/// the pane created first and any team it spawns splits in beside it, same
/// assumption app-desktop's TerminalContainer.tsx makes for its own
/// "Commands" navbar button) on one side, a file/web preview on the other.
/// Opened from ProjectDetailScreen's new header button; needs that project's
/// own live gateway connection (same `client` TerminalsTab/FilesTab use), so
/// it's only reachable while the project is open on the computer.
class ProjectWorkspaceScreen extends StatefulWidget {
  final YggdrasilClient client;
  final String projectName;
  final String projectPath;

  const ProjectWorkspaceScreen({
    super.key,
    required this.client,
    required this.projectName,
    required this.projectPath,
  });

  @override
  State<ProjectWorkspaceScreen> createState() => _ProjectWorkspaceScreenState();
}

class _ProjectWorkspaceScreenState extends State<ProjectWorkspaceScreen> {
  List<_Pane> _panes = [];
  String? _selectedPaneId;
  bool _loading = true;
  String? _error;
  // Narrow layouts (phones) show one side at a time instead of splitting —
  // see build()'s LayoutBuilder breakpoint.
  bool _showPreviewOnNarrow = false;

  @override
  void initState() {
    super.initState();
    _loadPanes();
  }

  Future<void> _loadPanes() async {
    try {
      final res = await widget.client.call('terminals.list', {});
      final list = (res is Map ? res['panes'] : null) as List<dynamic>? ?? [];
      if (!mounted) return;
      setState(() {
        _panes = list.map((e) => _Pane.fromJson(e as Map<String, dynamic>)).toList();
        _selectedPaneId = _panes.isNotEmpty ? _panes.first.id : null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is Map ? (e['message'] ?? e).toString() : '$e';
        _loading = false;
      });
    }
  }

  void _pickPane() {
    if (_panes.length < 2) return;
    showModalBottomSheet(
      context: context,
      backgroundColor: YggColors.surface,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: _panes
              .map(
                (p) => ListTile(
                  title: Text(p.title, style: const TextStyle(color: YggColors.text)),
                  trailing: p.working
                      ? Text(AppStrings.t('projects.statusWorking'), style: const TextStyle(color: YggColors.accent, fontSize: 12))
                      : null,
                  selected: p.id == _selectedPaneId,
                  onTap: () {
                    setState(() => _selectedPaneId = p.id);
                    Navigator.pop(context);
                  },
                ),
              )
              .toList(),
        ),
      ),
    );
  }

  _Pane? _findPane(String? id) {
    for (final p in _panes) {
      if (p.id == id) return p;
    }
    return null;
  }

  Widget _paneChip() {
    final pane = _findPane(_selectedPaneId);
    return GestureDetector(
      onTap: _panes.length > 1 ? _pickPane : null,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: YggColors.cardFillHigh,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: YggColors.hairline),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 7, height: 7, decoration: const BoxDecoration(color: Colors.greenAccent, shape: BoxShape.circle)),
            const SizedBox(width: 8),
            Text(
              pane?.title ?? AppStrings.t('projects.orchestrator'),
              style: const TextStyle(fontSize: 12.5, color: YggColors.text),
            ),
            if (_panes.length > 1) ...[
              const SizedBox(width: 4),
              const Icon(Icons.keyboard_arrow_down, size: 16, color: YggColors.textFaint),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.projectName, style: const TextStyle(fontSize: 12, color: YggColors.textFaint)),
            Text(AppStrings.t('projects.workspace'), style: const TextStyle(fontSize: 18)),
          ],
        ),
        actions: [
          Padding(padding: const EdgeInsets.only(right: 12), child: Center(child: _paneChip())),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
          : _error != null
          ? Padding(
              padding: const EdgeInsets.all(24),
              child: Text('${AppStrings.t('common.errorPrefix')}: $_error', style: const TextStyle(color: YggColors.textMuted)),
            )
          : _selectedPaneId == null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(AppStrings.t('projects.noPanesForWorkspace'), style: const TextStyle(color: YggColors.textFaint)),
              ),
            )
          : LayoutBuilder(
              builder: (context, constraints) {
                final chat = TerminalChatView(
                  client: widget.client,
                  paneId: _selectedPaneId!,
                  harnessCommand: _findPane(_selectedPaneId)?.command,
                  inputHint: AppStrings.t('projects.workspaceChatHint'),
                );
                final preview = WorkspacePreviewPanel(client: widget.client, projectPath: widget.projectPath);

                if (constraints.maxWidth >= 760) {
                  return Row(
                    children: [
                      Expanded(flex: 56, child: Container(decoration: const BoxDecoration(border: Border(right: BorderSide(color: YggColors.hairline))), child: chat)),
                      Expanded(flex: 44, child: preview),
                    ],
                  );
                }

                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                      child: Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => setState(() => _showPreviewOnNarrow = false),
                              style: OutlinedButton.styleFrom(
                                backgroundColor: _showPreviewOnNarrow ? null : YggColors.accent,
                                foregroundColor: _showPreviewOnNarrow ? YggColors.text : YggColors.surface,
                              ),
                              child: Text(AppStrings.t('common.chat')),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => setState(() => _showPreviewOnNarrow = true),
                              style: OutlinedButton.styleFrom(
                                backgroundColor: _showPreviewOnNarrow ? YggColors.accent : null,
                                foregroundColor: _showPreviewOnNarrow ? YggColors.surface : YggColors.text,
                              ),
                              child: Text(AppStrings.t('projects.workspacePreviewTab')),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Expanded(child: _showPreviewOnNarrow ? preview : chat),
                  ],
                );
              },
            ),
    );
  }
}
