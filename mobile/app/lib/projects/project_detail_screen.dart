import 'package:flutter/material.dart';

import '../chat/projects_screen.dart';
import '../gateway/gateway_connection.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../plugins/complementos_tab.dart';
import 'agent_flow_tab.dart';
import 'files_tab.dart';
import 'project_workspace_screen.dart';
import 'sessions_tab.dart';
import 'terminals_tab.dart';
import 'workflows_tab.dart';

/// Detail view for one project tapped from ProjectsScreen — 5 tabs:
/// Terminales, Sessions, Agent Flow, Files (stub), Workflows. Sessions/Agent Flow read
/// straight off that project's disk regardless of whether it's open right
/// now (projects.sessions.*/projects.agentFlow.get, via the already-resolved
/// `client`). Terminales needs THAT project's own live gateway — each open
/// project runs a separate gateway process — so when `project.isOpen` is
/// true (projects.list already tells us which port, from
/// main/openGateways.ts) this opens a second, throwaway connection scoped to
/// that specific port instead of guessing/reusing the general `client`.
class ProjectDetailScreen extends StatefulWidget {
  final YggdrasilClient client;
  final ProjectRecord project;

  /// Already-open connection to this project's own gateway (a desktop found
  /// through the Railway hub, where the port-on-same-host guess below doesn't
  /// apply). Owned by the caller, which disconnects it.
  final YggdrasilClient? projectClient;

  const ProjectDetailScreen({
    super.key,
    required this.client,
    required this.project,
    this.projectClient,
  });

  @override
  State<ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen> {
  YggdrasilClient? _terminalsClient;
  bool _resolvingTerminals = true;

  @override
  void initState() {
    super.initState();
    _resolveTerminalsClient();
  }

  Future<void> _resolveTerminalsClient() async {
    if (widget.projectClient != null) {
      setState(() {
        _terminalsClient = widget.projectClient;
        _resolvingTerminals = false;
      });
      return;
    }
    final port = widget.project.gatewayPort;
    if (!widget.project.isOpen || port == null) {
      setState(() => _resolvingTerminals = false);
      return;
    }
    try {
      final client = await GatewayConnection.resolveForPort(port);
      if (!mounted) return;
      setState(() {
        _terminalsClient = client;
        _resolvingTerminals = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _resolvingTerminals = false);
    }
  }

  @override
  void dispose() {
    if (widget.projectClient == null) _terminalsClient?.disconnect();
    super.dispose();
  }

  String _formatDate(int epochMillis) {
    if (epochMillis == 0) return '';
    final d = DateTime.fromMillisecondsSinceEpoch(epochMillis);
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
  }

  void _showInfo() {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(widget.project.name),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.project.path),
            const SizedBox(height: 8),
            Text(
              '${AppStrings.t('projects.lastOpened')}: ${_formatDate(widget.project.lastOpenedAt)}',
              style: const TextStyle(fontSize: 12, color: YggColors.textFaint),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(AppStrings.t('common.cancel')),
          ),
        ],
      ),
    );
  }

  void _openWorkspace() {
    final client = _terminalsClient;
    if (client == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppStrings.t('projects.notOpenOnComputer'))),
      );
      return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ProjectWorkspaceScreen(
          client: client,
          projectName: widget.project.name,
          projectPath: widget.project.path,
        ),
      ),
    );
  }

  /// Pushes a full-screen route for one section — tapping its tile in the grid
  /// "passes to the view with its content", with the grid itself reachable
  /// again via the system/AppBar back action.
  void _openSection(String label, Widget child) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => Scaffold(
          appBar: AppBar(title: Text(label, overflow: TextOverflow.ellipsis)),
          body: child,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sections = [
      _SectionTile(
        label: AppStrings.t('projects.tabTerminals'),
        icon: Icons.terminal,
        loading: _resolvingTerminals,
        onTap: () => _openSection(AppStrings.t('projects.tabTerminals'), TerminalsTab(client: _terminalsClient)),
      ),
      _SectionTile(
        label: AppStrings.t('projects.tabSessions'),
        icon: Icons.forum_outlined,
        onTap: () => _openSection(
          AppStrings.t('projects.tabSessions'),
          SessionsTab(client: widget.client, project: widget.project),
        ),
      ),
      _SectionTile(
        label: AppStrings.t('projects.tabAgentFlow'),
        icon: Icons.account_tree_outlined,
        onTap: () => _openSection(
          AppStrings.t('projects.tabAgentFlow'),
          AgentFlowTab(client: widget.client, project: widget.project),
        ),
      ),
      _SectionTile(
        label: AppStrings.t('projects.tabFiles'),
        icon: Icons.folder_outlined,
        loading: _resolvingTerminals,
        onTap: () => _openSection(AppStrings.t('projects.tabFiles'), FilesTab(client: _terminalsClient)),
      ),
      _SectionTile(
        label: AppStrings.t('projects.tabWorkflows'),
        icon: Icons.bolt_outlined,
        loading: _resolvingTerminals,
        onTap: () => _openSection(AppStrings.t('projects.tabWorkflows'), WorkflowsTab(client: _terminalsClient)),
      ),
      _SectionTile(
        label: AppStrings.t('projects.tabComplementos'),
        icon: Icons.extension_outlined,
        loading: _resolvingTerminals,
        onTap: () => _openSection(
          AppStrings.t('projects.tabComplementos'),
          ComplementosTab(client: _terminalsClient, project: widget.project),
        ),
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.project.name, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            icon: const Icon(Icons.splitscreen),
            tooltip: AppStrings.t('projects.workspace'),
            onPressed: _resolvingTerminals ? null : _openWorkspace,
          ),
          IconButton(
            icon: const Icon(Icons.info_outline),
            onPressed: _showInfo,
          ),
        ],
      ),
      body: GridView.count(
        crossAxisCount: 3,
        padding: const EdgeInsets.all(16),
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: 0.95,
        children: sections,
      ),
    );
  }
}

/// One tile in the project's section grid. `loading` shows a spinner instead
/// of the icon and disables the tap — used by sections that need
/// `_terminalsClient` to finish resolving (see
/// _ProjectDetailScreenState._resolveTerminalsClient) before they have
/// anything to open; Sessions/Agent Flow read straight off disk and are
/// never disabled.
class _SectionTile extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final bool loading;

  const _SectionTile({
    required this.label,
    required this.icon,
    required this.onTap,
    this.loading = false,
  });

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: loading ? 0.4 : 1,
      child: Material(
        color: YggColors.cardFill,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: loading ? null : onTap,
          child: Container(
            decoration: BoxDecoration(
              border: Border.all(color: YggColors.hairlineStrong),
              borderRadius: BorderRadius.circular(14),
            ),
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (loading)
                  const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent),
                  )
                else
                  Icon(icon, color: YggColors.accent, size: 26),
                const SizedBox(height: 8),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: YggColors.text, fontSize: 13),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
