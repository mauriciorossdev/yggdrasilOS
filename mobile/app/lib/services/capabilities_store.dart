import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Per-device on/off state for individual phone_* tools —
/// capabilities-settings-design.md §1. One JSON-serialized key (same
/// pattern as ProfileStore, not the scalar UserNameStore/LocaleStore
/// pattern) so a tool never touched by the user needs no stored entry at
/// all — added later, a 9th tool just defaults to enabled with no
/// migration needed.
class CapabilitiesStore {
  static const _prefPrefix = 'yggdrasil_pref_';
  static const _key = '${_prefPrefix}capabilities';

  static Future<Map<String, dynamic>> _readAll() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return {};
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return {};
    }
  }

  /// Default true when the tool was never toggled — §2 of the UX doc:
  /// "default: todas en ON al instalar".
  static Future<bool> isEnabled(String toolName) async => (await _readAll())[toolName] as bool? ?? true;

  static Future<void> setEnabled(String toolName, bool enabled) async {
    final all = await _readAll();
    all[toolName] = enabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(all));
  }

  /// One read for the Settings screen instead of N separate isEnabled awaits.
  static Future<Map<String, bool>> allStates(List<String> toolNames) async {
    final raw = await _readAll();
    return {for (final name in toolNames) name: raw[name] as bool? ?? true};
  }
}
