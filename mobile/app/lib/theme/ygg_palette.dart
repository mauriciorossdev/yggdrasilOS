import 'package:flutter/material.dart';

/// A selectable theme. Same model as the desktop's tokens.css: four core colors
/// (background, surface, text, accent) plus a brightness, and everything else —
/// borders, muted text, accent tints — derived from them, so a new theme is four
/// colors and the rest of the app re-tones with it.
@immutable
class YggPalette {
  final String id;

  /// Shown in the theme picker. Theme names are proper nouns, not translated.
  final String name;
  final Brightness brightness;
  final Color bg;
  final Color surface;
  final Color text;
  final Color accent;

  const YggPalette({
    required this.id,
    required this.name,
    required this.brightness,
    required this.bg,
    required this.surface,
    required this.text,
    required this.accent,
  });

  /// CSS `color-mix(in srgb, a pa%, b)`.
  static Color _mix(Color a, double pa, Color b) => Color.lerp(b, a, pa)!;

  bool get isDark => brightness == Brightness.dark;

  // Surfaces.
  Color get sidebar => _mix(bg, 0.78, isDark ? Colors.black : Colors.white);
  Color get surface2 => _mix(surface, 0.95, text);
  Color get border => _mix(surface, 0.90, text);
  Color get borderStrong => _mix(surface, 0.82, text);

  // Text. The alpha ramps stay translucent so they read on any surface they sit on.
  Color get text2 => _mix(text, 0.85, bg);
  Color get textMuted => text.withValues(alpha: 0.6);
  Color get textFaint => text.withValues(alpha: 0.45);
  Color get textFainter => text.withValues(alpha: 0.4);

  // Overlays that tint whatever is underneath (cards, fields, hairlines).
  Color get hairline => text.withValues(alpha: 0.12);
  Color get hairlineStrong => text.withValues(alpha: 0.2);
  Color get cardFill => text.withValues(alpha: 0.05);
  Color get cardFillHigh => text.withValues(alpha: 0.07);
  Color get cardFillHighest => text.withValues(alpha: 0.09);

  // Accent.
  Color get accentHover => _mix(accent, 0.85, Colors.white);
  Color get accentSoft => _mix(accent, 0.18, bg);

  /// Text/icons drawn on top of [accent]: whichever of near-black or white contrasts more.
  Color get onAccent {
    const dark = Color(0xFF1A1918);
    final accentLum = accent.computeLuminance();
    final withDark = (accentLum + 0.05) / (dark.computeLuminance() + 0.05);
    final withWhite = 1.05 / (accentLum + 0.05);
    return withDark >= withWhite ? dark : Colors.white;
  }

  // Status colors (working / checking / ready / danger), each with a soft fill for chips.
  Color get working => isDark ? const Color(0xFFF0C36D) : const Color(0xFF8A5A00);
  Color get workingSoft => isDark ? const Color(0xFF3D3220) : const Color(0xFFFBEFD2);
  Color get checking => isDark ? const Color(0xFF9EC1F5) : const Color(0xFF1F5AA6);
  Color get checkingSoft => isDark ? const Color(0xFF22304A) : const Color(0xFFDCE8FA);
  Color get ready => isDark ? const Color(0xFF8FD19E) : const Color(0xFF1E7A3A);
  Color get readySoft => isDark ? const Color(0xFF1F3524) : const Color(0xFFDDF1E2);
  Color get danger => isDark ? const Color(0xFFE0715C) : const Color(0xFFB3402B);
  Color get dangerSoft => isDark ? const Color(0xFF3D2220) : const Color(0xFFF8DFDA);

  /// Desktop's look: warm graphite with a terracotta accent.
  static const yggdrasil = YggPalette(
    id: 'yggdrasil',
    name: 'Yggdrasil',
    brightness: Brightness.dark,
    bg: Color(0xFF1A1918),
    surface: Color(0xFF262523),
    text: Color(0xFFF1EFE7),
    accent: Color(0xFFD97757),
  );

  /// The mobile app's original deep green and gold.
  static const rooted = YggPalette(
    id: 'rooted',
    name: 'Rooted',
    brightness: Brightness.dark,
    bg: Color(0xFF003833),
    surface: Color(0xFF00302B),
    text: Color(0xFFF4EFE6),
    accent: Color(0xFFC9A54E),
  );

  static const daylight = YggPalette(
    id: 'daylight',
    name: 'Daylight',
    brightness: Brightness.light,
    bg: Color(0xFFFAF9F5),
    surface: Color(0xFFFFFFFF),
    text: Color(0xFF1F1E1D),
    accent: Color(0xFFC2562F),
  );

  static const all = <YggPalette>[yggdrasil, rooted, daylight];

  static YggPalette byId(String? id) => all.firstWhere((p) => p.id == id, orElse: () => yggdrasil);
}
