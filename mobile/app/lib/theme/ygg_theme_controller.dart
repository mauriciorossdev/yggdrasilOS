import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'ygg_palette.dart';

/// The active theme. [YggColors] reads [palette] on every access, so changing it
/// here and notifying is all a theme switch takes. Persisted with the same
/// `yggdrasil_pref_*` prefix as the locale (LocaleStore) and the rest of the app.
class YggThemeController extends ChangeNotifier {
  YggThemeController._();

  static final YggThemeController instance = YggThemeController._();
  static const _key = 'yggdrasil_pref_theme';

  YggPalette _palette = YggPalette.yggdrasil;
  YggPalette get palette => _palette;

  /// Applies the saved theme, if any. Call once at startup, before runApp.
  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_key);
      if (saved != null) _palette = YggPalette.byId(saved);
    } catch (_) {
      // Unreadable preferences just leave the default theme.
    }
  }

  Future<void> select(YggPalette palette) async {
    if (palette.id == _palette.id) return;
    _palette = palette;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, palette.id);
    } catch (_) {
      // The switch already happened; only its persistence failed.
    }
  }
}
