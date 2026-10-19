import 'package:flutter/material.dart';

/// Color/type tokens ported 1:1 from the "Yggdrasil Mobile Prototype" Claude
/// Design artboard (Main.dc.html) — this is the one visual identity for the
/// app now, applied the same regardless of connection profile (gateway vs
/// direct). Instrument Serif/Figtree/IBM Plex Mono aren't bundled as app
/// fonts (no new font dependency for this), so serif/default-sans/monospace
/// fallbacks stand in for them.
class YggColors {
  YggColors._();

  static const bg = Color(0xFF003833);
  static const surface = Color(0xFF00302B);
  static const accent = Color(0xFFC9A54E);
  static const accentHover = Color(0xFFE0BE6B);
  static const text = Color(0xFFF4EFE6);
  static const errorRed = Color(0xFFC1633B);

  static const textMuted = Color.fromRGBO(244, 239, 230, 0.6);
  static const textFaint = Color.fromRGBO(244, 239, 230, 0.45);
  static const textFainter = Color.fromRGBO(244, 239, 230, 0.4);
  static const hairline = Color.fromRGBO(244, 239, 230, 0.12);
  static const hairlineStrong = Color.fromRGBO(244, 239, 230, 0.2);
  static const cardFill = Color.fromRGBO(244, 239, 230, 0.05);
  static const cardFillHigh = Color.fromRGBO(244, 239, 230, 0.07);
  static const cardFillHighest = Color.fromRGBO(244, 239, 230, 0.09);
}

ThemeData buildYggTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.dark,
    primary: YggColors.accent,
    onPrimary: YggColors.surface,
    secondary: YggColors.accent,
    onSecondary: YggColors.surface,
    error: YggColors.errorRed,
    onError: YggColors.text,
    surface: YggColors.surface,
    onSurface: YggColors.text,
    surfaceContainerHigh: YggColors.cardFillHigh,
    surfaceContainerHighest: YggColors.cardFillHighest,
    primaryContainer: YggColors.text,
    onPrimaryContainer: YggColors.surface,
    outline: YggColors.hairlineStrong,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: YggColors.bg,
    dividerColor: YggColors.hairline,
    textTheme: const TextTheme(
      bodyLarge: TextStyle(color: YggColors.text),
      bodyMedium: TextStyle(color: YggColors.text),
      bodySmall: TextStyle(color: YggColors.textMuted),
      titleLarge: TextStyle(color: YggColors.text),
      titleMedium: TextStyle(color: YggColors.text),
    ),
    iconTheme: const IconThemeData(color: YggColors.text),
    appBarTheme: const AppBarTheme(
      backgroundColor: YggColors.bg,
      foregroundColor: YggColors.text,
      elevation: 0,
    ),
    drawerTheme: const DrawerThemeData(backgroundColor: YggColors.surface),
    // Without these, AlertDialog/BottomSheet/PopupMenu fall back to
    // colorScheme.surfaceContainerHigh/Highest for their own background —
    // here those are translucent rgba overlays (meant as tint layers on top
    // of an already-opaque dark bg, e.g. card fills), not real surface
    // colors, so dialogs rendered see-through to whatever was behind them.
    dialogTheme: const DialogThemeData(backgroundColor: YggColors.surface),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: YggColors.surface),
    popupMenuTheme: const PopupMenuThemeData(color: YggColors.surface),
  );
}
