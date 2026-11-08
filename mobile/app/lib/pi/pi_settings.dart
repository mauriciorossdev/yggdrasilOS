import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

import 'tailscale_channel.dart';

/// Config for the always-on Claude chat on a remote host (e.g. a Raspberry Pi
/// reached over Tailscale via `tailscale serve`,
/// `https://<host>.<tailnet>.ts.net`). Independent from GatewaySettings: the
/// host is a different machine with its own api key. The chat entry point only
/// shows up while a host is configured (`isReady`).
class PiSettings {
  /// Tmux pane of the host's main chat when none is configured.
  static const defaultPaneId = 'claude-chat';

  String baseUrl;
  String apiKey;

  /// Label shown on the chat button and in the chat title. Empty = "Host".
  String name;

  /// Pane the main chat attaches to. Project chats use their own pane id.
  String paneId;

  /// Ask the Tailscale app to bring its VPN up before connecting. Off for hosts
  /// reachable without a tailnet.
  bool useTailscale;

  PiSettings({
    required this.baseUrl,
    required this.apiKey,
    this.name = '',
    this.paneId = defaultPaneId,
    this.useTailscale = true,
  });

  // Fields added after the first release default to what the Pi-only version
  // hard-coded, so an existing saved config keeps working untouched.
  factory PiSettings.fromJson(Map<String, dynamic> json) => PiSettings(
        baseUrl: json['baseUrl']?.toString() ?? '',
        apiKey: json['apiKey']?.toString() ?? '',
        name: json['name']?.toString() ?? '',
        paneId: (json['paneId']?.toString() ?? '').isEmpty ? defaultPaneId : json['paneId'].toString(),
        useTailscale: json['useTailscale'] is bool ? json['useTailscale'] as bool : true,
      );

  Map<String, dynamic> toJson() => {
        'baseUrl': baseUrl,
        'apiKey': apiKey,
        'name': name,
        'paneId': paneId,
        'useTailscale': useTailscale,
      };

  bool get isReady => baseUrl.isNotEmpty && apiKey.isNotEmpty;

  String get displayName => name.trim().isEmpty ? 'Host' : name.trim();

  /// Brings the network path to the host up (Tailscale) when configured to.
  /// Fire-and-forget like TailscaleChannel itself; callers retry on failure.
  Future<void> connectNetwork() async {
    if (useTailscale) await TailscaleChannel.connect();
  }
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

  /// Forgets the host entirely, which hides the chat button again.
  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
