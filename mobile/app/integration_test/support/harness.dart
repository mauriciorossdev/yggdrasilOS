// Shared plumbing for the E2E suite (run through scripts/mobile-e2e.mjs, which
// starts the QA gateway and the control server these helpers talk to).
//
// Finders use AppStrings.t(key) instead of literal text so the tests follow
// the app's own copy (and don't care which locale a step leaves active).
// No pumpAndSettle anywhere: the app has never-ending animations (the status
// dot, the home button's pulse) and a live WebSocket, so settle never comes —
// see test/widget_test.dart. Waits poll the tree instead.

import 'dart:convert';
import 'dart:io';

import 'package:app/gateway/gateway_settings.dart';
import 'package:app/l10n/app_strings.dart';
import 'package:app/main.dart';
import 'package:app/profiles/connection_profile.dart';
import 'package:app/profiles/profile_store.dart';
import 'package:app/services/locale_store.dart';
import 'package:app/chat/composer_bar.dart';
import 'package:app/theme/ygg_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class E2E {
  static const gatewayUrl = String.fromEnvironment('E2E_GATEWAY_URL', defaultValue: 'http://127.0.0.1:18789');
  static const apiKey = String.fromEnvironment('E2E_API_KEY');
  static const controlUrl = String.fromEnvironment('E2E_CONTROL_URL', defaultValue: 'http://127.0.0.1:18790');
}

String s(String key) => AppStrings.t(key);

/// Any on-screen text containing [needle], whether a Text, a RichText or
/// markdown (which renders as RichText spans), unlike find.textContaining.
Finder findTextContaining(String needle) => find.byWidgetPredicate(
      (w) =>
          (w is RichText && w.text.toPlainText().contains(needle)) ||
          (w is EditableText && w.controller.text.contains(needle)),
      description: 'text containing "$needle"',
    );

/// The text field of the visible composer (home or chat).
Finder composerField() => find.descendant(of: find.byType(ComposerBar), matching: find.byType(TextField)).last;

/// Types [text] in the composer and taps Enviar (it only appears once there's text).
Future<void> typeAndSend(WidgetTester tester, String text) async {
  await pumpUntil(tester, composerField(), reason: 'composer');
  await tester.enterText(composerField(), text);
  await pumpUntil(tester, findButton(s('composer.send')), timeout: const Duration(seconds: 5), reason: 'botón Enviar');
  await tapAndPump(tester, findButton(s('composer.send')));
}

/// Android back (the app's own back buttons aren't Material BackButtons).
Future<void> goBack(WidgetTester tester) async {
  await tester.binding.handlePopRoute();
  await pumpFor(tester, const Duration(milliseconds: 800));
}

/// Wipes everything the app persisted, so each test starts like a fresh install.
Future<void> resetApp() async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.clear();
  AppStrings.current = 'es';
}

/// A fresh install that was pointed at the QA gateway: the chat's active
/// connection profile plus Ajustes > Gateway (Proyectos), which the app keeps
/// as a separate setting.
Future<void> seedQaGateway({String? url, String? apiKey, String locale = 'es'}) async {
  await resetApp();
  final profile = ConnectionProfile(
    id: 'e2e-qa',
    name: 'QA gateway',
    type: ConnectionProfileType.gateway,
    baseUrl: url ?? E2E.gatewayUrl,
    apiKey: apiKey ?? E2E.apiKey,
  );
  await ProfileStore.upsert(profile);
  await ProfileStore.setActiveId(profile.id);
  await GatewaySettingsStore.save(GatewaySettings(enabled: true, baseUrl: url ?? E2E.gatewayUrl, apiKey: apiKey ?? E2E.apiKey));
  await LocaleStore.set(locale);
  AppStrings.current = locale;
}

/// Mounts the real app (same steps as main()). A UniqueKey forces a fresh
/// YggdrasilApp state per test instead of reusing the previous test's.
Future<void> launchApp(WidgetTester tester) async {
  await YggThemeController.instance.load();
  await tester.pumpWidget(KeyedSubtree(key: UniqueKey(), child: const YggdrasilApp()));
  await tester.pump();
}

