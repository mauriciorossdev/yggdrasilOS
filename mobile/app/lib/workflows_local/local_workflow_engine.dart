import 'dart:async';

import '../capabilities/capability_registry.dart';
import '../services/capabilities_store.dart';
import 'local_expressions.dart';
import 'local_workflow.dart';

typedef CapabilityRunner = Future<Map<String, dynamic>> Function(String name, Map<String, dynamic> args);

/// Runs an automation step by step on the phone (design §3). Manual runs only
/// in phase 3; triggers and background execution come in phase 4.
class AutomationEngine {
  static const maxDelaySeconds = 300;

  final CapabilityRunner _runCapability;
  final DateTime Function() _now;
  final bool requestPermissions;

  /// [requestPermissions] false for background runs: there is no UI to show a
  /// permission dialog, so a missing permission just fails that step.
  AutomationEngine({CapabilityRunner? runCapability, DateTime Function()? now, this.requestPermissions = true})
      : _runCapability = runCapability ?? _defaultRunner(requestPermissions),
        _now = now ?? DateTime.now;

  static CapabilityRunner _defaultRunner(bool requestPermissions) => (name, args) async {
        if (!(await CapabilitiesStore.isEnabled(name))) throw StateError('capability_disabled');
        final capability = capabilityByName(name);
        if (capability == null) throw StateError('unknown_capability:$name');
        return requestPermissions ? capability.invoke(args) : capability.run(args);
      };

  Future<RunRecord> run(Automation automation, {required String runId, Map<String, dynamic>? trigger}) async {
    final started = _now().millisecondsSinceEpoch;
    final context = <String, dynamic>{'steps': <String, dynamic>{}, 'now': started, 'trigger': trigger ?? const {}};
    final logs = <StepLog>[];
    final ok = await _runSteps(automation.steps, context, logs);
    return RunRecord(
      id: runId,
      automationId: automation.id,
      startedAt: started,
      endedAt: _now().millisecondsSinceEpoch,
      status: ok ? 'ok' : 'failed',
      logs: logs,
    );
  }

  /// Returns false when a step failed and the run must stop.
  Future<bool> _runSteps(List<Step> steps, Map<String, dynamic> context, List<StepLog> logs) async {
    for (final step in steps) {
      switch (step.kind) {
        case StepKind.delay:
          final s = (step.seconds ?? 0).clamp(0, maxDelaySeconds);
          await Future.delayed(Duration(seconds: s));
          logs.add(StepLog(stepId: step.id, label: step.label, status: 'ok'));
        case StepKind.ifCondition:
          final cond = step.condition;
          if (cond == null) {
            logs.add(StepLog(stepId: step.id, label: step.label, status: 'failed', error: 'no_condition'));
            return false;
          }
          final truth = evaluateCondition(cond, context);
          logs.add(StepLog(stepId: step.id, label: step.label, status: 'branch', output: truth ? 'true' : 'false'));
          final branch = truth ? step.thenSteps : step.elseSteps;
          if (!await _runSteps(branch, context, logs)) return false;
        case StepKind.capability:
          final name = step.capability ?? '';
          try {
            final args = (resolveValue(step.args, context) as Map).cast<String, dynamic>();
            final output = await _runCapability(name, args);
            if (step.saveAs != null) (context['steps'] as Map<String, dynamic>)[step.saveAs!] = output;
            logs.add(StepLog(stepId: step.id, label: step.label, status: 'ok', output: '$output'));
          } catch (e) {
            logs.add(StepLog(stepId: step.id, label: step.label, status: 'failed', error: _errorText(e)));
            if (step.onError != 'continue') return false;
          }
      }
    }
    return true;
  }

  static String _errorText(Object e) => switch (e) {
        StateError(:final message) => message,
        _ => e.toString(),
      };
}
