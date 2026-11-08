import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:app/theme/ygg_theme.dart';

double _contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final (hi, lo) = la >= lb ? (la, lb) : (lb, la);
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await YggThemeController.instance.select(YggPalette.yggdrasil);
  });

  group('YggPalette', () {
    test('every palette has a unique id and byId falls back to the default', () {
      final ids = YggPalette.all.map((p) => p.id).toSet();
      expect(ids.length, YggPalette.all.length);
      expect(YggPalette.byId('daylight').id, 'daylight');
      expect(YggPalette.byId('nope').id, YggPalette.yggdrasil.id);
      expect(YggPalette.byId(null).id, YggPalette.yggdrasil.id);
    });

    test('text on the accent is readable in every theme', () {
      for (final p in YggPalette.all) {
        expect(_contrast(p.onAccent, p.accent), greaterThanOrEqualTo(4.5), reason: p.id);
      }
    });

    test('body text is readable on the background and on cards in every theme', () {
      for (final p in YggPalette.all) {
        expect(_contrast(p.text, p.bg), greaterThanOrEqualTo(7), reason: '${p.id} on bg');
        expect(_contrast(p.text, p.surface), greaterThanOrEqualTo(7), reason: '${p.id} on surface');
      }
    });

    test('derived colors move with the core colors (a new theme is four colors)', () {
      const custom = YggPalette(
        id: 'custom',
        name: 'Custom',
        brightness: Brightness.dark,
        bg: Color(0xFF101820),
        surface: Color(0xFF18242F),
        text: Color(0xFFE8EEF3),
        accent: Color(0xFF3FB6A8),
      );
      expect(custom.accentSoft, isNot(YggPalette.yggdrasil.accentSoft));
      expect(custom.border, isNot(YggPalette.yggdrasil.border));
      // border sits between the surface and the text, closer to the surface
      expect(_contrast(custom.border, custom.surface), lessThan(_contrast(custom.text, custom.surface)));
    });
  });

  group('YggThemeController', () {
    test('YggColors follows the active palette', () async {
      expect(YggColors.accent, YggPalette.yggdrasil.accent);
      await YggThemeController.instance.select(YggPalette.rooted);
      expect(YggColors.accent, YggPalette.rooted.accent);
      expect(YggColors.bg, YggPalette.rooted.bg);
    });

    test('notifies listeners once per real change', () async {
      var calls = 0;
      void listener() => calls++;
      YggThemeController.instance.addListener(listener);
      await YggThemeController.instance.select(YggPalette.daylight);
      await YggThemeController.instance.select(YggPalette.daylight);
      YggThemeController.instance.removeListener(listener);
      expect(calls, 1);
    });

    test('the choice is saved and restored', () async {
      await YggThemeController.instance.select(YggPalette.rooted);
      // Forget the in-memory choice, then load what was persisted.
      await YggThemeController.instance.select(YggPalette.yggdrasil);
      SharedPreferences.setMockInitialValues({'yggdrasil_pref_theme': 'daylight'});
      await YggThemeController.instance.load();
      expect(YggThemeController.instance.palette.id, 'daylight');
    });
  });

  test('buildYggTheme follows the palette brightness and accent', () {
    final dark = buildYggTheme(YggPalette.yggdrasil);
    final light = buildYggTheme(YggPalette.daylight);
    expect(dark.brightness, Brightness.dark);
    expect(light.brightness, Brightness.light);
    expect(light.colorScheme.primary, YggPalette.daylight.accent);
    expect(light.scaffoldBackgroundColor, YggPalette.daylight.bg);
  });
}
