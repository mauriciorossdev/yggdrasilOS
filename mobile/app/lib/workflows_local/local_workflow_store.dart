import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'local_workflow.dart';

/// Automations and their run history, as JSON in SharedPreferences (the app has
/// no file-storage dependency yet; design §3 said files — see the doc's note).
class LocalWorkflowStore {
  static const _automationsKey = 'yggdrasil_pref_automations';
  static const _runsKey = 'yggdrasil_pref_automation_runs';
  static const maxRunsPerAutomation = 20;

  static Future<List<Automation>> loadAll() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_automationsKey);
    if (raw == null || raw.isEmpty) return [];
    final list = (jsonDecode(raw) as List).map((e) => Automation.fromJson((e as Map).cast<String, dynamic>())).toList();
    list.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return list;
  }

  static Future<void> save(Automation automation) async {
    final all = await loadAll();
    final i = all.indexWhere((a) => a.id == automation.id);
    if (i >= 0) {
      all[i] = automation;
    } else {
      all.add(automation);
    }
    await _writeAutomations(all);
  }

  static Future<void> delete(String id) async {
    final all = (await loadAll())..removeWhere((a) => a.id == id);
    await _writeAutomations(all);
    final runs = await _readRuns();
    runs.remove(id);
    await _writeRuns(runs);
  }

  static Future<List<RunRecord>> runsFor(String automationId) async {
    final raw = (await _readRuns())[automationId] as List? ?? const <Object?>[];
    final runs = <RunRecord>[
      for (final e in raw) RunRecord.fromJson((e as Map).cast<String, dynamic>()),
    ];
    return runs.reversed.toList();
  }

  static Future<void> addRun(RunRecord run) async {
    final runs = await _readRuns();
    final list = (runs[run.automationId] as List?) ?? <Object?>[];
    list.add(run.toJson());
    runs[run.automationId] = list.length > maxRunsPerAutomation ? list.sublist(list.length - maxRunsPerAutomation) : list;
    await _writeRuns(runs);
  }

  static Future<void> _writeAutomations(List<Automation> all) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_automationsKey, jsonEncode(all.map((a) => a.toJson()).toList()));
  }

  static Future<Map<String, dynamic>> _readRuns() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_runsKey);
    if (raw == null || raw.isEmpty) return {};
    return (jsonDecode(raw) as Map).cast<String, dynamic>();
  }

  static Future<void> _writeRuns(Map<String, dynamic> runs) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_runsKey, jsonEncode(runs));
  }
}
