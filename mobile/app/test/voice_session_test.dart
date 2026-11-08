import 'dart:async';

import 'package:app/profiles/connection_profile.dart';
import 'package:app/standalone/local_chat.dart';
import 'package:app/standalone/local_message.dart';
import 'package:app/standalone/providers/provider_client.dart';
import 'package:app/standalone/standalone_chat_engine.dart';
import 'package:app/standalone/suggestion.dart';
import 'package:app/voice/continuous_listener.dart';
import 'package:app/voice/speech_output.dart';
import 'package:app/voice/voice_chat.dart';
import 'package:app/voice/voice_session.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Hands out scripted results; once they run out it waits until cancelled.
class _FakeListener implements UtteranceSource {
  final List<ListenResult> script;
  final List<String> log;
  Completer<ListenResult>? _pending;
  int listens = 0;

  _FakeListener(this.script, this.log);

  @override
  Future<ListenResult> listenForUtterance({void Function(String partial)? onPartial, void Function(double level)? onLevel}) {
    listens++;
    log.add('listen');
    if (script.isNotEmpty) {
      final next = script.removeAt(0);
      if (next is Heard) onPartial?.call(next.text);
      return Future.value(next);
    }
    return (_pending = Completer<ListenResult>()).future;
  }

  @override
  Future<void> cancel() async {
    log.add('cancel');
    final p = _pending;
    if (p != null && !p.isCompleted) p.complete(const Cancelled());
  }
}

class _FakeOutput implements SpeechOutput {
  final List<String> log;
  final List<String> spoken = [];
  Completer<void>? _speaking;
  bool hold = false;
  bool fail = false;
  int stops = 0;

  _FakeOutput(this.log);

  @override
  bool get speaking => _speaking != null && !_speaking!.isCompleted;

  @override
  Future<void> speak(String text) async {
    log.add('speak:$text');
    spoken.add(text);
    if (fail) throw Exception('tts down');
    if (!hold) return;
    _speaking = Completer<void>();
    await _speaking!.future;
  }

  @override
  Future<void> stop() async {
    stops++;
    final s = _speaking;
    if (s != null && !s.isCompleted) s.complete();
  }
}

class _Rig {
  final log = <String>[];
  late final _FakeListener listener;
  late final _FakeOutput output;
  _FakeOutput? fallback;
  final waits = <Duration>[];
  final asked = <String>[];
  Future<String> Function(String) ask = (t) async => 'respuesta a $t';
  late final VoiceSession session;
  final states = <VoiceState>[];

  _Rig(List<ListenResult> script, {bool withFallback = false}) {
    listener = _FakeListener(script, log);
    output = _FakeOutput(log);
    if (withFallback) fallback = _FakeOutput(log);
    session = VoiceSession(
      listener: listener,
      output: output,
      fallbackOutput: fallback,
      ask: (t) {
        log.add('ask:$t');
        asked.add(t);
        return ask(t);
      },
      replyFailedText: () => 'fallo',
      wait: (d) async => waits.add(d),
    );
    session.state.addListener(() => states.add(session.state.value));
  }

