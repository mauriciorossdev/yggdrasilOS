import 'dart:convert';

import 'package:app/pi/pi_settings.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _key = 'yggdrasil_pref_pi_settings';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('no saved host means not ready, so the home chat button stays hidden', () async {
    final s = await PiSettingsStore.load();
    expect(s.isReady, isFalse);
  });

  test('a config saved by the Pi-only version still loads with the old behaviour', () async {
    SharedPreferences.setMockInitialValues({
      _key: jsonEncode({'baseUrl': 'https://my-pi.example.ts.net', 'apiKey': 'k'}),
    });
    final s = await PiSettingsStore.load();
    expect(s.isReady, isTrue);
    expect(s.paneId, 'claude-chat');
    expect(s.useTailscale, isTrue);
    expect(s.displayName, 'Host');
  });

  test('new fields round-trip and a blank pane falls back to the default', () async {
    await PiSettingsStore.save(PiSettings(
      baseUrl: 'https://h',
      apiKey: 'k',
      name: '  Claude @ shadow ',
      paneId: 'other-pane',
      useTailscale: false,
    ));
    final s = await PiSettingsStore.load();
    expect(s.displayName, 'Claude @ shadow');
    expect(s.paneId, 'other-pane');
    expect(s.useTailscale, isFalse);

    SharedPreferences.setMockInitialValues({
      _key: jsonEncode({'baseUrl': 'https://h', 'apiKey': 'k', 'paneId': ''}),
    });
    expect((await PiSettingsStore.load()).paneId, 'claude-chat');
  });

  test('clear forgets the host', () async {
    await PiSettingsStore.save(PiSettings(baseUrl: 'https://h', apiKey: 'k'));
    await PiSettingsStore.clear();
    expect((await PiSettingsStore.load()).isReady, isFalse);
  });
}
