import 'dart:async';
import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

/// Workflows tab for a project — list + run + cancel + run history, molded
/// on agent_flow_tab.dart's read-only/Map-based structure (no typed Dart
/// model, see notes/automation/workflows-design.md §8.3: "no edita ni
/// otorga grants en v1" — granting stays desktop-only, gated by
/// workflows.grant's isLoopbackConnection check). Unlike AgentFlowTab (which
/// reads straight off disk through the general `client` regardless of
/// whether the project's gateway is running), workflows.* are real gateway
/// RPCs that need that project's OWN live gateway — same `client` as
/// TerminalsTab/FilesTab (project_detail_screen.dart's `_terminalsClient`,
/// nullable when the project isn't open on the computer right now).
///
/// "Live" per-node status (the design doc's §8.3 ask) is short-interval
/// polling of workflows.runs.get while a run this tab itself started is
/// still "running", not a WS event subscription — project_detail_screen.dart
/// connects `_terminalsClient` with a no-op onMessage today, and wiring a
/// real event fan-out across all of that project's tabs is a bigger, riskier
/// change than this tab needs on its own. A 1s poll is a fine approximation
/// for a UI a person is actively looking at.
class WorkflowsTab extends StatefulWidget {
  final YggdrasilClient? client;

  const WorkflowsTab({super.key, required this.client});

  @override
  State<WorkflowsTab> createState() => _WorkflowsTabState();
}

class _WorkflowsTabState extends State<WorkflowsTab> {
  List<Map> _summaries = [];
  bool _loading = true;
  String? _error;
  String? _expandedId;
  final Map<String, List<Map>> _runsByWorkflow = {};

  String? _runningWorkflowId;
  String? _runningRunId;
  Map<String, dynamic>? _runningRun;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    if (widget.client != null) _load();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final client = widget.client;
    if (client == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final summaries = await client.listWorkflows();
      if (!mounted) return;
      setState(() {
        _summaries = summaries.cast<Map>();
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

  Future<void> _loadRuns(String workflowId) async {
    final client = widget.client;
    if (client == null) return;
    try {
      final runs = await client.listWorkflowRuns(workflowId: workflowId, limit: 10);
      if (!mounted) return;
      setState(() => _runsByWorkflow[workflowId] = runs.cast<Map>());
    } catch (_) {
      // Best-effort — the expanded row still shows without history on failure.
    }
  }

  void _toggleExpanded(String id) {
    final opening = _expandedId != id;
    setState(() => _expandedId = opening ? id : null);
    if (opening) _loadRuns(id);
  }

  Future<void> _run(String id) async {
    final client = widget.client;
    if (client == null) return;
    setState(() {
      _runningWorkflowId = id;
      _runningRunId = null;
      _runningRun = null;
    });
    try {
      final result = await client.runWorkflow(id);
      final run = result['run'];
      if (run is! Map) {
        if (!mounted) return;
        setState(() => _runningWorkflowId = null);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(result['reason']?.toString() ?? 'skipped')),
        );
        return;
      }
      final runId = run['id']?.toString();
      if (!mounted || runId == null) return;
      setState(() {
        _runningRunId = runId;
        _runningRun = run.cast<String, dynamic>();
      });
      _startPolling(id, runId);
    } catch (e) {
      if (!mounted) return;
      setState(() => _runningWorkflowId = null);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  void _startPolling(String workflowId, String runId) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 1), (_) async {
      final client = widget.client;
      if (client == null) return;
      try {
        final run = await client.getWorkflowRun(runId);
        if (!mounted || run == null) return;
        setState(() => _runningRun = run);
        if (run['status']?.toString() != 'running') {
          _pollTimer?.cancel();
          setState(() => _runningWorkflowId = null);
          unawaited(_loadRuns(workflowId));
        }
      } catch (_) {
        _pollTimer?.cancel();
        if (!mounted) return;
        setState(() => _runningWorkflowId = null);
      }
    });
  }

  Future<void> _cancel() async {
    final client = widget.client;
    final runId = _runningRunId;
    if (client == null || runId == null) return;
    await client.cancelWorkflowRun(runId);
  }

