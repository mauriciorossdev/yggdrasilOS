import 'package:flutter/material.dart';

import '../chat/projects_screen.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';

/// Static Agent Flow + Agent Teams for a project — read-only, structured
/// display (no visual canvas, that's desktop-only territory). A project can
/// have real Teams (main/agentTeams.ts's agent-teams.json, e.g. auto-captured
/// via create_pane) with no saved canvas flow (agent-flow.json) at all —
/// desktop's own Agent Flow screen (AgentFlowView.tsx) surfaces both in one
/// place via its "Open Team ▾" menu, so this tab does too rather than
/// reporting "no Agent Flow" just because the canvas-specific file is empty.
class AgentFlowTab extends StatefulWidget {
  final YggdrasilClient client;
  final ProjectRecord project;

  const AgentFlowTab({super.key, required this.client, required this.project});

  @override
  State<AgentFlowTab> createState() => _AgentFlowTabState();
}

class _AgentFlowTabState extends State<AgentFlowTab> {
  Map<String, dynamic>? _flow;
  List<Map> _teams = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.client.call('projects.agentFlow.get', {
          'projectPath': widget.project.path,
        }),
        widget.client.call('projects.agentTeams.list', {
          'projectPath': widget.project.path,
        }),
      ]);
      final flow = results[0] is Map ? (results[0] as Map)['agentFlow'] : null;
      final teamsList =
          (results[1] is Map ? (results[1] as Map)['teams'] : null)
              as List<dynamic>? ??
          [];
      if (!mounted) return;
      setState(() {
        _flow = flow is Map ? flow.cast<String, dynamic>() : null;
        _teams = teamsList.cast<Map>();
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

  String _harnessLabel(dynamic harness) {
    if (harness is! Map) return '';
    final type = harness['type']?.toString() ?? '';
    if (type == 'yggdrasil') return 'Yggdrasil (${harness['agentId'] ?? '?'})';
    final model = harness['model']?.toString();
    return model != null ? '$type · $model' : type;
  }

  /// One agent: a numbered tile, its name and (in mono) the harness it runs on.
  Widget _nodeCard(Map node, int number) {
    final harness = _harnessLabel(node['harness']);
    return YggCard(
      radius: YggRadius.lg,
      color: YggColors.surface,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: YggColors.accentSoft, borderRadius: BorderRadius.circular(YggRadius.md)),
            child: Text('$number', style: TextStyle(fontFamily: YggFonts.mono, fontSize: 14, fontWeight: FontWeight.w500, color: YggColors.accent)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(node['name']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: YggColors.text)),
                if (harness.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(harness, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: YggFonts.mono, fontSize: 11, color: YggColors.textMuted)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _nodesList(List<Map> nodes) {
    return Column(
      children: [
        for (var i = 0; i < nodes.length; i++) ...[
          _nodeCard(nodes[i], i + 1),
          if (i < nodes.length - 1) const SizedBox(height: 8),
        ],
      ],
    );
  }

  /// "Planificador → Desarrollador   tarea": one connection between two agents.
  Widget _edgeRow(Map edge) {
    final mono = TextStyle(fontFamily: YggFonts.mono, fontSize: 12, color: YggColors.text);
    final label = edge['label']?.toString();
    return Container(
      constraints: const BoxConstraints(minHeight: 44),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Text.rich(
              TextSpan(
                style: mono,
                children: [
                  TextSpan(text: '${edge['from']}'),
                  TextSpan(text: '  →  ', style: mono.copyWith(color: YggColors.accent)),
                  TextSpan(text: '${edge['to']}'),
                ],
              ),
            ),
          ),
          if (label != null && label.isNotEmpty) ...[
            const SizedBox(width: 10),
            Text(label, style: mono.copyWith(color: YggColors.textMuted)),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Center(child: CircularProgressIndicator(color: YggColors.accent));
    }
    if (_error != null) {
      return YggEmptyState(
        icon: Icons.error_outline,
        message: '${AppStrings.t('common.errorPrefix')}: $_error',
        action: OutlinedButton(onPressed: _load, child: Text(AppStrings.t('common.retry'))),
      );
    }
    final flow = _flow;
    if (flow == null && _teams.isEmpty) {
      return YggEmptyState(icon: Icons.account_tree_outlined, message: AppStrings.t('projects.noAgentFlow'));
    }

    final nodes = (flow?['nodes'] as List<dynamic>? ?? []).cast<Map>();
    final edges = (flow?['edges'] as List<dynamic>? ?? []).cast<Map>();
    final supervisor = (flow?['supervisor'] as Map?)?['type']?.toString() ?? '';

    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          if (flow != null) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    flow['name']?.toString() ?? '',
                    style: TextStyle(fontFamily: YggFonts.serif, fontSize: 22, height: 1.2, color: YggColors.text),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: [
                      if (supervisor.isNotEmpty) YggChip('${AppStrings.t('projects.supervisor')} · $supervisor', tone: YggChipTone.accent),
                      YggChip(AppStrings.tp('agentflow.counts', {'nodes': '${nodes.length}', 'edges': '${edges.length}'})),
                    ],
                  ),
                ],
              ),
            ),
            YggSectionLabel(AppStrings.t('projects.nodes')),
            _nodesList(nodes),
            if (edges.isNotEmpty) ...[
              const SizedBox(height: 22),
              YggSectionLabel(AppStrings.t('projects.edges')),
              YggListGroup(children: [for (final edge in edges) _edgeRow(edge)]),
            ],
          ],
          if (_teams.isNotEmpty) ...[
            if (flow != null) const SizedBox(height: 26),
            YggSectionLabel(AppStrings.t('projects.teams')),
            for (final team in _teams) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 4, 4, 10),
                child: Text(team['name']?.toString() ?? '', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: YggColors.text)),
              ),
              _nodesList((team['nodes'] as List<dynamic>? ?? []).cast<Map>()),
              const SizedBox(height: 18),
            ],
          ],
        ],
      ),
    );
  }
}
