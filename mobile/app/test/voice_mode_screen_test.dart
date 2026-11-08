import 'dart:async';

import 'package:app/profiles/connection_profile.dart';
import 'package:app/voice/continuous_listener.dart';
import 'package:app/voice/speech_output.dart';
import 'package:app/voice/voice_mode_screen.dart';
import 'package:app/voice/voice_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Listener implements UtteranceSource {
  final List<ListenResult> script;
  Completer<ListenResult>? _pending;
  void Function(String)? _onPartial;
  int listens = 0;

  _Listener([List<ListenResult> script = const []]) : script = List.of(script);

  void say(String partial) => _onPartial?.call(partial);

  @override
  Future<ListenResult> listenForUtterance({void Function(String partial)? onPartial, void Function(double level)? onLevel}) {
    listens++;
    _onPartial = onPartial;
    if (script.isNotEmpty) return Future.value(script.removeAt(0));
    return (_pending = Completer<ListenResult>()).future;
  }

  @override
  Future<void> cancel() async {
    final p = _pending;
    if (p != null && !p.isCompleted) p.complete(const Cancelled());
  }
}

class _Output implements SpeechOutput {
  Completer<void>? _speaking;
  bool hold = false;
  final spoken = <String>[];

  @override
  bool get speaking => _speaking != null && !_speaking!.isCompleted;

  @override
  Future<void> speak(String text) async {
    spoken.add(text);
    if (!hold) return;
    _speaking = Completer<void>();
    await _speaking!.future;
  }

  @override
  Future<void> stop() async {
    final s = _speaking;
    if (s != null && !s.isCompleted) s.complete();
  }
}

final _profile = ConnectionProfile(id: 'p', name: 'p', type: ConnectionProfileType.direct, provider: DirectProvider.anthropic);

VoiceSession _session(_Listener listener, _Output output, {Future<String> Function(String)? ask}) => VoiceSession(
      listener: listener,
      output: output,
      ask: ask ?? (t) async => 'respuesta a $t',
      replyFailedText: () => 'fallo',
      wait: (_) async {},
    );

Future<void> _open(WidgetTester tester, VoiceSessionFactory factory, {Future<bool> Function()? mic}) async {
  await tester.pumpWidget(MaterialApp(
    home: VoiceModeScreen(profile: _profile, sessionFactory: factory, requestMic: mic ?? () async => true),
  ));
  // The orb animates forever, so pump a few frames instead of settling.
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('shows that it is listening, with the title and the mute and end buttons', (tester) async {
    final listener = _Listener();
    await _open(tester, (_) async => _session(listener, _Output()));
    expect(find.text('ESCUCHANDO'), findsOneWidget);
    expect(find.text('MODO VOZ'), findsOneWidget);
    expect(find.byIcon(Icons.mic_none), findsOneWidget);
    expect(find.byIcon(Icons.close), findsOneWidget);
  });

  testWidgets('shows what is being said while listening', (tester) async {
    final listener = _Listener();
    await _open(tester, (_) async => _session(listener, _Output()));
    listener.say('quiero saber el clima');
    await tester.pump();
    expect(find.text('quiero saber el clima'), findsOneWidget);
  });

  testWidgets('shows the assistant answer after a turn and goes back to listening', (tester) async {
    final listener = _Listener([const Heard('hola')]);
    await _open(tester, (_) async => _session(listener, _Output()));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('respuesta a hola'), findsOneWidget);
    expect(find.text('ESCUCHANDO'), findsOneWidget);
    expect(listener.listens, 2);
  });

  testWidgets('the mute button holds the conversation and unmutes it', (tester) async {
    final listener = _Listener();
    await _open(tester, (_) async => _session(listener, _Output()));
    await tester.tap(find.byIcon(Icons.mic_none));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('EN PAUSA'), findsOneWidget);
    expect(find.byIcon(Icons.mic_off), findsOneWidget);

    await tester.tap(find.byIcon(Icons.mic_off));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('ESCUCHANDO'), findsOneWidget);
  });

  testWidgets('a tap anywhere cuts the assistant off while it speaks', (tester) async {
    final listener = _Listener([const Heard('cuéntame')]);
    final output = _Output()..hold = true;
    await _open(tester, (_) async => _session(listener, output));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('HABLANDO'), findsOneWidget);
    expect(find.text('Toca para interrumpir'), findsOneWidget);

    await tester.tapAt(const Offset(200, 500));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('ESCUCHANDO'), findsOneWidget);
  });

  testWidgets('after a long silence a tap picks the conversation up again', (tester) async {
    final listener = _Listener([const Idle()]);
    await _open(tester, (_) async => _session(listener, _Output()));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.textContaining('TOCA PARA SEGUIR'), findsOneWidget);

    await tester.tapAt(const Offset(200, 500));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('ESCUCHANDO'), findsOneWidget);
  });

  testWidgets('the close button ends the session and leaves the screen', (tester) async {
    final listener = _Listener();
    late VoiceSession session;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => VoiceModeScreen(
                  profile: _profile,
                  requestMic: () async => true,
                  sessionFactory: (_) async => session = _session(listener, _Output()),
                ),
              ),
            ),
            child: const Text('abrir'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('abrir'));
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(find.text('MODO VOZ'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    expect(find.text('MODO VOZ'), findsNothing);
    expect(find.text('abrir'), findsOneWidget);
    expect(session.state.value, VoiceState.ended);
  });

  testWidgets('without the microphone permission it explains and offers the settings', (tester) async {
    await _open(tester, (_) async => _session(_Listener(), _Output()), mic: () async => false);
    expect(find.text('Necesito el micrófono para conversar contigo.'), findsOneWidget);
    expect(find.text('Abrir ajustes'), findsOneWidget);
    expect(find.text('MODO VOZ'), findsNothing);
  });

  testWidgets('a recognizer that fails for good shows why', (tester) async {
    final listener = _Listener([const Failed(ListenFailureKind.languageUnavailable, 'error_language_unavailable')]);
    await _open(tester, (_) async => _session(listener, _Output()));
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('El teléfono no tiene instalado el idioma de voz.'), findsOneWidget);
    expect(find.text('Cerrar'), findsOneWidget);
  });

  testWidgets('a session that cannot even be created shows an error instead of hanging', (tester) async {
    await _open(tester, (_) async => throw Exception('sin perfil'));
    expect(find.text('El reconocimiento de voz falló.'), findsOneWidget);
  });
}
