import 'package:shared_preferences/shared_preferences.dart';

/// Persistencia de la preferencia de idioma — mobile-i18n-proposal.md §4.
/// Mismo patrón/prefijo que el resto de la app (ProfileStore, UserNameStore).
class LocaleStore {
  static const _key = 'yggdrasil_pref_locale';

  static Future<String?> get() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_key);
  }

  static Future<void> set(String locale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, locale);
  }
}
