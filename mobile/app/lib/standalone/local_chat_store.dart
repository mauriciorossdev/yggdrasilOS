import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

import 'local_chat.dart';

/// SharedPreferences-backed, same rationale as ProfileStore (no new storage
/// dependency for what's a lightweight, per-device, occasional dataset —
/// revisit with sqflite/Hive if standalone chats end up large/numerous).
class LocalChatStore {
  static const _key = 'yggdrasil_pref_local_chats';

  static Future<List<LocalChat>> _all() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw) as List<dynamic>;
      return decoded.map((e) => LocalChat.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> _saveAll(List<LocalChat> chats) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(chats.map((c) => c.toJson()).toList()));
  }

  /// §7.3: chat list only ever shows chats for the active profile, never a
  /// mixed view — including never mixing two different "direct" profiles.
  static Future<List<LocalChat>> listForProfile(String profileId) async {
    final chats = await _all();
    final filtered = chats.where((c) => c.profileId == profileId).toList();
    filtered.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return filtered;
  }

  static Future<LocalChat?> get(String id) async {
    final chats = await _all();
    final match = chats.where((c) => c.id == id).toList();
    return match.isEmpty ? null : match.first;
  }

  static Future<void> upsert(LocalChat chat) async {
    final chats = await _all();
    final index = chats.indexWhere((c) => c.id == chat.id);
    chat.updatedAt = DateTime.now().millisecondsSinceEpoch;
    if (index >= 0) {
      chats[index] = chat;
    } else {
      chats.add(chat);
    }
    await _saveAll(chats);
  }

  static Future<void> delete(String id) async {
    final chats = await _all();
    chats.removeWhere((c) => c.id == id);
    await _saveAll(chats);
  }
}
