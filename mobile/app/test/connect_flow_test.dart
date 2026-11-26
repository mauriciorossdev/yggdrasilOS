import 'dart:async';

import 'package:app/assistant/assistant_home_screen.dart';
import 'package:app/gateway/gateway_settings.dart';
import 'package:app/hub/desktop_discovery.dart';
import 'package:app/hub/hub_link.dart';
import 'package:app/profiles/connection_profile.dart';
import 'package:app/profiles/profile_store.dart';
import 'package:app/services/connection_errors.dart';
import 'package:app/services/yggdrasil_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

HubDesktop _desk() => HubDesktop.fromJson({
      'desktopId': 'desk-abc',
      'name': 'MacBook',
      'online': true,
      'lastSeen': 1,
      'projects': [
        {'id': 'p1', 'name': 'my-project', 'port': 51234},
      ],
      'endpoints': {'lan': '192.168.1.20'},
      'gatewayKey': 'ygd_key',
    });

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('Proyectos follows the computer picked through the QR', () {
    test('connecting a desktop project also turns Proyectos on, with the same address and key', () async {
      final desk = _desk();
      await saveDesktopProfile(desk, desk.projects.first, 'http://192.168.1.20:51234');

      final settings = await GatewaySettingsStore.load();
      expect(settings.isReady, isTrue);
      expect(settings.baseUrl, 'http://192.168.1.20:51234');
      expect(settings.apiKey, 'ygd_key');
    });

    test('picking a computer from Proyectos leaves the chat on the assistant', () async {
      await ProfileStore.upsert(ConnectionProfile(
        id: 'hub',
        name: 'Asistente remoto',
        type: ConnectionProfileType.gateway,
        baseUrl: 'https://gw.example.com',
      ));
      await ProfileStore.setActiveId('hub');
      final desk = _desk();
      await saveDesktopProfile(desk, desk.projects.first, 'http://192.168.1.20:51234', switchChat: false);

      expect(await ProfileStore.getActiveId(), 'hub');
      expect((await GatewaySettingsStore.load()).baseUrl, 'http://192.168.1.20:51234');
    });

    test('from Proyectos with nothing active yet, the computer still becomes the chat connection', () async {
      final desk = _desk();
      final profile = await saveDesktopProfile(desk, desk.projects.first, 'http://192.168.1.20:51234', switchChat: false);
      expect(await ProfileStore.getActiveId(), profile.id);
    });

    test('a fresh install does not freeze an empty Gateway setting before any profile exists', () async {
      expect((await GatewaySettingsStore.load()).baseUrl, isEmpty);

      await ProfileStore.upsert(ConnectionProfile(
        id: 'g1',
        name: 'Gateway',
        type: ConnectionProfileType.gateway,
        baseUrl: 'http://10.0.0.2:8787',
      ));
      final seeded = await GatewaySettingsStore.load();
      expect(seeded.baseUrl, 'http://10.0.0.2:8787');
      // Seeding alone is still not an opt-in.
      expect(seeded.enabled, isFalse);
    });

    test('the seed prefers a computer from the QR over the link server itself', () async {
      await ProfileStore.upsert(ConnectionProfile(
        id: 'hub',
        name: 'Asistente remoto',
        type: ConnectionProfileType.gateway,
        baseUrl: 'https://gw.example.com',
      ));
      await ProfileStore.upsert(ConnectionProfile(
        id: 'desk',
        name: 'MacBook · my-project',
        type: ConnectionProfileType.gateway,
        baseUrl: 'http://192.168.1.20:51234',
        hubDesktopId: 'desk-abc',
        hubProjectId: 'p1',
      ));
      expect((await GatewaySettingsStore.load()).baseUrl, 'http://192.168.1.20:51234');
    });

    test('a new port moves Proyectos only if it pointed at the old one', () async {
      await GatewaySettingsStore.useComputer('http://192.168.1.20:51234', 'k');
      await GatewaySettingsStore.followMove('http://192.168.1.20:51234', 'http://192.168.1.20:60000', 'k');
      expect((await GatewaySettingsStore.load()).baseUrl, 'http://192.168.1.20:60000');

      await GatewaySettingsStore.followMove('http://192.168.1.99:1', 'http://192.168.1.99:2', 'k');
      expect((await GatewaySettingsStore.load()).baseUrl, 'http://192.168.1.20:60000');
    });
  });

  group('the two profiles a QR creates say what each one is for', () {
    const hub = HubLink('https://gw.example.com', 'k');

    test('the link server profile reads as the always-on assistant, the project as your computer', () {
      final assistant = ConnectionProfile(id: 'a', name: 'X', type: ConnectionProfileType.gateway, baseUrl: 'https://gw.example.com/');
      final computer = ConnectionProfile(
        id: 'c',
        name: 'MacBook · p',
        type: ConnectionProfileType.gateway,
        baseUrl: 'http://192.168.1.20:51234',
        hubDesktopId: 'd',
        hubProjectId: 'p',
      );
      final manual = ConnectionProfile(id: 'm', name: 'M', type: ConnectionProfileType.gateway, baseUrl: 'http://10.0.0.2:8787');

      expect(profileRole(assistant, hub), ProfileRole.assistant);
      expect(profileSubtitle(assistant, hub), 'Siempre encendido, en tu servidor de enlace');
      expect(profileRole(computer, hub), ProfileRole.computer);
      expect(profileSubtitle(computer, hub), 'Tu computadora');
      expect(profileSubtitle(manual, hub), 'http://10.0.0.2:8787');
      expect(profileRole(assistant, null), ProfileRole.other);
    });

    test('scanning names a new assistant profile by its job', () async {
      final profile = await applyHubLink(hub);
      expect(profile!.name, 'Tu asistente');
    });

    test('the old default name is renamed, a name the user chose is kept', () async {
      await HubStore.save(hub);
      await ProfileStore.upsert(ConnectionProfile(id: 'old', name: legacyAssistantName, type: ConnectionProfileType.gateway, baseUrl: hub.url));
      await renameLegacyAssistantProfile();
      expect((await ProfileStore.list()).single.name, 'Tu asistente');

      await ProfileStore.upsert(ConnectionProfile(id: 'old', name: 'Asistente (Railway)', type: ConnectionProfileType.gateway, baseUrl: hub.url));
      await renameLegacyAssistantProfile();
      await applyHubLink(hub);
      expect((await ProfileStore.list()).single.name, 'Asistente (Railway)');
    });
  });

  group('local link QR (the desktop on the same network, no link server)', () {
    const payload = 'yggdrasil://hub?url=http%3A%2F%2F192.168.1.5%3A4321&key=gk&local=1';

    test('is read as local and remembered as such', () async {
      final link = HubLink.parse(payload)!;
      expect(link.local, isTrue);
      expect(link.url, 'http://192.168.1.5:4321');
      expect(HubLink.parse('yggdrasil://hub?url=https%3A%2F%2Fgw.example.com&key=k')!.local, isFalse);

      await HubStore.save(link);
      expect((await HubStore.saved())!.local, isTrue);
    });

    test('does not turn the desktop directory into a chat profile', () async {
      expect(await applyHubLink(HubLink.parse(payload)!), isNull);
      expect(await ProfileStore.list(), isEmpty);
      expect(await ProfileStore.getActiveId(), isNull);
      expect((await HubStore.saved())!.url, 'http://192.168.1.5:4321');
    });
  });

  test('isConnectionError tells "nothing answers" apart from real failures', () {
    expect(isConnectionError(StateError('WebSocket closed')), isTrue);
    expect(isConnectionError(TimeoutException('sessions.list timed out')), isTrue);
    expect(isConnectionError(StateError('something else')), isFalse);
    expect(isConnectionError(Exception('forbidden')), isFalse);
  });

  group('home connect banner', () {
    Widget home(YggdrasilClient client) => MaterialApp(
          home: AssistantHomeScreen(
            client: client,
            events: const Stream.empty(),
            connected: Future.value(),
            status: '',
            slashCommands: const [],
            onProfileChanged: () async {},
            pendingSessions: <String>{},
            onOpenSession: (_) {},
          ),
        );

    testWidgets('offers to connect a computer when nothing is connected', (tester) async {
      await tester.runAsync(() async {
        await tester.pumpWidget(home(YggdrasilClient(baseUrl: 'http://127.0.0.1:1', apiKey: '')));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pump();
      expect(find.text('Conectar con tu computadora'), findsOneWidget);
    });

    testWidgets('a dropped connection is named and retried, not called "not connected yet"', (tester) async {
      await tester.runAsync(() async {
        await ProfileStore.upsert(ConnectionProfile(
          id: 'hub',
          name: 'Asistente remoto',
          type: ConnectionProfileType.gateway,
          baseUrl: 'https://gw.example.com',
        ));
        await ProfileStore.setActiveId('hub');
        await tester.pumpWidget(home(YggdrasilClient(baseUrl: 'http://127.0.0.1:1', apiKey: '')));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pump();
      // Within the grace period a blip shows nothing.
      expect(find.textContaining('Sin conexión'), findsNothing);

      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 4200)));
      await tester.pump();
      expect(find.text('Sin conexión con Asistente remoto. Reintentando…'), findsOneWidget);
      expect(find.text('Conectar otra computadora'), findsOneWidget);
      expect(find.textContaining('Aún no estás conectado'), findsNothing);
    });

    testWidgets('stays out of the way in direct mode, which needs no computer', (tester) async {
      await tester.runAsync(() async {
        await ProfileStore.upsert(ConnectionProfile(id: 'd', name: 'Claude', type: ConnectionProfileType.direct));
        await ProfileStore.setActiveId('d');
        await tester.pumpWidget(home(YggdrasilClient(baseUrl: 'http://127.0.0.1:1', apiKey: '')));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pump();
      expect(find.text('Conectar con tu computadora'), findsNothing);
    });
  });
}
