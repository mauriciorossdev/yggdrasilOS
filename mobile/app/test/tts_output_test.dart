import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:app/voice/replicate_tts_output.dart';
import 'package:app/voice/speakable_text.dart';
import 'package:app/voice/tts_settings.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakePlayer implements ClipPlayer {
  final played = <String>[];
  Completer<void>? _current;

  /// When set, play() waits until [stop] is called, like a clip that is still playing.
  bool hold = false;

  @override
  Future<void> play(Uint8List mp3) async {
    played.add(latin1.decode(mp3));
    if (!hold) return;
    _current = Completer<void>();
    await _current!.future;
  }

  @override
  Future<void> stop() async {
    final c = _current;
    if (c != null && !c.isCompleted) c.complete();
  }
}

/// A fake Replicate: predictions answer with an audio URL that encodes the text, and
/// the "audio" downloaded from it is that text.
MockClient _replicate({List<String>? log, int predictionStatus = 200, String status = 'succeeded'}) {
  return MockClient((req) async {
    if (req.url.host == 'api.replicate.com') {
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      log?.add('predict:${body['input']['text']}');
      expect(req.headers['Authorization'], 'Bearer tok');
      expect(req.headers['Prefer'], 'wait');
      return http.Response(
        jsonEncode({
          'status': status,
          'error': status == 'succeeded' ? null : 'boom',
          'output': 'https://files.example/${Uri.encodeComponent(body['input']['text'] as String)}',
        }),
        predictionStatus,
      );
    }
    log?.add('download');
    return http.Response(Uri.decodeComponent(req.url.path.substring(1)), 200);
  });
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('speakableText', () {
    test('drops emoji and their joiners but keeps accents and inverted marks', () {
      expect(speakableText('¡Hola, María! 😊 Qué tal 👍🏽 ❤️'), '¡Hola, María! Qué tal');
    });
  });

  group('splitSentences', () {
    test('joins short sentences until a chunk is worth a request', () {
      final chunks = splitSentences('Hola. Qué tal. Estoy aquí para ayudarte con lo que necesites hoy. Dime.');
      expect(chunks.first, 'Hola. Qué tal. Estoy aquí para ayudarte con lo que necesites hoy.');
      expect(chunks.last, 'Dime.');
      expect(chunks, hasLength(2));
    });

    test('keeps a long sentence whole when it fits and cuts one that does not', () {
      expect(splitSentences('Una sola frase bastante larga que no se parte porque cabe.'), hasLength(1));
      final long = List.filled(60, 'palabra').join(' ');
      final chunks = splitSentences(long, maxChars: 100);
      expect(chunks.length, greaterThan(3));
      expect(chunks.every((c) => c.length <= 100), isTrue);
      expect(chunks.join(' '), long);
    });

    test('returns nothing for empty text', () => expect(splitSentences('  '), isEmpty));
  });

  group('ReplicateTtsOutput', () {
    test('synthesizes in two steps with the right request and plays the audio', () async {
      final log = <String>[];
      final player = _FakePlayer();
      final out = ReplicateTtsOutput(token: 'tok', voiceId: 'Voz_X', speed: 1.2, httpClient: _replicate(log: log), player: player);
      await out.speak('Hola mundo, esto es una prueba de voz con suficiente largo.');
      expect(log, ['predict:Hola mundo, esto es una prueba de voz con suficiente largo.', 'download']);
      expect(player.played, ['Hola mundo, esto es una prueba de voz con suficiente largo.']);
      expect(out.speaking, isFalse);
    });

    test('sends the voice and speed in the prediction input', () async {
      Map<String, dynamic>? input;
      final client = MockClient((req) async {
        if (req.url.host == 'api.replicate.com') {
          input = (jsonDecode(req.body) as Map<String, dynamic>)['input'] as Map<String, dynamic>;
          return http.Response(jsonEncode({'status': 'succeeded', 'output': ['https://f.example/a']}), 201);
        }
        return http.Response('a', 200);
      });
      await ReplicateTtsOutput(token: 'tok', voiceId: 'Voz_X', speed: 1.2, httpClient: client, player: _FakePlayer()).speak('Hola');
      expect(input!['voice_id'], 'Voz_X');
      expect(input!['speed'], 1.2);
      expect(input!['audio_format'], 'mp3');
    });

    test('starts the next sentence before the current one has finished playing', () async {
      final log = <String>[];
      final player = _FakePlayer()..hold = true;
      final out = ReplicateTtsOutput(token: 'tok', httpClient: _replicate(log: log), player: player);
      const one = 'Primera frase lo bastante larga para ser su propio fragmento.';
      const two = 'Segunda frase también lo bastante larga para no unirse con otra.';
      final speaking = out.speak('$one $two');
      await Future<void>.delayed(const Duration(milliseconds: 50));
      // First clip is "playing" (held) and the second request is already out.
      expect(player.played, [one]);
      expect(log.where((l) => l.startsWith('predict:')).length, 2);
      player._current!.complete();
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(player.played, [one, two]);
      player._current!.complete();
      await speaking;
    });

    test('stop ends the speech without playing the rest', () async {
      final player = _FakePlayer()..hold = true;
      final out = ReplicateTtsOutput(token: 'tok', httpClient: _replicate(), player: player);
      final speaking = out.speak(
        'Primera frase lo bastante larga para ser su propio fragmento. '
        'Segunda frase también lo bastante larga para no unirse con otra.',
      );
      await Future<void>.delayed(const Duration(milliseconds: 50));
      await out.stop();
      await speaking;
      expect(player.played, hasLength(1));
      expect(out.speaking, isFalse);
    });

    test('a failed prediction throws with the reason', () async {
      final out = ReplicateTtsOutput(token: 'tok', httpClient: _replicate(status: 'failed'), player: _FakePlayer());
      await expectLater(out.speak('Hola'), throwsA(predicate((e) => '$e'.contains('boom'))));
    });

    test('an HTTP error throws with the status', () async {
      final out = ReplicateTtsOutput(token: 'tok', httpClient: _replicate(predictionStatus: 401), player: _FakePlayer());
      await expectLater(out.speak('Hola'), throwsA(predicate((e) => '$e'.contains('401'))));
    });

    test('text with nothing to say plays nothing', () async {
      final player = _FakePlayer();
      await ReplicateTtsOutput(token: 'tok', httpClient: _replicate(), player: player).speak('😊');
      expect(player.played, isEmpty);
    });
  });

  group('TtsSettings', () {
    test('Replicate only speaks when it is chosen and has a token', () {
      expect(const TtsSettings().effectiveEngine, TtsEngine.system);
      expect(const TtsSettings(engine: TtsEngine.replicate).effectiveEngine, TtsEngine.system);
      expect(const TtsSettings(engine: TtsEngine.replicate, replicateToken: ' t ').effectiveEngine, TtsEngine.replicate);
      expect(const TtsSettings(voice: '  ').effectiveVoice, defaultReplicateVoice);
    });

    test('are stored and read back, and a missing or broken value gives the defaults', () async {
      expect((await TtsSettingsStore.load()).engine, TtsEngine.system);
      await TtsSettingsStore.save(const TtsSettings(engine: TtsEngine.replicate, voice: 'V', speed: 1.3, replicateToken: 'tk'));
      final back = await TtsSettingsStore.load();
      expect([back.engine, back.voice, back.speed, back.replicateToken], [TtsEngine.replicate, 'V', 1.3, 'tk']);

      SharedPreferences.setMockInitialValues({'yggdrasil_pref_tts_settings': 'not json'});
      expect((await TtsSettingsStore.load()).engine, TtsEngine.system);
    });

    test('the speed is kept within the supported range', () {
      expect(TtsSettings.fromJson({'speed': 9}).speed, 2.0);
      expect(TtsSettings.fromJson({'speed': 0.1}).speed, 0.5);
    });
  });
}
