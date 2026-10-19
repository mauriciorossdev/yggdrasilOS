import 'package:shared_preferences/shared_preferences.dart';

import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';

/// The Railway gateway ("hub") the phone learned from the desktop's QR:
/// `yggdrasil://hub?url=<https url>&key=<api key>`.
class HubLink {
  final String url;
  final String key;

  const HubLink(this.url, this.key);

  /// Parses the QR/deep-link payload; null for anything else.
  static HubLink? parse(String raw) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.scheme != 'yggdrasil' || uri.host != 'hub') return null;
    final url = (uri.queryParameters['url'] ?? '').trim();
    final key = (uri.queryParameters['key'] ?? '').trim();
    final parsed = Uri.tryParse(url);
    if (url.isEmpty || key.isEmpty || parsed == null || !(parsed.scheme == 'https' || parsed.scheme == 'http')) return null;
    return HubLink(url.replaceAll(RegExp(r'/+$'), ''), key);
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
  /// https gateway (the Railway one the user typed before the QR existed).
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

/// Saves the hub and makes sure there is a profile for the Railway gateway
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
    name: 'Asistente (Railway)',
    type: ConnectionProfileType.gateway,
    baseUrl: link.url,
  );
  profile.apiKey = link.key;
  await ProfileStore.upsert(profile);
  if (await ProfileStore.getActiveId() == null) await ProfileStore.setActiveId(profile.id);
  return profile;
}