/// Unmounts the app. YggdrasilApp.dispose() disconnects its client, so
/// nothing from this test (reconnect timers, late events) leaks into the next.
Future<void> shutDownApp(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await pumpFor(tester, const Duration(milliseconds: 500));
}

/// A button by its tooltip — Flutter's IconButton and the app's YggIconButton
/// both show one.
Finder findButton(String label) => find.byTooltip(label);

/// From the home/chat list: opens the side drawer (Nuevo chat, Proyectos, Ajustes live there).
Future<void> openDrawer(WidgetTester tester) async {
  await pumpUntil(tester, findButton(s('drawer.open')), reason: 'botón del menú lateral');
  await tapAndPump(tester, findButton(s('drawer.open')));
}

/// Fresh app on the QA gateway, at the home/chat list (it has its own composer).
Future<void> openHome(WidgetTester tester) async {
  await seedQaGateway();
  await launchApp(tester);
  await pumpUntil(tester, find.text(s('assistant.allChats')), reason: 'pantalla inicial del asistente');
  await tapAndPump(tester, find.text(s('assistant.allChats')));
  await pumpUntil(tester, findButton(s('drawer.open')), reason: 'lista de chats');
}

/// Pumps real time until [finder] matches, or fails with [reason].
Future<void> pumpUntil(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 20),
  String? reason,
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
    await Future<void>.delayed(const Duration(milliseconds: 250));
  }
  throw TestFailure('Timed out after ${timeout.inSeconds}s waiting for $finder${reason == null ? '' : ' — $reason'}');
}

/// Pumps real time for [duration] (lets network replies and timers land).
Future<void> pumpFor(WidgetTester tester, Duration duration) async {
  final end = DateTime.now().add(duration);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
    await Future<void>.delayed(const Duration(milliseconds: 250));
  }
}

/// Taps [finder] (first match) and pumps a couple of frames for the route push.
Future<void> tapAndPump(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder.first);
  await tester.tap(finder.first);
  await pumpFor(tester, const Duration(milliseconds: 800));
}

Future<Map<String, dynamic>> _control(String path) async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
  try {
    final req = await client.postUrl(Uri.parse('${E2E.controlUrl}$path'));
    final res = await req.close().timeout(const Duration(seconds: 60));
    final body = await res.transform(utf8.decoder).join();
    return jsonDecode(body) as Map<String, dynamic>;
  } finally {
    client.close(force: true);
  }
}

/// Real device screenshot (adb screencap on the host), saved in the run's artifacts.
Future<void> shot(String name) async {
  try {
    await _control('/screenshot?name=${Uri.encodeQueryComponent(name)}');
  } catch (e) {
    // Evidence is best-effort; never fail a test because a screenshot didn't land.
    debugPrint('[e2e] screenshot "$name" failed: $e');
  }
}

Future<void> stopGateway() => _control('/gateway/stop');
Future<void> startGateway() => _control('/gateway/start');

/// testWidgets with a screenshot on failure. [knownBug] skips a test that
/// reproduces a finding already logged in
/// notes/yggdrasil-mobile/qa-e2e-findings-*.md (pass its id, e.g. 'F3').
void e2eTest(String name, Future<void> Function(WidgetTester tester) body, {String? knownBug}) {
  testWidgets(
    knownBug == null ? name : '$name [bug conocido $knownBug]',
    (tester) async {
      try {
        await body(tester);
      } catch (_) {
        await shot('FAIL-$name');
        rethrow;
      } finally {
        // Never let teardown trouble mask the body's own failure.
        try {
          await shutDownApp(tester);
        } catch (e) {
          debugPrint('[e2e] shutDownApp failed: $e');
        }
      }
    },
    skip: knownBug != null,
    timeout: const Timeout(Duration(minutes: 3)),
  );
}
