import 'package:app/assistant/assistant_home_screen.dart';
import 'package:app/services/yggdrasil_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('assistant constants are stable (server config depends on them)', () {
    expect(assistantSessionKey, 'assistant:main');
    expect(assistantAgentId, 'assistant');
  });

  testWidgets('home shows the central assistant button and the chats link', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: AssistantHomeScreen(
          client: YggdrasilClient(baseUrl: 'http://127.0.0.1:1', apiKey: ''),
          events: const Stream.empty(),
          connected: Future.value(),
          status: '',
          slashCommands: const [],
          onProfileChanged: () async {},
          pendingSessions: <String>{},
          onOpenSession: (_) {},
        ),
      ),
    );

    expect(find.byIcon(Icons.mic_none_rounded), findsOneWidget);
    expect(find.text('Todos los chats'), findsOneWidget);
    expect(find.bySemanticsLabel('Abrir asistente'), findsOneWidget);
  });
}
