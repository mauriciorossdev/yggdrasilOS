import 'package:shared_preferences/shared_preferences.dart';

/// User identity — deliberately separate from ConnectionProfile. A
/// connection profile is "how to reach a backend" (gateway URL/API key, or
/// provider+model), technical, can be plural, named however ("Mi PC de
/// casa"). This is "who's being greeted" — one value, independent of which
/// profile is active. Confirmed with UX: never derive this from a profile's
/// name (that was a conflation bug — the home greeting was showing the
/// active profile's name, e.g. "claude", as if it were the person's name).
class UserNameStore {
  static const _key = 'yggdrasil_pref_user_name';

  static Future<String?> get() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_key);
  }

  static Future<void> set(String name) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, name);
  }
}
