import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';

/// Config for gateway-backed "manage the computer" features (Proyectos and
/// whatever follows it) — deliberately independent from ConnectionProfile/
/// ProfileStore, which only governs the chat connection. A `direct`-mode
/// chat profile has no gateway at all; these features must keep working
/// regardless of which profile is active for chat.
class GatewaySettings {
  bool enabled;
  String baseUrl;
  String? apiKey;

  GatewaySettings({required this.enabled, required this.baseUrl, this.apiKey});

  factory GatewaySettings.fromJson(Map<String, dynamic> json) => GatewaySettings(
        enabled: json['enabled'] == true,
        baseUrl: json['baseUrl']?.toString() ?? '',
        apiKey: json['apiKey']?.toString(),
      );

  Map<String, dynamic> toJson() => {
        'enabled': enabled,
        'baseUrl': baseUrl,
        if (apiKey != null) 'apiKey': apiKey,
      };

  bool get isReady => enabled && baseUrl.isNotEmpty;
}

class GatewaySettingsStore {
  // Same convention ProfileStore uses (its own comment notes this constant
  // is duplicated verbatim across files since it's a literal, not a moving
  // target).
  static const _prefPrefix = 'yggdrasil_pref_';
  static const _key = '${_prefPrefix}gateway_settings';

  static Future<GatewaySettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw != null && raw.isNotEmpty) {
      try {
        return GatewaySettings.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      } catch (_) {
        // fall through to the one-time seed below
      }
    }
    final seeded = await _seedFromGatewayProfile();
    await save(seeded);
    return seeded;
  }

  static Future<void> save(GatewaySettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(settings.toJson()));
  }

  // Convenience for users who already have a `gateway`-type ConnectionProfile
  // from before this setting existed — pre-fills the same URL instead of
  // asking them to retype it, but leaves it disabled: activating a network
  // feature is an explicit opt-in, never inferred from an unrelated setting.
  static Future<GatewaySettings> _seedFromGatewayProfile() async {
    final profiles = await ProfileStore.list();
    final matches = profiles.where(
      (p) => p.type == ConnectionProfileType.gateway && (p.baseUrl?.isNotEmpty ?? false),
    );
    if (matches.isEmpty) return GatewaySettings(enabled: false, baseUrl: '');
    final profile = matches.first;
    return GatewaySettings(enabled: false, baseUrl: profile.baseUrl!, apiKey: profile.apiKey);
  }
}