  Widget _statusChip(String? status) {
    Color color;
    switch (status) {
      case 'succeeded':
        color = YggColors.accent;
        break;
      case 'failed':
        color = Colors.redAccent;
        break;
      case 'running':
        color = Colors.amber;
        break;
      default:
        color = YggColors.textFaint;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(border: Border.all(color: color), borderRadius: BorderRadius.circular(4)),
      child: Text(status ?? '?', style: TextStyle(fontSize: 11, color: color)),
    );
  }

  Widget _runHistory(String workflowId) {
    final runs = _runsByWorkflow[workflowId];
    if (runs == null) return const SizedBox.shrink();
    if (runs.isEmpty) {
      return Text(AppStrings.t('projects.workflowNoRuns'), style: const TextStyle(fontSize: 12.5, color: YggColors.textFaint));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final run in runs)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                _statusChip(run['status']?.toString()),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${run['trigger']?['type'] ?? ''} · ${run['startedAt'] ?? ''}',
                    style: const TextStyle(fontSize: 12, color: YggColors.textFaint),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _nodeStatuses(Map<String, dynamic>? run) {
    final nodes = run?['nodes'];
    if (nodes is! Map || nodes.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final entry in nodes.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  _statusChip((entry.value as Map?)?['status']?.toString()),
                  const SizedBox(width: 8),
                  Text(entry.key.toString(), style: const TextStyle(fontSize: 12.5, color: YggColors.text)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _workflowRow(Map summary) {
    final workflow = (summary['workflow'] as Map?) ?? {};
    final id = workflow['id']?.toString() ?? '';
    final name = workflow['name']?.toString() ?? id;
    final enabled = workflow['enabled'] == true;
    final allowRemoteTrigger = (workflow['settings'] as Map?)?['allowRemoteTrigger'] == true;
    final grantStatus = summary['grantStatus']?.toString();
    final expanded = _expandedId == id;
    final isRunningThis = _runningWorkflowId == id;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        decoration: BoxDecoration(
          border: Border.all(color: YggColors.hairline),
          borderRadius: BorderRadius.circular(8),
        ),
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: () => _toggleExpanded(id),
              child: Row(
                children: [
                  Expanded(
                    child: Text(name, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: YggColors.text)),
                  ),
                  if (!enabled)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Text(AppStrings.t('projects.workflowDisabled'), style: const TextStyle(fontSize: 11, color: YggColors.textFaint)),
                    ),
                  if (grantStatus != null && grantStatus != 'not_required')
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Text(grantStatus, style: TextStyle(fontSize: 11, color: grantStatus == 'granted' ? YggColors.accent : Colors.amber)),
                    ),
                  Icon(expanded ? Icons.expand_less : Icons.expand_more, color: YggColors.textFaint, size: 18),
                ],
              ),
            ),
            if (expanded) ...[
              const SizedBox(height: 10),
              if (!allowRemoteTrigger)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    AppStrings.t('projects.workflowRemoteTriggerOff'),
                    style: const TextStyle(fontSize: 12, color: Colors.amber),
                  ),
                ),
              Row(
                children: [
                  if (isRunningThis && _runningRunId != null)
                    OutlinedButton(onPressed: _cancel, child: Text(AppStrings.t('projects.workflowCancel')))
                  else
                    ElevatedButton(
                      onPressed: (enabled && allowRemoteTrigger && _runningWorkflowId == null) ? () => _run(id) : null,
                      child: Text(AppStrings.t('projects.workflowRun')),
                    ),
                  if (isRunningThis) ...[
                    const SizedBox(width: 10),
                    _statusChip(_runningRun?['status']?.toString() ?? 'running'),
                  ],
                ],
              ),
              if (isRunningThis) _nodeStatuses(_runningRun),
              const SizedBox(height: 12),
              Text(
                AppStrings.t('projects.workflowRunHistory'),
                style: const TextStyle(fontSize: 12, letterSpacing: 1.2, color: YggColors.textFainter),
              ),
              const SizedBox(height: 6),
              _runHistory(id),
              const SizedBox(height: 8),
              Text(AppStrings.t('projects.workflowArtifactsNote'), style: const TextStyle(fontSize: 11, color: YggColors.textFainter)),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.client == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(AppStrings.t('projects.notOpenOnComputer'), style: const TextStyle(color: YggColors.textFaint)),
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
    if (_summaries.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(AppStrings.t('projects.noWorkflows'), style: const TextStyle(color: YggColors.textFaint)),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [for (final summary in _summaries) _workflowRow(summary)],
      ),
    );
  }
}
