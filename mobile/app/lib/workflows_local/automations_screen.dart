import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'automation_editor_screen.dart';
import 'local_workflow.dart';
import 'local_workflow_engine.dart';
import 'local_workflow_store.dart';
import 'trigger_arming.dart';

/// Automatizaciones — list, manual run, run history (design §5). Works offline,
/// independent of any gateway connection.
class AutomationsScreen extends StatefulWidget {
  const AutomationsScreen({super.key});

  @override
  State<AutomationsScreen> createState() => _AutomationsScreenState();
}

class _AutomationsScreenState extends State<AutomationsScreen> {
  List<Automation> _automations = [];
  final Map<String, RunRecord?> _lastRuns = {};
  bool _loading = true;
  final Set<String> _running = {};

  @override
  void initState() {
    super.initState();
    _reload();
    TriggerArmer.rearm().catchError((_) {});
  }

  Future<void> _setEnabled(Automation a, bool enabled) async {
    await LocalWorkflowStore.save(a.copyWith(enabled: enabled, updatedAt: DateTime.now().millisecondsSinceEpoch));
    await TriggerArmer.rearm().catchError((_) {});
    await _reload();
  }

  Future<void> _reload() async {
    final list = await LocalWorkflowStore.loadAll();
    final last = <String, RunRecord?>{};
    for (final a in list) {
      final runs = await LocalWorkflowStore.runsFor(a.id);
      last[a.id] = runs.isEmpty ? null : runs.first;
    }
    if (!mounted) return;
    setState(() {
      _automations = list;
      _lastRuns
        ..clear()
        ..addAll(last);
      _loading = false;
    });
  }

  Future<void> _openEditor([Automation? existing]) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => AutomationEditorScreen(automation: existing)));
    await _reload();
  }

  Future<void> _run(Automation a) async {
    setState(() => _running.add(a.id));
    final messenger = ScaffoldMessenger.of(context);
    final run = await AutomationEngine().run(a, runId: DateTime.now().microsecondsSinceEpoch.toString());
    await LocalWorkflowStore.addRun(run);
    if (!mounted) return;
    setState(() => _running.remove(a.id));
    await _reload();
    final failed = run.logs.where((l) => l.status == 'failed').toList();
    messenger.showSnackBar(SnackBar(
      content: Text(run.status == 'ok'
          ? AppStrings.t('auto.runOk')
          : AppStrings.tp('auto.runFailed', {'step': failed.isEmpty ? '?' : failed.last.label, 'error': failed.isEmpty ? '' : (failed.last.error ?? '')})),
    ));
  }

  Future<void> _delete(Automation a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        content: Text(AppStrings.tp('auto.deleteConfirm', {'name': a.name})),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(AppStrings.t('common.cancel'))),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(AppStrings.t('common.delete'))),
        ],
      ),
    );
    if (ok != true) return;
    await LocalWorkflowStore.delete(a.id);
    await TriggerArmer.rearm().catchError((_) {});
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('auto.title'))),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openEditor(),
        icon: const Icon(Icons.add),
        label: Text(AppStrings.t('auto.new')),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
          : _automations.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Text(AppStrings.t('auto.empty'), textAlign: TextAlign.center, style: const TextStyle(color: YggColors.textMuted)),
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                  itemCount: _automations.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final a = _automations[i];
                    final last = _lastRuns[a.id];
                    return ListTile(
                      title: Text(a.name, style: const TextStyle(fontWeight: FontWeight.w500)),
                      subtitle: Text(
                        '${AppStrings.tp('auto.stepCount', {'n': '${a.steps.length}'})} · ${last == null ? AppStrings.t('auto.neverRun') : (last.status == 'ok' ? AppStrings.t('auto.lastOk') : AppStrings.t('auto.lastFailed'))}',
                        style: const TextStyle(fontSize: 12, color: YggColors.textFainter),
                      ),
                      onTap: () => _openEditor(a),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Switch(
                            value: a.enabled,
                            activeColor: YggColors.accent,
                            onChanged: (v) => _setEnabled(a, v),
                          ),
                          IconButton(
                            tooltip: AppStrings.t('auto.history'),
                            icon: const Icon(Icons.history),
                            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => AutomationHistoryScreen(automation: a))),
                          ),
                          _running.contains(a.id)
                              ? const Padding(
                                  padding: EdgeInsets.all(12),
                                  child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                                )
                              : IconButton(
                                  tooltip: AppStrings.t('auto.run'),
                                  icon: const Icon(Icons.play_arrow),
                                  onPressed: () => _run(a),
                                ),
                          IconButton(
                            tooltip: AppStrings.t('common.delete'),
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => _delete(a),
                          ),
                        ],
                      ),
                    );
                  },
                ),
    );
  }
}

class AutomationHistoryScreen extends StatefulWidget {
  final Automation automation;
  const AutomationHistoryScreen({super.key, required this.automation});

  @override
  State<AutomationHistoryScreen> createState() => _AutomationHistoryScreenState();
}

class _AutomationHistoryScreenState extends State<AutomationHistoryScreen> {
  List<RunRecord> _runs = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    LocalWorkflowStore.runsFor(widget.automation.id).then((runs) {
      if (!mounted) return;
      setState(() {
        _runs = runs;
        _loading = false;
      });
    });
  }

  static String _when(int ms) {
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)} ${two(d.hour)}:${two(d.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('auto.historyTitle'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
          : _runs.isEmpty
              ? Center(child: Text(AppStrings.t('auto.noRuns'), style: const TextStyle(color: YggColors.textMuted)))
              : ListView(
                  children: [
                    for (final run in _runs)
                      ExpansionTile(
                        leading: Icon(run.status == 'ok' ? Icons.check_circle_outline : Icons.error_outline,
                            color: run.status == 'ok' ? YggColors.accent : YggColors.errorRed),
                        title: Text(_when(run.startedAt)),
                        subtitle: Text(run.status == 'ok' ? AppStrings.t('auto.lastOk') : AppStrings.t('auto.lastFailed')),
                        children: [
                          for (final l in run.logs)
                            ListTile(
                              dense: true,
                              title: Text(l.label),
                              subtitle: Text(
                                [l.status, if (l.output != null) l.output!, if (l.error != null) l.error!].join(' · '),
                                style: const TextStyle(fontSize: 12, color: YggColors.textFainter),
                              ),
                            ),
                        ],
                      ),
                  ],
                ),
    );
  }
}
