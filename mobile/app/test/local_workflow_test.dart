import 'package:app/workflows_local/local_expressions.dart';
import 'package:app/workflows_local/local_workflow.dart';
import 'package:app/workflows_local/local_workflow_engine.dart';
import 'package:flutter_test/flutter_test.dart';

Step cap(String id, String tool, {Map<String, dynamic> args = const {}, String? saveAs, String onError = 'stop'}) =>
    Step(id: id, kind: StepKind.capability, capability: tool, args: args, saveAs: saveAs, onError: onError);

Automation auto(List<Step> steps) => Automation(id: 'a1', name: 'x', steps: steps, updatedAt: 0);

void main() {
  test('single template keeps the raw type, mixed template becomes text', () {
    final ctx = {'steps': {'bat': {'batteryPercent': 42, 'charging': true}}};
    expect(resolveValue('{{steps.bat.batteryPercent}}', ctx), 42);
    expect(resolveValue('bat={{steps.bat.batteryPercent}}%', ctx), 'bat=42%');
    expect(resolveValue('{{steps.nope.x}}', ctx), isNull);
  });

  test('list indexes resolve', () {
    final ctx = {'steps': {'f': {'files': [{'name': 'a.pdf'}]}}};
    expect(resolveValue('{{steps.f.files.0.name}}', ctx), 'a.pdf');
  });

  test('conditions: numeric compare, eq on strings, contains, exists', () {
    final ctx = {'steps': {'bat': {'batteryPercent': 15, 'network': 'wifi'}}};
    expect(evaluateCondition(const Condition(left: '{{steps.bat.batteryPercent}}', op: 'lt', right: '20'), ctx), isTrue);
    expect(evaluateCondition(const Condition(left: '{{steps.bat.batteryPercent}}', op: 'gt', right: '20'), ctx), isFalse);
    expect(evaluateCondition(const Condition(left: '{{steps.bat.network}}', op: 'eq', right: 'wifi'), ctx), isTrue);
    expect(evaluateCondition(const Condition(left: '{{steps.bat.network}}', op: 'contains', right: 'fi'), ctx), isTrue);
    expect(evaluateCondition(const Condition(left: '{{steps.bat.missing}}', op: 'exists'), ctx), isFalse);
  });

  test('capability output is saved and used by a later step', () async {
    final calls = <String, Map<String, dynamic>>{};
    final engine = AutomationEngine(runCapability: (name, args) async {
      calls[name] = args;
      if (name == 'phone_device_state') return {'batteryPercent': 10};
      return {'ok': true};
    });
    final steps = [
      cap('s1', 'phone_device_state', saveAs: 'bat'),
      Step(
        id: 'if1',
        kind: StepKind.ifCondition,
        condition: const Condition(left: '{{steps.bat.batteryPercent}}', op: 'lt', right: '20'),
        thenSteps: [cap('s2', 'phone_show_notification', args: {'body': 'Batería {{steps.bat.batteryPercent}}%'})],
        elseSteps: [cap('s3', 'phone_flashlight', args: {'on': true})],
      ),
    ];
    final run = await engine.run(auto(steps), runId: 'r1');
    expect(run.status, 'ok');
    expect(calls.containsKey('phone_show_notification'), isTrue);
    expect(calls['phone_show_notification']!['body'], 'Batería 10%');
    expect(calls.containsKey('phone_flashlight'), isFalse);
    expect(run.logs.map((l) => l.status), ['ok', 'branch', 'ok']);
  });

  test('a failing step stops the run by default', () async {
    var ran = false;
    final engine = AutomationEngine(runCapability: (name, args) async {
      if (name == 'boom') throw StateError('permission_denied');
      ran = true;
      return {};
    });
    final run = await engine.run(auto([cap('a', 'boom'), cap('b', 'phone_flashlight')]), runId: 'r2');
    expect(run.status, 'failed');
    expect(run.logs.single.error, 'permission_denied');
    expect(ran, isFalse);
  });

  test('onError continue keeps going after a failure', () async {
    final engine = AutomationEngine(runCapability: (name, args) async {
      if (name == 'boom') throw StateError('no_handler');
      return {'ok': true};
    });
    final run = await engine.run(auto([cap('a', 'boom', onError: 'continue'), cap('b', 'phone_flashlight')]), runId: 'r3');
    expect(run.status, 'ok');
    expect(run.logs.map((l) => l.status), ['failed', 'ok']);
  });

  test('json round-trip keeps nested branches', () {
    final a = auto([
      Step(
        id: 'if',
        kind: StepKind.ifCondition,
        condition: const Condition(left: '{{now}}', op: 'exists'),
        thenSteps: [cap('t', 'phone_flashlight', args: {'on': false})],
      ),
      Step(id: 'd', kind: StepKind.delay, seconds: 5),
    ]);
    final back = Automation.fromJson(a.toJson());
    expect(back.steps[0].thenSteps.single.capability, 'phone_flashlight');
    expect(back.steps[1].seconds, 5);
  });
}
