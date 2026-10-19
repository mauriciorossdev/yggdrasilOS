import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Config for the always-on Claude chat running on the Raspberry Pi
/// (rpi-command-center's term-bridge, reached over Tailscale via
/// `tailscale serve`, e.g. `https://shadow.<tailnet>.ts.net`). Independent from
/// GatewaySettings: the Pi is a different machine with its own api key.
class PiSettings {
  String baseUrl;
  String apiKey;

  PiSettings({required this.baseUrl, required this.apiKey});

  factory PiSettings.fromJson(Map<String, dynamic> json) => PiSettings(
        baseUrl: json['baseUrl']?.toString() ?? '',
        apiKey: json['apiKey']?.toString() ?? '',
      );

  Map<String, dynamic> toJson() => {'baseUrl': baseUrl, 'apiKey': apiKey};

  bool get isReady => baseUrl.isNotEmpty && apiKey.isNotEmpty;
}

class PiSettingsStore {
  // Same prefix convention as GatewaySettingsStore/ProfileStore.
  static const _prefPrefix = 'yggdrasil_pref_';
  static const _key = '${_prefPrefix}pi_settings';

  static Future<PiSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw != null && raw.isNotEmpty) {
      try {
        return PiSettings.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      } catch (_) {}
    }
    return PiSettings(baseUrl: '', apiKey: '');
  }

  static Future<void> save(PiSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(settings.toJson()));
  }
}
