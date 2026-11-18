import 'package:flutter_test/flutter_test.dart';

import '../support/harness.dart';

/// The QA gateway runs the builtin echo agent: every reply is `echo: <message>`.
/// The home/chat list has its own composer: sending from it starts a new chat.
Future<void> openNewChat(WidgetTester tester) async {
  await openHome(tester);
  await pumpUntil(tester, composerField(), reason: 'composer de la home');
}

Future<void> sendAndExpectEcho(WidgetTester tester, String message, {Duration timeout = const Duration(seconds: 25)}) async {
  await typeAndSend(tester, message);
  await pumpUntil(tester, findTextContaining('echo: $message'), timeout: timeout, reason: 'respuesta del agente echo');
}

void chatFlow() {
  group('chat', () {
    e2eTest('envía un mensaje y recibe la respuesta del agente', (tester) async {
      await openNewChat(tester);
      await sendAndExpectEcho(tester, 'hola e2e');
      await shot('chat-echo');
      // Our own message stays on screen too.
      expect(findTextContaining('hola e2e'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    e2eTest('dos mensajes seguidos en la misma sesión', (tester) async {
      await openNewChat(tester);
      await sendAndExpectEcho(tester, 'primero');
      await sendAndExpectEcho(tester, 'segundo');
      expect(findTextContaining('echo: primero'), findsOneWidget);
      expect(findTextContaining('echo: segundo'), findsOneWidget);
      await shot('chat-two-messages');
    });

    e2eTest('la conversación aparece en la lista de chats', (tester) async {
      await openNewChat(tester);
      await sendAndExpectEcho(tester, 'para la lista');
      await goBack(tester);
      await pumpFor(tester, const Duration(seconds: 2));
      // Sessions live in the side drawer, grouped by day; the subtitle is the last message.
      await openDrawer(tester);
      await pumpUntil(
        tester,
        findTextContaining('para la lista'),
        timeout: const Duration(seconds: 15),
        reason: 'la sesión recién usada en el menú lateral',
      );
      await shot('chat-list-with-session');
    });

    e2eTest('el botón grande del home abre el chat con el gateway', (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        await seedQaGateway();
        await launchApp(tester);
        await pumpUntil(tester, find.bySemanticsLabel(s('assistant.openButton')));
        await tapAndPump(tester, find.bySemanticsLabel(s('assistant.openButton')));
        await pumpUntil(tester, composerField(), reason: 'composer del chat');
        await sendAndExpectEcho(tester, 'desde el home');
        await shot('home-button-chat');
      } finally {
        semantics.dispose();
      }
    });
  });

  group('reconexión', () {
    e2eTest('si el gateway se reinicia, el chat vuelve a funcionar', (tester) async {
      await openNewChat(tester);
      await sendAndExpectEcho(tester, 'antes del corte');

      await stopGateway();
      await pumpFor(tester, const Duration(seconds: 4));
      await shot('reconnect-gateway-down');
      await startGateway();
      // The client backs off 1/2/4/8/15 s between reconnect attempts.
      await pumpFor(tester, const Duration(seconds: 20));

      await sendAndExpectEcho(tester, 'después del corte', timeout: const Duration(seconds: 30));
      await shot('reconnect-after');
    });
  });
}