  /// Lets queued microtasks and timers run.
  Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('VoiceSession', () {
    test('listens, asks, speaks and listens again, with the microphone closed while it thinks and speaks', () async {
      final rig = _Rig([const Heard('hola')]);
      final run = rig.session.run();
      await rig.settle();
      // Second listen is pending now: the first turn is complete.
      expect(rig.log, ['listen', 'ask:hola', 'speak:respuesta a hola', 'listen']);
      expect(rig.states, [VoiceState.listening, VoiceState.thinking, VoiceState.speaking, VoiceState.listening]);
      expect(rig.session.lastUserText.value, 'hola');
      expect(rig.session.lastReply.value, 'respuesta a hola');
      await rig.session.end();
      await run;
      expect(rig.session.state.value, VoiceState.ended);
    });

    test('waits a moment after the assistant stops before it listens again', () async {
      final rig = _Rig([const Heard('hola')]);
      final run = rig.session.run();
      await rig.settle();
      expect(rig.waits, [const Duration(milliseconds: 400)]);
      await rig.session.end();
      await run;
    });

    test('several turns in a row', () async {
      final rig = _Rig([const Heard('uno'), const Heard('dos'), const Heard('tres')]);
      final run = rig.session.run();
      await rig.settle();
      expect(rig.asked, ['uno', 'dos', 'tres']);
      expect(rig.output.spoken, ['respuesta a uno', 'respuesta a dos', 'respuesta a tres']);
      await rig.session.end();
      await run;
    });

    test('a tap interrupts the speech and goes back to listening', () async {
      final rig = _Rig([const Heard('cuéntame todo')]);
      rig.output.hold = true;
      final run = rig.session.run();
      await rig.settle();
      expect(rig.session.state.value, VoiceState.speaking);
      await rig.session.interrupt();
      await rig.settle();
      expect(rig.session.state.value, VoiceState.listening);
      expect(rig.listener.listens, 2);
      await rig.session.end();
      await run;
    });

    test('interrupt does nothing unless the assistant is speaking', () async {
      final rig = _Rig([]);
      final run = rig.session.run();
      await rig.settle();
      await rig.session.interrupt();
      expect(rig.output.stops, 0);
      await rig.session.end();
      await run;
    });

    test('pausing stops the speech and closes the microphone until resumed', () async {
      final rig = _Rig([const Heard('hola')]);
      rig.output.hold = true;
      final run = rig.session.run();
      await rig.settle();
      expect(rig.session.state.value, VoiceState.speaking);

      rig.session.pause();
      await rig.settle();
      expect(rig.session.state.value, VoiceState.paused);
      expect(rig.session.pauseReason, VoicePauseReason.muted);
      expect(rig.output.stops, greaterThan(0));
      expect(rig.listener.listens, 1); // no new listening while paused

      rig.session.resume();
      await rig.settle();
      expect(rig.session.state.value, VoiceState.listening);
      expect(rig.listener.listens, 2);
      await rig.session.end();
      await run;
    });

    test('a reply that arrives while paused is kept on screen but not spoken', () async {
      final answer = Completer<String>();
      final rig = _Rig([const Heard('pregunta')]);
      rig.ask = (_) => answer.future;
      final run = rig.session.run();
      await rig.settle();
      expect(rig.session.state.value, VoiceState.thinking);

      rig.session.pause(VoicePauseReason.background);
      answer.complete('tarde');
      await rig.settle();
      expect(rig.session.lastReply.value, 'tarde');
      expect(rig.output.spoken, isEmpty);
      expect(rig.session.pauseReason, VoicePauseReason.background);
      await rig.session.end();
      await run;
    });

    test('long silence pauses the session as idle, and resume listens again', () async {
      final rig = _Rig([const Idle()]);
      final run = rig.session.run();
      await rig.settle();
      expect(rig.session.state.value, VoiceState.paused);
      expect(rig.session.pauseReason, VoicePauseReason.idle);
      rig.session.resume();
      await rig.settle();
      expect(rig.session.state.value, VoiceState.listening);
      await rig.session.end();
      await run;
    });

    test('a recognizer failure ends the session and keeps the reason', () async {
      final rig = _Rig([const Failed(ListenFailureKind.permission, 'error_permission')]);
      await rig.session.run();
      expect(rig.session.state.value, VoiceState.ended);
      expect(rig.session.failure?.kind, ListenFailureKind.permission);
    });

    test('a failed reply is announced out loud and the conversation goes on', () async {
      final rig = _Rig([const Heard('hola')]);
      rig.ask = (_) async => throw const VoiceReplyException('boom');
      final run = rig.session.run();
      await rig.settle();
      expect(rig.output.spoken, ['fallo']);
      expect(rig.session.lastReply.value, isEmpty);
      expect(rig.listener.listens, 2);
      await rig.session.end();
      await run;
    });

    test('nothing is spoken for an empty reply', () async {
      final rig = _Rig([const Heard('hola')]);
      rig.ask = (_) async => '  ';
      final run = rig.session.run();
      await rig.settle();
      expect(rig.output.spoken, isEmpty);
      expect(rig.listener.listens, 2);
      await rig.session.end();
      await run;
    });

    test('when the voice fails the fallback voice speaks, and if that fails too the error is kept', () async {
      final rig = _Rig([const Heard('hola')], withFallback: true);
      rig.output.fail = true;
      final run = rig.session.run();
      await rig.settle();
      expect(rig.fallback!.spoken, ['respuesta a hola']);
      expect(rig.session.speakError, isNull);
      await rig.session.end();
      await run;

      final rig2 = _Rig([const Heard('hola')], withFallback: true);
      rig2.output.fail = true;
      rig2.fallback!.fail = true;
      final run2 = rig2.session.run();
      await rig2.settle();
      expect(rig2.session.speakError, contains('tts down'));
      expect(rig2.listener.listens, 2);
      await rig2.session.end();
      await run2;
    });

    test('ending stops everything and completes run()', () async {
      final rig = _Rig([const Heard('hola')]);
      rig.output.hold = true;
      final run = rig.session.run();
      await rig.settle();
      await rig.session.end();
      await run.timeout(const Duration(seconds: 1));
      expect(rig.session.state.value, VoiceState.ended);
      expect(rig.session.running, isFalse);
    });
  });

