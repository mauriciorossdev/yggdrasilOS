import 'package:flutter/material.dart';

import 'ygg_palette.dart';
import 'ygg_theme_controller.dart';

export 'ygg_palette.dart';
export 'ygg_theme_controller.dart';

/// Color tokens of the *active* theme. Every member reads the current palette,
/// so none of them is a compile-time constant: a widget using them must not be
/// `const`, and it picks up a theme change on its next build (the app rebuilds
/// everything when the theme switches — see main.dart).
class YggColors {
  YggColors._();

  static YggPalette get _p => YggThemeController.instance.palette;

  static Color get bg => _p.bg;
  static Color get surface => _p.surface;
  static Color get surface2 => _p.surface2;
  static Color get sidebar => _p.sidebar;
  static Color get border => _p.border;
  static Color get borderStrong => _p.borderStrong;

  static Color get accent => _p.accent;
  static Color get accentHover => _p.accentHover;
  static Color get accentSoft => _p.accentSoft;

  /// Text and icons on top of [accent].
  static Color get onAccent => _p.onAccent;

  static Color get text => _p.text;
  static Color get text2 => _p.text2;
  static Color get textMuted => _p.textMuted;
  static Color get textFaint => _p.textFaint;
  static Color get textFainter => _p.textFainter;

  static Color get hairline => _p.hairline;
  static Color get hairlineStrong => _p.hairlineStrong;
  static Color get cardFill => _p.cardFill;
  static Color get cardFillHigh => _p.cardFillHigh;
  static Color get cardFillHighest => _p.cardFillHighest;

  static Color get working => _p.working;
  static Color get workingSoft => _p.workingSoft;
  static Color get checking => _p.checking;
  static Color get checkingSoft => _p.checkingSoft;
  static Color get ready => _p.ready;
  static Color get readySoft => _p.readySoft;
  static Color get danger => _p.danger;
  static Color get dangerSoft => _p.dangerSoft;

  /// Kept for existing call sites; same as [danger].
  static Color get errorRed => _p.danger;
}

/// Font families bundled in assets/fonts (same trio as the desktop app).
class YggFonts {
  YggFonts._();

  static const sans = 'Inter';
  static const serif = 'SourceSerif4';
  static const mono = 'JetBrainsMono';
}

/// Corner radii, matching the desktop's --ygg-radius-* (6 / 10 / 14).
class YggRadius {
  YggRadius._();

  static const sm = 6.0;
  static const md = 10.0;
  static const lg = 14.0;
  static const pill = 999.0;
}

ThemeData buildYggTheme([YggPalette? palette]) {
  final p = palette ?? YggThemeController.instance.palette;
  final scheme = ColorScheme(
    brightness: p.brightness,
    primary: p.accent,
    onPrimary: p.onAccent,
    secondary: p.accent,
    onSecondary: p.onAccent,
    error: p.danger,
    onError: p.isDark ? p.text : Colors.white,
    surface: p.surface,
    onSurface: p.text,
    // Translucent tints on purpose (card fills over an opaque bg) — which is why the
    // dialog/sheet/popup themes below pin an opaque color instead of inheriting these.
    surfaceContainerHigh: p.cardFillHigh,
    surfaceContainerHighest: p.cardFillHighest,
    primaryContainer: p.text,
    onPrimaryContainer: p.surface,
    outline: p.hairlineStrong,
  );

  final base = ThemeData(
    useMaterial3: true,
    brightness: p.brightness,
    colorScheme: scheme,
    fontFamily: YggFonts.sans,
    scaffoldBackgroundColor: p.bg,
    dividerColor: p.hairline,
    iconTheme: IconThemeData(color: p.text),
  );

  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: p.text, displayColor: p.text).copyWith(
          bodySmall: base.textTheme.bodySmall?.copyWith(color: p.textMuted),
        ),
    appBarTheme: AppBarTheme(
      backgroundColor: p.bg,
      foregroundColor: p.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: TextStyle(fontFamily: YggFonts.serif, fontSize: 24, color: p.text),
    ),
    drawerTheme: DrawerThemeData(backgroundColor: p.surface),
    dialogTheme: DialogThemeData(
      backgroundColor: p.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(YggRadius.lg + 4)),
    ),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: p.surface),
    popupMenuTheme: PopupMenuThemeData(color: p.surface),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.surface2,
      contentTextStyle: TextStyle(color: p.text),
      behavior: SnackBarBehavior.floating,
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: p.accent,
      foregroundColor: p.onAccent,
      shape: const StadiumBorder(),
      extendedTextStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
    ),
    textSelectionTheme: TextSelectionThemeData(cursorColor: p.accent, selectionHandleColor: p.accent),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.accent),
  );
}
