import 'package:shared_preferences/shared_preferences.dart';

import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';

/// The link server ("hub") the phone learned from the desktop's QR:
/// `yggdrasil://hub?url=<https url>&key=<api key>`.
class HubLink {
  final String url;
  final String key;

  const HubLink(this.url, this.key);

  /// Parses the QR/deep-link payload; null for anything else, including a
  /// server this phone must not send its key to (see [isInsecurePayload]).
  /// `wss`/`ws` become `https`/`http`, the form the rest of the app expects.
  static HubLink? parse(String raw) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.scheme != 'yggdrasil' || uri.host != 'hub') return null;
    final url = (uri.queryParameters['url'] ?? '').trim();
    final key = (uri.queryParameters['key'] ?? '').trim();
    final parsed = Uri.tryParse(url);
    if (url.isEmpty || key.isEmpty || parsed == null || parsed.host.isEmpty) return null;
    final scheme = switch (parsed.scheme) {
      'https' || 'wss' => 'https',
      'http' || 'ws' => 'http',
      _ => null,
    };
    if (scheme == null || (scheme == 'http' && !isLocalHost(parsed.host))) return null;
    return HubLink(parsed.replace(scheme: scheme).toString().replaceAll(RegExp(r'/+$'), ''), key);
  }

  /// A complete link rejected only because it is unencrypted on a public host.
  static bool isInsecurePayload(String raw) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.scheme != 'yggdrasil' || uri.host != 'hub') return false;
    final parsed = Uri.tryParse((uri.queryParameters['url'] ?? '').trim());
    return parsed != null && parsed.host.isNotEmpty && (parsed.scheme == 'http' || parsed.scheme == 'ws') && !isLocalHost(parsed.host);
  }

  /// Only reachable from this network or tailnet, so unencrypted traffic
  /// doesn't cross the open internet. Same rule as the desktop's checkHubUrl
  /// (packages/app-desktop/src/main/phoneLinkCore.ts).
  static bool isLocalHost(String hostname) {
    final host = hostname.toLowerCase();
    if (host.contains(':')) return host == '::1' || RegExp(r'^(f[cd]|fe[89ab])').hasMatch(host);
    if (RegExp(r'^\d{1,3}(\.\d{1,3}){3}$').hasMatch(host)) {
      final parts = host.split('.').map(int.parse).toList();
      final a = parts[0], b = parts[1];
      return a == 127 ||
          a == 10 ||
          (a == 192 && b == 168) ||
          (a == 172 && b >= 16 && b <= 31) ||
          (a == 169 && b == 254) ||
          (a == 100 && b >= 64 && b <= 127);
    }
    return !host.contains('.') || RegExp(r'\.(localhost|local|lan|home\.arpa|ts\.net)$').hasMatch(host);
  }
}

String _norm(String? url) => (url ?? '').trim().replaceAll(RegExp(r'/+$'), '').toLowerCase();

class HubStore {
  static const _kUrl = 'yggdrasil_pref_hub_url';
  static const _kKey = 'yggdrasil_pref_hub_key';

  static Future<void> save(HubLink link) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kUrl, link.url);
    await p.setString(_kKey, link.key);
  }

  static Future<HubLink?> saved() async {
    final p = await SharedPreferences.getInstance();
    final url = p.getString(_kUrl);
    final key = p.getString(_kKey);
    return (url == null || key == null) ? null : HubLink(url, key);
  }

  /// The saved hub or, failing that, the active profile when it points at an
  /// https gateway (the one the user typed before the QR existed).
  static Future<HubLink?> current() async {
    final saved = await HubStore.saved();
    if (saved != null) return saved;
    final active = await ProfileStore.getActive();
    final url = active?.baseUrl ?? '';
    if (active?.type == ConnectionProfileType.gateway && url.startsWith('https://') && (active?.apiKey ?? '').isNotEmpty) {
      return HubLink(url, active!.apiKey!);
    }
    return null;
  }
}

/// Saves the hub and makes sure there is a profile for the link server
/// itself (the assistant). Becomes the active profile only if nothing is active yet.
Future<ConnectionProfile> applyHubLink(HubLink link) async {
  await HubStore.save(link);
  final profiles = await ProfileStore.list();
  ConnectionProfile? profile;
  for (final p in profiles) {
    if (p.type == ConnectionProfileType.gateway && _norm(p.baseUrl) == _norm(link.url)) profile = p;
  }
  profile ??= ConnectionProfile(
    id: 'hub-${DateTime.now().millisecondsSinceEpoch}',
    name: 'Asistente remoto',
    type: ConnectionProfileType.gateway,
    baseUrl: link.url,
  );
  profile.apiKey = link.key;
  await ProfileStore.upsert(profile);
  if (await ProfileStore.getActiveId() == null) await ProfileStore.setActiveId(profile.id);
  return profile;
}