  group('VoiceChat and the engine in voice mode', () {
    final profile = ConnectionProfile(id: 'p', name: 'p', type: ConnectionProfileType.direct, provider: DirectProvider.anthropic);

    test('asks in voice mode: no suggestion card tool, and the prompt is written for the ear', () async {
      final client = _ScriptedClient([ProviderChatResult(text: 'Claro, aquí estoy.')]);
      final voice = await VoiceChat.start(profile, confirm: (_, _) async => true, engine: StandaloneChatEngine(profile, client: client));
      final reply = await voice.ask('hola');

      expect(reply, 'Claro, aquí estoy.');
      expect(client.toolSpecsSeen.single.map((s) => s['name']), isNot(contains(suggestActionToolName)));
      expect(client.promptsSeen.single, contains('hears your answer through text-to-speech'));
      expect(client.promptsSeen.single, isNot(contains('suggest_action')));
    });

    test('the answer is the last message without tool calls, not the text that came with them', () async {
      final client = _ScriptedClient([
        ProviderChatResult(text: 'Voy a mirar.', toolCalls: [LocalToolCall(id: 't1', name: suggestActionToolName, args: {'kind': 'bad'})]),
        ProviderChatResult(text: 'Listo, ya está.'),
      ]);
      final voice = await VoiceChat.start(profile, confirm: (_, _) async => true, engine: StandaloneChatEngine(profile, client: client));
      expect(await voice.ask('haz algo'), 'Listo, ya está.');
    });

    test('a provider failure throws instead of reading the error aloud', () async {
      final client = _ScriptedClient(const [], failWith: 'cuota agotada');
      final voice = await VoiceChat.start(profile, confirm: (_, _) async => true, engine: StandaloneChatEngine(profile, client: client));
      await expectLater(voice.ask('hola'), throwsA(isA<VoiceReplyException>().having((e) => e.message, 'message', contains('cuota agotada'))));
    });

    test('the conversation is saved as a chat of its own with the default personality', () async {
      final client = _ScriptedClient([ProviderChatResult(text: 'Hola.')]);
      final voice = await VoiceChat.start(profile, confirm: (_, _) async => true, engine: StandaloneChatEngine(profile, client: client));
      await voice.ask('buenas');
      expect(voice.chat.title, isNotEmpty);
      expect(voice.chat.personaId, 'general');
      expect(voice.chat.messages.map((m) => m.role), [LocalRole.user, LocalRole.assistant]);
      expect(LocalChat.fromJson(voice.chat.toJson()).messages, hasLength(2));
    });
  });
}

class _ScriptedClient implements ProviderClient {
  final List<ProviderChatResult> replies;
  final String? failWith;
  final toolSpecsSeen = <List<Map<String, dynamic>>>[];
  final promptsSeen = <String?>[];

  _ScriptedClient(List<ProviderChatResult> replies, {this.failWith}) : replies = List.of(replies);

  @override
  String get defaultModel => 'fake';

  @override
  Future<ProviderChatResult> chat({
    required String apiKey,
    required String? model,
    required List<LocalMessage> history,
    required List<Map<String, dynamic>> toolSpecs,
    String? systemPrompt,
  }) async {
    toolSpecsSeen.add(toolSpecs);
    promptsSeen.add(systemPrompt);
    if (failWith != null) throw Exception(failWith);
    return replies.removeAt(0);
  }
}
