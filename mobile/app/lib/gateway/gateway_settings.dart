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
    // An empty seed is not saved: on a fresh install this runs before any
    // profile exists, and saving it would block every later seed for good.
    if (seeded.baseUrl.isNotEmpty) await save(seeded);
    return seeded;
  }

  /// Picking one of your computers (QR → Tus computadoras) is the explicit
  /// opt-in `_seedFromGatewayProfile` leaves to the user, so Proyectos follows
  /// that computer right away instead of asking for its address again.
  static Future<void> useComputer(String baseUrl, String? apiKey) =>
      save(GatewaySettings(enabled: true, baseUrl: baseUrl, apiKey: apiKey));

  /// A computer came back on a new address (its desktop restarted, so the port
  /// changed). Proyectos moves with it, but only if it was pointing at the old one.
  static Future<void> followMove(String? oldBaseUrl, String newBaseUrl, String? apiKey) async {
    if (oldBaseUrl == null || oldBaseUrl.isEmpty) return;
    final current = await load();
    if (current.baseUrl != oldBaseUrl) return;
    await save(GatewaySettings(enabled: current.enabled, baseUrl: newBaseUrl, apiKey: apiKey));
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
    // A computer found through the QR beats the link server itself (the
    // always-on assistant), which has no projects of its own to manage.
    final profile = matches.firstWhere((p) => p.isFromHub, orElse: () => matches.first);
    return GatewaySettings(enabled: false, baseUrl: profile.baseUrl!, apiKey: profile.apiKey);
  }
}
