import 'dart:async';

import 'package:flutter/material.dart';

import '../chat/projects_screen.dart';
import '../gateway/gateway_connection.dart';
import '../l10n/app_strings.dart';
import '../plugins/complementos_repo.dart';
import '../plugins/complementos_tab.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';
import 'agent_flow_tab.dart';
import 'files_tab.dart';
import 'project_workspace_screen.dart';
import 'sessions_tab.dart';
import 'terminals_tab.dart';
import 'workflows_tab.dart';

/// Detail view for one project tapped from ProjectsScreen — a grid of sections:
/// Terminales, Sessions, Agent Flow, Files, Workflows, Complementos. Sessions/Agent
/// Flow read straight off that project's disk regardless of whether it's open right
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
  /// through the link server, where the port-on-same-host guess below doesn't
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

/// The live number each tile shows. null = not loaded yet (or it failed: the tile
/// then falls back to its static line instead of a wrong zero).
class _Summary {
  int? terminals;
  int? terminalsWorking;
  int? sessions;
  int? agents;
  int? workflows;
  int? complementos;
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen> {
  YggdrasilClient? _terminalsClient;
  bool _resolvingTerminals = true;
  final _summary = _Summary();
  static const _summaryTimeout = Duration(seconds: 6);

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    // Sessions and Agent Flow come off disk through the general client, so their
    // numbers don't wait for the project's own gateway to resolve.
    unawaited(_loadDiskSummary());
    await _resolveTerminalsClient();
    unawaited(_loadLiveSummary());
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

  /// Runs one summary lookup; a failure or timeout leaves that number unknown.
  Future<void> _lookup(Future<void> Function() fetch) async {
    try {
      await fetch().timeout(_summaryTimeout);
    } catch (_) {
      // The tile shows its static line instead.
    }
    if (mounted) setState(() {});
  }

  Future<void> _loadDiskSummary() async {
    final path = widget.project.path;
    await Future.wait([
      _lookup(() async {
        final res = await widget.client.call('projects.sessions.list', {'projectPath': path});
        _summary.sessions = ((res is Map ? res['sessions'] : null) as List?)?.length ?? 0;
      }),
      _lookup(() async {
        final res = await widget.client.call('projects.agentFlow.get', {'projectPath': path});
        final flow = res is Map ? res['agentFlow'] : null;
        _summary.agents = flow is Map ? ((flow['nodes'] as List?)?.length ?? 0) : 0;
      }),
    ]);
  }

  Future<void> _loadLiveSummary() async {
    final client = _terminalsClient;
    if (client == null) return;
    await Future.wait([
      _lookup(() async {
        final res = await client.call('terminals.list', {});
        final panes = ((res is Map ? res['panes'] : null) as List?) ?? const [];
        _summary.terminals = panes.length;
        _summary.terminalsWorking = panes.where((p) => p is Map && p['working'] == true).length;
      }),
      _lookup(() async => _summary.workflows = (await client.listWorkflows()).length),
      _lookup(() async => _summary.complementos = (await ComplementosRepo(client).list()).length),
    ]);
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
            Text(widget.project.path, style: TextStyle(fontFamily: YggFonts.mono, fontSize: 12.5, height: 1.5, color: YggColors.text)),
            const SizedBox(height: 10),
            Text(
              '${AppStrings.t('projects.lastOpened')}: ${_formatDate(widget.project.lastOpenedAt)}',
              style: TextStyle(fontSize: 12.5, color: YggColors.textMuted),
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
  /// again via the back button.
  void _openSection(String label, Widget child) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => YggScreen(title: label, eyebrow: widget.project.name, body: child),
      ),
    );
  }

  // ---- tile details -------------------------------------------------------------

  bool get _open => widget.project.isOpen || widget.projectClient != null;

  /// Tiles that need the project's own gateway: while it resolves they load,
  /// and if the project is closed they say so.
  YggTile _liveTile({
    required IconData icon,
    required String label,
    required Widget Function() page,
    String? detail,
    Color? dotColor,
    bool dotPulse = false,
    bool waiting = false,
  }) {
    final unavailable = !_resolvingTerminals && _terminalsClient == null;
    return YggTile(
      icon: icon,
      label: label,
      loading: _resolvingTerminals || waiting,
      enabled: !_resolvingTerminals,
      detail: unavailable ? AppStrings.t('projects.tileNeedsOpen') : detail,
      dotColor: unavailable ? null : dotColor,
      dotPulse: dotPulse,
      onTap: () => _openSection(label, page()),
    );
  }

