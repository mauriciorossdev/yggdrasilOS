import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Config for the Termux "Proyectos Locales" companion (mobile/termux/companion.js)
/// — deliberately independent from GatewaySettings/ConnectionProfile, which
/// point at a *remote* desktop's gateway. This one always points at
/// 127.0.0.1 on the phone itself; see notes/yggdrasil-mobile/
/// local-projects-termux-design.md for why local projects need their own
/// companion process instead of reusing the gateway or SAF.
class LocalCompanionSettings {
  bool enabled;
  String baseUrl;
  String? token;

  LocalCompanionSettings({required this.enabled, required this.baseUrl, this.token});

  factory LocalCompanionSettings.fromJson(Map<String, dynamic> json) => LocalCompanionSettings(
        enabled: json['enabled'] == true,
        baseUrl: json['baseUrl']?.toString() ?? 'http://127.0.0.1:8765',
        token: json['token']?.toString(),
      );

  Map<String, dynamic> toJson() => {
        'enabled': enabled,
        'baseUrl': baseUrl,
        if (token != null) 'token': token,
      };

  bool get isReady => enabled && baseUrl.isNotEmpty && (token?.isNotEmpty ?? false);
}

class LocalCompanionSettingsStore {
  // Same convention as GatewaySettingsStore/ProfileStore — a literal, not a
  // moving target, duplicated verbatim across those files' own comments.
  static const _prefPrefix = 'yggdrasil_pref_';
  static const _key = '${_prefPrefix}local_companion_settings';

  static Future<LocalCompanionSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw != null && raw.isNotEmpty) {
      try {
        return LocalCompanionSettings.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      } catch (_) {
        // fall through to the default below
      }
    }
    return LocalCompanionSettings(enabled: false, baseUrl: 'http://127.0.0.1:8765');
  }

  static Future<void> save(LocalCompanionSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(settings.toJson()));
  }
}
