import 'dart:convert';

import 'package:flutter/services.dart';

import 'local_workflow.dart';
import 'local_workflow_store.dart';

/// Sends every enabled automation's triggers to the native side (automation_triggers
/// channel, AutomationService). Call after any change to automations and on app start.
class TriggerArmer {
  static const _channel = MethodChannel('com.yggdrasil.app/automation_triggers');

  static List<Map<String, dynamic>> specsFor(List<Automation> automations) => [
        for (final a in automations)
          if (a.enabled)
            for (final t in a.triggers)
              {'automationId': a.id, 'triggerId': t.id, 'type': t.type.name, 'params': t.params},
      ];

  static Future<void> rearm() async {
    final automations = await LocalWorkflowStore.loadAll();
    await _channel.invokeMethod<void>('arm', jsonEncode(specsFor(automations)));
  }
}
