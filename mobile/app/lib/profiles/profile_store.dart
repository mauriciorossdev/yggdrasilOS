import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

import 'connection_profile.dart';

/// Persistence + migration per remote-access-analysis.md §7.1 — SharedPreferences,
/// same _prefPrefix convention yggdrasil_client.dart already uses (that
/// constant is private there, so it's duplicated here verbatim — it's a
/// literal string, not a moving target, keep them in sync if it ever changes).
class ProfileStore {
  static const _prefPrefix = 'yggdrasil_pref_';
  static const _profilesKey = '${_prefPrefix}connection_profiles';
  static const _activeIdKey = '${_prefPrefix}active_profile_id';

  // Legacy single baseUrl key from before profiles existed
  // (yggdrasil_client.dart's _baseUrlKey) — read only for one-time migration.
  static const _legacyBaseUrlKey = '${_prefPrefix}base_url';

  static Future<List<ConnectionProfile>> list() async {
    await _migrateLegacyBaseUrlIfNeeded();
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_profilesKey);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw) as List<dynamic>;
      return decoded.map((e) => ConnectionProfile.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }

  // §7.1 migration: a saved legacy baseUrl (and no profiles yet) becomes a
  // single "gateway" profile named "Mi gateway", marked active. Runs lazily
  // on first list() rather than at app startup so every entry point (chat
  // list, profiles screen) gets it without main.dart needing to know about
  // profiles at all.
  static Future<void> _migrateLegacyBaseUrlIfNeeded() async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getString(_profilesKey) != null) return;
    final legacyBaseUrl = prefs.getString(_legacyBaseUrlKey);
    if (legacyBaseUrl == null || legacyBaseUrl.isEmpty) return;

    final profile = ConnectionProfile(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      name: 'Mi gateway',
      type: ConnectionProfileType.gateway,
      baseUrl: legacyBaseUrl,
      apiKey: '',
    );
    await prefs.setString(_profilesKey, jsonEncode([profile.toJson()]));
    await prefs.setString(_activeIdKey, profile.id);
  }

  static Future<void> _saveAll(List<ConnectionProfile> profiles) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_profilesKey, jsonEncode(profiles.map((p) => p.toJson()).toList()));
  }

  static Future<void> upsert(ConnectionProfile profile) async {
    final profiles = await list();
    final index = profiles.indexWhere((p) => p.id == profile.id);
    if (index >= 0) {
      profiles[index] = profile;
    } else {
      profiles.add(profile);
    }
    await _saveAll(profiles);
  }

  static Future<void> delete(String id) async {
    final profiles = await list();
    profiles.removeWhere((p) => p.id == id);
    await _saveAll(profiles);
    if (await getActiveId() == id) await setActiveId(null);
  }

  static Future<String?> getActiveId() async {
    await _migrateLegacyBaseUrlIfNeeded();
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_activeIdKey);
  }

  static Future<void> setActiveId(String? id) async {
    final prefs = await SharedPreferences.getInstance();
    if (id == null) {
      await prefs.remove(_activeIdKey);
    } else {
      await prefs.setString(_activeIdKey, id);
    }
    if (id != null) {
      final profiles = await list();
      final match = profiles.where((p) => p.id == id).toList();
      if (match.isNotEmpty) {
        match.first.lastUsedAt = DateTime.now().millisecondsSinceEpoch;
        await _saveAll(profiles);
      }
    }
  }

  /// Convenience for screens that need the active profile object, not just
  /// its id (e.g. ChatListScreen branching gateway vs. direct — §7.3).
  static Future<ConnectionProfile?> getActive() async {
    final id = await getActiveId();
    if (id == null) return null;
    final profiles = await list();
    final match = profiles.where((p) => p.id == id).toList();
    return match.isEmpty ? null : match.first;
  }
}
