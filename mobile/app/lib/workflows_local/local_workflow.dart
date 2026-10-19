/// On-device automations (notes/yggdrasil-mobile/on-device-workflows-design.md §3).
/// Linear steps with if/else branches — the v1 model the mobile editor can
/// actually edit, not the gateway's graph.
library;

import 'auto_trigger.dart';

enum StepKind { capability, ifCondition, delay }

class Condition {
  /// Template or literal, e.g. `{{steps.bat.batteryPercent}}`.
  final String left;

  /// eq | neq | contains | gt | lt | exists
  final String op;
  final String? right;

  const Condition({required this.left, required this.op, this.right});

  factory Condition.fromJson(Map<String, dynamic> j) =>
      Condition(left: j['left'] as String, op: j['op'] as String, right: j['right'] as String?);

  Map<String, dynamic> toJson() => {'left': left, 'op': op, 'right': right};
}

class Step {
  final String id;
  final StepKind kind;

  /// capability: device tool name, e.g. `phone_device_state`.
  final String? capability;
  final Map<String, dynamic> args;

  /// capability: store the output under `steps.<saveAs>` for later steps.
  final String? saveAs;

  /// ifCondition
  final Condition? condition;
  final List<Step> thenSteps;
  final List<Step> elseSteps;

  /// delay
  final int? seconds;

  /// capability: "stop" (default) ends the run on failure, "continue" keeps going.
  final String onError;

  const Step({
    required this.id,
    required this.kind,
    this.capability,
    this.args = const {},
    this.saveAs,
    this.condition,
    this.thenSteps = const [],
    this.elseSteps = const [],
    this.seconds,
    this.onError = 'stop',
  });

  String get label => switch (kind) {
        StepKind.capability => capability ?? '?',
        StepKind.ifCondition => 'si',
        StepKind.delay => 'esperar ${seconds ?? 0}s',
      };

  factory Step.fromJson(Map<String, dynamic> j) => Step(
        id: j['id'] as String,
        kind: StepKind.values.byName(j['kind'] as String),
        capability: j['capability'] as String?,
        args: (j['args'] as Map?)?.cast<String, dynamic>() ?? const {},
        saveAs: j['saveAs'] as String?,
        condition: j['condition'] == null ? null : Condition.fromJson((j['condition'] as Map).cast<String, dynamic>()),
        thenSteps: _stepsFrom(j['then']),
        elseSteps: _stepsFrom(j['else']),
        seconds: (j['seconds'] as num?)?.toInt(),
        onError: j['onError'] as String? ?? 'stop',
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind.name,
        if (capability != null) 'capability': capability,
        if (args.isNotEmpty) 'args': args,
        if (saveAs != null) 'saveAs': saveAs,
        if (condition != null) 'condition': condition!.toJson(),
        if (thenSteps.isNotEmpty) 'then': thenSteps.map((s) => s.toJson()).toList(),
        if (elseSteps.isNotEmpty) 'else': elseSteps.map((s) => s.toJson()).toList(),
        if (seconds != null) 'seconds': seconds,
        'onError': onError,
      };

  static List<Step> _stepsFrom(Object? raw) =>
      (raw as List?)?.map((e) => Step.fromJson((e as Map).cast<String, dynamic>())).toList() ?? const [];
}

class Automation {
  final String id;
  final String name;
  final bool enabled;
  final List<Step> steps;
  final List<AutoTrigger> triggers;
  final int updatedAt;

  const Automation({
    required this.id,
    required this.name,
    this.enabled = true,
    this.steps = const [],
    this.triggers = const [],
    required this.updatedAt,
  });

  Automation copyWith({String? name, bool? enabled, List<Step>? steps, List<AutoTrigger>? triggers, int? updatedAt}) =>
      Automation(
        id: id,
        name: name ?? this.name,
        enabled: enabled ?? this.enabled,
        steps: steps ?? this.steps,
        triggers: triggers ?? this.triggers,
        updatedAt: updatedAt ?? this.updatedAt,
      );

  factory Automation.fromJson(Map<String, dynamic> j) => Automation(
        id: j['id'] as String,
        name: j['name'] as String,
        enabled: j['enabled'] as bool? ?? true,
        steps: (j['steps'] as List).map((e) => Step.fromJson((e as Map).cast<String, dynamic>())).toList(),
        triggers: (j['triggers'] as List? ?? const [])
            .map((e) => AutoTrigger.fromJson((e as Map).cast<String, dynamic>()))
            .toList(),
        updatedAt: (j['updatedAt'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'enabled': enabled,
        'steps': steps.map((s) => s.toJson()).toList(),
        if (triggers.isNotEmpty) 'triggers': triggers.map((t) => t.toJson()).toList(),
        'updatedAt': updatedAt,
      };
}

class StepLog {
  final String stepId;
  final String label;

  /// ok | failed | skipped | branch
  final String status;
  final String? output;
  final String? error;

  const StepLog({required this.stepId, required this.label, required this.status, this.output, this.error});

  factory StepLog.fromJson(Map<String, dynamic> j) => StepLog(
        stepId: j['stepId'] as String,
        label: j['label'] as String,
        status: j['status'] as String,
        output: j['output'] as String?,
        error: j['error'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'stepId': stepId,
        'label': label,
        'status': status,
        if (output != null) 'output': output,
        if (error != null) 'error': error,
      };
}

class RunRecord {
  final String id;
  final String automationId;
  final int startedAt;
  final int endedAt;

  /// ok | failed
  final String status;
  final List<StepLog> logs;

  const RunRecord({
    required this.id,
    required this.automationId,
    required this.startedAt,
    required this.endedAt,
    required this.status,
    required this.logs,
  });

  factory RunRecord.fromJson(Map<String, dynamic> j) => RunRecord(
        id: j['id'] as String,
        automationId: j['automationId'] as String,
        startedAt: (j['startedAt'] as num).toInt(),
        endedAt: (j['endedAt'] as num).toInt(),
        status: j['status'] as String,
        logs: (j['logs'] as List).map((e) => StepLog.fromJson((e as Map).cast<String, dynamic>())).toList(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'automationId': automationId,
        'startedAt': startedAt,
        'endedAt': endedAt,
        'status': status,
        'logs': logs.map((l) => l.toJson()).toList(),
      };
}
