import 'package:app/gateway/gateway_settings.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/harness.dart';

Future<void> openSettings(WidgetTester tester) async {
  await openHome(tester);
  await openDrawer(tester);
  // The drawer's gear icon (no visible text).
  await pumpUntil(tester, findButton(s('settings.title')), reason: 'Ajustes en el menú lateral');
  await tapAndPump(tester, findButton(s('settings.title')));
  await pumpUntil(tester, find.text(s('settings.gateway')), reason: 'pantalla de Ajustes');
}

/// Every TextField's current text on screen.
List<String> fieldTexts(WidgetTester tester) =>
    tester.widgetList<TextField>(find.byType(TextField)).map((f) => f.controller?.text ?? '').toList();

void settingsFlow() {
  group('ajustes', () {
    e2eTest('Ajustes abre y lista sus secciones', (tester) async {
      await openSettings(tester);
      await shot('settings');
      for (final key in ['settings.gateway', 'settings.language', 'settings.theme']) {
        expect(find.text(s(key)), findsWidgets, reason: 'fila $key en Ajustes');
      }
      expect(tester.takeException(), isNull);
    });

    e2eTest('Ajustes > Gateway muestra la URL y la key guardadas', (tester) async {
      await openSettings(tester);
      await tapAndPump(tester, find.text(s('settings.gateway')));
      await pumpUntil(tester, find.text(s('editor.gatewayUrlLabel')), reason: 'pantalla Ajustes > Gateway');
      await shot('settings-gateway');
      expect(fieldTexts(tester), contains(E2E.gatewayUrl));
      expect(fieldTexts(tester), contains(E2E.apiKey));
    });

    e2eTest('Ajustes > Gateway guarda una URL nueva', (tester) async {
      await openSettings(tester);
      await tapAndPump(tester, find.text(s('settings.gateway')));
      await pumpUntil(tester, find.text(s('editor.gatewayUrlLabel')));
      final urlField = find.byWidgetPredicate((w) => w is TextField && w.controller?.text == E2E.gatewayUrl);
      expect(urlField, findsOneWidget);
      await tester.enterText(urlField, 'http://127.0.0.1:18799');
      await tapAndPump(tester, find.text(s('common.save')));
      await pumpFor(tester, const Duration(seconds: 1));
      final saved = await GatewaySettingsStore.load();
      expect(saved.baseUrl, 'http://127.0.0.1:18799');
    });
  });
}
