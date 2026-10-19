import 'package:app/workflows_local/auto_trigger.dart';
import 'package:app/workflows_local/local_workflow.dart';
import 'package:app/workflows_local/trigger_arming.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('triggers survive a JSON round-trip', () {
    final a = Automation(
      id: 'a',
      name: 'x',
      updatedAt: 1,
      triggers: const [
        AutoTrigger(id: 't1', type: TriggerType.schedule, params: {'time': '09:30'}),
        AutoTrigger(id: 't2', type: TriggerType.battery, params: {'op': 'below', 'percent': 20}),
        AutoTrigger(id: 't3', type: TriggerType.geofence, params: {'lat': -34.6, 'lng': -58.4, 'radius': 200.0, 'on': 'enter'}),
      ],
    );
    final back = Automation.fromJson(a.toJson());
    expect(back.triggers.map((t) => t.type), [TriggerType.schedule, TriggerType.battery, TriggerType.geofence]);
    expect(back.triggers[1].params['percent'], 20);
  });

  test('only enabled automations are armed, with their triggers', () {
    final on = Automation(id: 'on', name: 'on', updatedAt: 1, triggers: const [AutoTrigger(id: 't1', type: TriggerType.boot)]);
    final off = Automation(id: 'off', name: 'off', enabled: false, updatedAt: 1, triggers: const [AutoTrigger(id: 't2', type: TriggerType.boot)]);
    final specs = TriggerArmer.specsFor([on, off]);
    expect(specs, [
      {'automationId': 'on', 'triggerId': 't1', 'type': 'boot', 'params': <String, dynamic>{}},
    ]);
  });

  test('labels describe each trigger', () {
    expect(const AutoTrigger(id: 'x', type: TriggerType.schedule, params: {'time': '07:05'}).label, 'Horario 07:05');
    expect(const AutoTrigger(id: 'x', type: TriggerType.battery, params: {'op': 'charging'}).label, 'Al conectar el cargador');
  });
}
