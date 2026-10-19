import 'package:flutter/material.dart';

import '../chat/projects_screen.dart';
import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

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

  Widget _nodesList(List<Map> nodes) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final node in nodes)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  node['name']?.toString() ?? '',
                  style: const TextStyle(fontSize: 14.5, color: YggColors.text),
                ),
                const SizedBox(height: 2),
                Text(
                  _harnessLabel(node['harness']),
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: YggColors.textFaint,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading)
      return const Center(
        child: CircularProgressIndicator(color: YggColors.accent),
      );
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          '${AppStrings.t('common.errorPrefix')}: $_error',
          style: const TextStyle(color: YggColors.textMuted),
        ),
      );
    }
    final flow = _flow;
    if (flow == null && _teams.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            AppStrings.t('projects.noAgentFlow'),
            style: const TextStyle(color: YggColors.textFaint),
          ),
        ),
      );
    }

    final edges = (flow?['edges'] as List<dynamic>? ?? []).cast<Map>();
    final supervisor = (flow?['supervisor'] as Map?)?['type']?.toString() ?? '';

    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (flow != null) ...[
            Text(
              flow['name']?.toString() ?? '',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: YggColors.text,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${AppStrings.t('projects.supervisor')}: $supervisor',
              style: const TextStyle(
                fontSize: 12.5,
                color: YggColors.textFaint,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              AppStrings.t('projects.nodes'),
              style: const TextStyle(
                fontSize: 12,
                letterSpacing: 1.2,
                color: YggColors.textFainter,
              ),
            ),
            const SizedBox(height: 8),
            _nodesList((flow['nodes'] as List<dynamic>? ?? []).cast<Map>()),
            if (edges.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                AppStrings.t('projects.edges'),
                style: const TextStyle(
                  fontSize: 12,
                  letterSpacing: 1.2,
                  color: YggColors.textFainter,
                ),
              ),
              const SizedBox(height: 8),
              for (final edge in edges)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    '${edge['from']} → ${edge['to']}${edge['label'] != null ? " (${edge['label']})" : ""}',
                    style: const TextStyle(
                      fontSize: 13,
                      color: YggColors.textFaint,
                    ),
                  ),
                ),
            ],
          ],
          if (_teams.isNotEmpty) ...[
            if (flow != null) const SizedBox(height: 24),
            Text(
              AppStrings.t('projects.teams'),
              style: const TextStyle(
                fontSize: 12,
                letterSpacing: 1.2,
                color: YggColors.textFainter,
              ),
            ),
            const SizedBox(height: 8),
            for (final team in _teams)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      team['name']?.toString() ?? '',
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                        color: YggColors.text,
                      ),
                    ),
                    const SizedBox(height: 6),
                    _nodesList(
                      (team['nodes'] as List<dynamic>? ?? []).cast<Map>(),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}
