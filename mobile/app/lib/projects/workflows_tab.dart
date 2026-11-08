import 'dart:async';
import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';

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
  final Map<String, Map> _lastRun = {};

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
      unawaited(_loadLastRuns());
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
      setState(() {
        _runsByWorkflow[workflowId] = runs.cast<Map>();
        if (runs.isNotEmpty && runs.first is Map) _lastRun[workflowId] = runs.first as Map;
      });
    } catch (_) {
      // Best-effort — the expanded row still shows without history on failure.
    }
  }

  /// One run per workflow (the newest), so each card can say how it last went. Capped
  /// so a project with many workflows doesn't fire a burst of requests.
  Future<void> _loadLastRuns() async {
    final client = widget.client;
    if (client == null) return;
    for (final summary in _summaries.take(12)) {
      final id = ((summary['workflow'] as Map?)?['id'])?.toString();
      if (id == null || id.isEmpty) continue;
      try {
        final runs = await client.listWorkflowRuns(workflowId: id, limit: 1);
        if (!mounted) return;
        if (runs.isNotEmpty && runs.first is Map) setState(() => _lastRun[id] = runs.first as Map);
      } catch (_) {
        // The card just shows no last run.
      }
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

  YggChipTone _runTone(String? status) {
    switch (status) {
      case 'succeeded':
        return YggChipTone.ready;
      case 'failed':
        return YggChipTone.danger;
      case 'running':
        return YggChipTone.working;
      default:
        return YggChipTone.neutral;
    }
  }

  String _runLabel(String? status) {
    switch (status) {
      case 'succeeded':
        return AppStrings.t('workflows.statusSucceeded');
      case 'failed':
        return AppStrings.t('workflows.statusFailed');
      case 'running':
        return AppStrings.t('workflows.statusRunning');
      case 'pending':
      case 'queued':
        return AppStrings.t('workflows.statusPending');
      default:
        return status ?? '?';
    }
  }

  Widget _statusChip(String? status) => YggChip(_runLabel(status), tone: _runTone(status), dot: true, pulse: status == 'running');

  /// "manual · hace 1 min" for a run map.
  String _runWhen(Map run) {
    final trigger = (run['trigger'] is Map ? (run['trigger'] as Map)['type'] : null)?.toString() ?? '';
    final startedAt = yggEpochFromIso(run['startedAt']);
    final when = startedAt > 0 ? yggTimeAgo(startedAt) : '';
    return [trigger, when].where((p) => p.isNotEmpty).join(' · ');
  }

  TextStyle get _monoMuted => TextStyle(fontFamily: YggFonts.mono, fontSize: 11, color: YggColors.textMuted);

  Widget _runHistory(String workflowId) {
    final runs = _runsByWorkflow[workflowId];
    if (runs == null) return const SizedBox.shrink();
    if (runs.isEmpty) {
      return Text(AppStrings.t('projects.workflowNoRuns'), style: TextStyle(fontSize: 12.5, color: YggColors.textMuted));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final run in runs)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                _statusChip(run['status']?.toString()),
                const SizedBox(width: 10),
                Expanded(child: Text(_runWhen(run), style: _monoMuted, overflow: TextOverflow.ellipsis)),
              ],
            ),
          ),
      ],
    );
  }

  Color _nodeColor(String? status) {
    switch (status) {
      case 'succeeded':
        return YggColors.ready;
      case 'failed':
        return YggColors.danger;
      case 'running':
        return YggColors.working;
      default:
        return YggColors.textFainter;
    }
  }

  Widget _nodeStatuses(Map<String, dynamic>? run) {
    final nodes = run?['nodes'];
    if (nodes is! Map || nodes.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: YggColors.cardFillHighest, borderRadius: BorderRadius.circular(YggRadius.md)),
      child: Column(
        children: [
          for (final entry in nodes.entries)
            Builder(builder: (context) {
              final status = (entry.value as Map?)?['status']?.toString();
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    YggDot(color: _nodeColor(status), pulse: status == 'running'),
                    const SizedBox(width: 8),
                    Expanded(child: Text(entry.key.toString(), style: TextStyle(fontFamily: YggFonts.mono, fontSize: 12, color: YggColors.text))),
                    Text(_runLabel(status), style: TextStyle(fontFamily: YggFonts.mono, fontSize: 12, color: _nodeColor(status))),
                  ],
                ),
              );
            }),
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
    final last = _lastRun[id];
    final canRun = enabled && allowRemoteTrigger && _runningWorkflowId == null;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        decoration: BoxDecoration(
          color: YggColors.surface,
          border: Border.all(color: isRunningThis ? YggColors.borderStrong : YggColors.border),
          borderRadius: BorderRadius.circular(YggRadius.lg),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: () => _toggleExpanded(id),
              child: Row(
                children: [
                  Expanded(
                    child: Text(name, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: enabled ? YggColors.text : YggColors.text2)),
                  ),
                  Icon(expanded ? Icons.expand_less : Icons.expand_more, color: YggColors.textFaint, size: 20),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (!enabled) YggChip(AppStrings.t('projects.workflowDisabled')),
                if (grantStatus != null && grantStatus != 'not_required')
                  grantStatus == 'granted'
                      ? YggChip(AppStrings.t('workflows.granted'), tone: YggChipTone.ready)
                      : YggChip(AppStrings.t('workflows.grantPending'), tone: YggChipTone.working),
              ],
            ),
            if (isRunningThis || last != null) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  _statusChip(isRunningThis ? (_runningRun?['status']?.toString() ?? 'running') : last!['status']?.toString()),
                  const SizedBox(width: 10),
                  Expanded(child: Text(_runWhen(isRunningThis ? (_runningRun ?? last ?? const {}) : last!), style: _monoMuted, overflow: TextOverflow.ellipsis)),
                ],
              ),
            ] else if (enabled) ...[
              const SizedBox(height: 10),
              Text(AppStrings.t('workflows.noRunsYet'), style: TextStyle(fontSize: 12.5, color: YggColors.textMuted)),
            ],
            if (isRunningThis) _nodeStatuses(_runningRun),
            if (!enabled) ...[
              const SizedBox(height: 10),
              Text(AppStrings.t('workflows.disabledHint'), style: TextStyle(fontSize: 12.5, height: 1.45, color: YggColors.textMuted)),
            ] else if (!allowRemoteTrigger) ...[
              const SizedBox(height: 10),
              Text(AppStrings.t('projects.workflowRemoteTriggerOff'), style: TextStyle(fontSize: 12.5, height: 1.45, color: YggColors.working)),
            ],
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerRight,
              child: isRunningThis && _runningRunId != null
                  ? OutlinedButton(
                      onPressed: _cancel,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: YggColors.danger,
                        side: BorderSide(color: YggColors.danger.withValues(alpha: 0.5)),
                      ),
                      child: Text(AppStrings.t('projects.workflowCancel')),
                    )
                  : FilledButton.icon(
                      onPressed: canRun ? () => _run(id) : null,
                      icon: const Icon(Icons.play_arrow, size: 18),
                      label: Text(AppStrings.t('projects.workflowRun')),
                    ),
            ),
            if (expanded) ...[
              const SizedBox(height: 14),
              Divider(height: 1, color: YggColors.border),
              const SizedBox(height: 12),
              YggSectionLabel(AppStrings.t('projects.workflowRunHistory'), padding: const EdgeInsets.only(bottom: 8)),
              _runHistory(id),
              const SizedBox(height: 4),
              Text(AppStrings.t('projects.workflowArtifactsNote'), style: TextStyle(fontSize: 11, color: YggColors.textFainter)),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.client == null) {
      return YggEmptyState(icon: Icons.bolt_outlined, message: AppStrings.t('projects.notOpenOnComputer'));
    }
    if (_loading) return Center(child: CircularProgressIndicator(color: YggColors.accent));
    if (_error != null) {
      return YggEmptyState(
        icon: Icons.error_outline,
        message: '${AppStrings.t('common.errorPrefix')}: $_error',
        action: OutlinedButton(onPressed: _load, child: Text(AppStrings.t('common.retry'))),
      );
    }
    if (_summaries.isEmpty) {
      return YggEmptyState(icon: Icons.bolt_outlined, message: AppStrings.t('projects.noWorkflows'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [for (final summary in _summaries) _workflowRow(summary)],
      ),
    );
  }
}
