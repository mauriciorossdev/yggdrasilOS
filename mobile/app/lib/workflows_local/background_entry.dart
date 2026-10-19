import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'local_workflow_engine.dart';
import 'local_workflow_store.dart';

/// Body of the background engine entrypoint (BackgroundRunner.kt). Native says the
/// engine is up ("ready"), we get one automation payload, run it without any UI,
/// save the run, and report the status back.
void runAutomationBackground() {
  WidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.yggdrasil.app/automation_bg');
  channel.setMethodCallHandler((call) async {
    if (call.method != 'run') return null;
    final payload = jsonDecode(call.arguments as String) as Map<String, dynamic>;
    final id = payload['automationId'] as String;
    final trigger = (payload['trigger'] as Map).cast<String, dynamic>();
    final automations = (await LocalWorkflowStore.loadAll()).where((a) => a.id == id).toList();
    if (automations.isEmpty || !automations.first.enabled) return {'status': 'skipped'};
    final automation = automations.first;
    final run = await AutomationEngine(requestPermissions: false).run(
      automation,
      runId: DateTime.now().microsecondsSinceEpoch.toString(),
      trigger: trigger,
    );
    await LocalWorkflowStore.addRun(run);
    return {'status': run.status};
  });
  channel.invokeMethod<void>('ready');
}