  Widget _grid(List<Widget> tiles) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: tiles[i]),
              const SizedBox(width: 10),
              Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox.shrink()),
            ],
          ),
        ),
      );
      if (i + 2 < tiles.length) rows.add(const SizedBox(height: 10));
    }
    return Column(children: rows);
  }

  @override
  Widget build(BuildContext context) {
    final s = _summary;
    final terminalsDetail = s.terminals == null
        ? null
        : (s.terminalsWorking ?? 0) > 0
            ? AppStrings.tp('projects.tileTerminalsWorking', {'n': '${s.terminalsWorking}'})
            : s.terminals! > 0
                ? yggCount(s.terminals!, oneKey: 'projects.tileTerminalsOne', manyKey: 'projects.tileTerminals')
                : AppStrings.t('projects.tileTerminalsNone');
    final terminalsDot = s.terminals == null || s.terminals == 0
        ? null
        : (s.terminalsWorking ?? 0) > 0
            ? YggColors.working
            : YggColors.ready;

    final tiles = <Widget>[
      _liveTile(
        icon: Icons.terminal,
        label: AppStrings.t('projects.tabTerminals'),
        detail: terminalsDetail,
        dotColor: terminalsDot,
        dotPulse: (s.terminalsWorking ?? 0) > 0,
        waiting: _terminalsClient != null && s.terminals == null,
        page: () => TerminalsTab(client: _terminalsClient),
      ),
      YggTile(
        icon: Icons.forum_outlined,
        label: AppStrings.t('projects.tabSessions'),
        loading: s.sessions == null,
        detail: s.sessions == null ? null : yggCount(s.sessions!, oneKey: 'projects.tileSessionsOne', manyKey: 'projects.tileSessionsMany'),
        onTap: () => _openSection(AppStrings.t('projects.tabSessions'), SessionsTab(client: widget.client, project: widget.project)),
      ),
      YggTile(
        icon: Icons.account_tree_outlined,
        label: AppStrings.t('projects.tabAgentFlow'),
        loading: s.agents == null,
        detail: s.agents == null
            ? null
            : s.agents! > 0
                ? yggCount(s.agents!, oneKey: 'projects.tileAgentsOne', manyKey: 'projects.tileAgentsMany')
                : AppStrings.t('projects.tileNotSetUp'),
        onTap: () => _openSection(AppStrings.t('projects.tabAgentFlow'), AgentFlowTab(client: widget.client, project: widget.project)),
      ),
      _liveTile(
        icon: Icons.folder_outlined,
        label: AppStrings.t('projects.tabFiles'),
        detail: AppStrings.t('projects.tileBrowse'),
        page: () => FilesTab(client: _terminalsClient),
      ),
      _liveTile(
        icon: Icons.bolt_outlined,
        label: AppStrings.t('projects.tabWorkflows'),
        detail: s.workflows == null ? null : yggCount(s.workflows!, oneKey: 'projects.tileWorkflowsOne', manyKey: 'projects.tileWorkflowsMany'),
        waiting: _terminalsClient != null && s.workflows == null,
        page: () => WorkflowsTab(client: _terminalsClient),
      ),
      _liveTile(
        icon: Icons.extension_outlined,
        label: AppStrings.t('projects.tabComplementos'),
        detail: s.complementos == null
            ? null
            : s.complementos! > 0
                ? yggCount(s.complementos!, oneKey: 'projects.tileComplementosOne', manyKey: 'projects.tileComplementosMany')
                : AppStrings.t('projects.tileComplementosNone'),
        waiting: _terminalsClient != null && s.complementos == null,
        page: () => ComplementosTab(client: _terminalsClient, project: widget.project),
      ),
    ];

    return YggScreen(
      title: widget.project.name,
      actions: [
        YggIconButton(
          icon: Icons.splitscreen,
          tooltip: AppStrings.t('projects.workspace'),
          onTap: _resolvingTerminals ? null : _openWorkspace,
        ),
        YggIconButton(
          icon: Icons.info_outline,
          tooltip: AppStrings.t('projects.info'),
          onTap: _showInfo,
        ),
      ],
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 18),
            child: Row(
              children: [
                _open
                    ? YggChip(AppStrings.t('projects.chipOpen'), tone: YggChipTone.ready, dot: true)
                    : YggChip(AppStrings.t('projects.chipClosed')),
                if (widget.project.lastOpenedAt > 0) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      AppStrings.tp('projects.openedAgo', {'when': yggTimeAgo(widget.project.lastOpenedAt)}),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontFamily: YggFonts.mono, fontSize: 11, color: YggColors.textFainter),
                    ),
                  ),
                ],
              ],
            ),
          ),
          _grid(tiles),
        ],
      ),
    );
  }
}
