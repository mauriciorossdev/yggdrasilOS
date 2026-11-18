import 'package:app/assistant/assistant_home_screen.dart';
import 'package:app/profiles/connection_profile.dart';
import 'package:app/profiles/profile_store.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/harness.dart';

/// Opening the app against the QA gateway, and what it shows when it can't reach one.
void connectFlow() {
  group('conexión', () {
    e2eTest('abre la app y llega a la lista de chats conectada', (tester) async {
      await seedQaGateway();
      await launchApp(tester);
      await pumpUntil(tester, find.text(s('assistant.allChats')), reason: 'home del asistente');
      await shot('home');

      await tapAndPump(tester, find.text(s('assistant.allChats')));
      await pumpUntil(tester, find.text(s('home.connected')), reason: 'chip "Conectado" en la lista de chats');
      await shot('chat-list-connected');
      expect(tester.takeException(), isNull);
    });

    // Regression F-chip-conectado: the chip used to read the saved settings,
    // not the live socket, so it said "Conectado" with the gateway down.
    e2eTest('con el gateway caído no muestra "Conectado"', (tester) async {
      await seedQaGateway();
      await stopGateway();
      try {
        await launchApp(tester);
        await pumpUntil(tester, find.text(s('assistant.allChats')));
        await tapAndPump(tester, find.text(s('assistant.allChats')));
        await pumpFor(tester, const Duration(seconds: 6));
        await shot('chat-list-gateway-down');
        expect(find.text(s('home.connected')), findsNothing, reason: 'el gateway está apagado');
      } finally {
        await startGateway();
      }
    });

    // Regression F-mensaje-perdido. Fresh install, nothing reachable: the
    // message must stay on screen with a retry action, not vanish into an
    // empty chat.
    e2eTest('sin gateway alcanzable, enviar un mensaje muestra un error', (tester) async {
      await resetApp();
      // The default address is the gateway's default port, which adb reverse
      // forwards to the QA gateway: stop it so nothing answers there.
      await stopGateway();
      try {
        await launchApp(tester);
        await pumpUntil(tester, find.text(s('assistant.allChats')));
        await tapAndPump(tester, find.text(s('assistant.allChats')));
        await typeAndSend(tester, 'hola sin gateway');
        await pumpUntil(
          tester,
          find.text(s('common.retry')),
          timeout: const Duration(seconds: 30),
          reason: 'un error con "Reintentar" en vez de quedar pensando',
        );
        await shot('send-without-gateway');
        expect(findTextContaining('hola sin gateway'), findsWidgets, reason: 'el mensaje del usuario sigue visible');
      } finally {
        await startGateway();
      }
    });

    // Gateway down when sending, back up afterwards: "Reintentar" sends the
    // same message and the reply arrives.
    e2eTest('un mensaje que no salió se reenvía con "Reintentar"', (tester) async {
      await seedQaGateway();
      await stopGateway();
      try {
        await launchApp(tester);
        await pumpUntil(tester, find.text(s('assistant.allChats')));
        await tapAndPump(tester, find.text(s('assistant.allChats')));
        await typeAndSend(tester, 'reintento');
        await pumpUntil(tester, find.text(s('common.retry')), timeout: const Duration(seconds: 30));
      } finally {
        await startGateway();
      }
      // Reconnect backoff tops out at 15 s.
      await pumpFor(tester, const Duration(seconds: 20));
      await tapAndPump(tester, find.text(s('common.retry')));
      await pumpUntil(tester, findTextContaining('echo: reintento'), timeout: const Duration(seconds: 30), reason: 'respuesta tras reintentar');
      expect(find.text(s('common.retry')), findsNothing);
      await shot('send-retried');
    });

    // Regression F-setstate-future: switching the active profile (what Ajustes
    // and hub linking do) used to trip "setState() callback argument returned
    // a Future" in debug builds.
    e2eTest('cambiar el perfil activo no lanza excepciones', (tester) async {
      await seedQaGateway();
      await launchApp(tester);
      await pumpUntil(tester, find.text(s('assistant.allChats')), reason: 'home del asistente');
      final other = ConnectionProfile(id: 'e2e-direct', name: 'directo', type: ConnectionProfileType.direct);
      await ProfileStore.upsert(other);
      await ProfileStore.setActiveId(other.id);
      final home = find.byType(AssistantHomeScreen, skipOffstage: false).first;
      await tester.widget<AssistantHomeScreen>(home).onProfileChanged();
      await pumpFor(tester, const Duration(milliseconds: 500));
      expect(tester.takeException(), isNull);
    });

    // Regression F-lista-cliente-viejo: the chat list is a pushed route that
    // used to keep the client it was opened with. Switching to another gateway
    // profile disconnects that one, so the chip only comes back if the list
    // follows the new client.
    e2eTest('la lista de chats sigue al cliente nuevo al cambiar de perfil', (tester) async {
      await openHome(tester);
      await pumpUntil(tester, find.text(s('home.connected')), reason: 'chip "Conectado" con el primer perfil');
      final second = ConnectionProfile(
        id: 'e2e-qa-2',
        name: 'QA gateway 2',
        type: ConnectionProfileType.gateway,
        baseUrl: E2E.gatewayUrl,
        apiKey: E2E.apiKey,
      );
      await ProfileStore.upsert(second);
      await ProfileStore.setActiveId(second.id);
      final home = find.byType(AssistantHomeScreen, skipOffstage: false).first;
      await tester.widget<AssistantHomeScreen>(home).onProfileChanged();
      await pumpFor(tester, const Duration(seconds: 1));
      await pumpUntil(tester, find.text(s('home.connected')), reason: 'chip "Conectado" con el perfil nuevo');
      await shot('chat-list-after-profile-switch');
      expect(tester.takeException(), isNull);
    });
  });
}
