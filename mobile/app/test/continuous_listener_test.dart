import 'package:app/voice/continuous_listener.dart';
import 'package:app/voice/speech_locale.dart';
import 'package:app/voice/speech_recognizer_port.dart';
import 'package:flutter_test/flutter_test.dart';

/// One scripted recognizer session: what the "recognizer" does after listen().
typedef _Session = void Function(_FakeRecognizer r);

class _FakeRecognizer implements SpeechRecognizerPort {
  final List<_Session> sessions;
  final bool available;
  final List<String> locales;
  var _listening = false;
  var started = 0;
  var cancels = 0;
  String? lastLocale;
  late void Function(String) onError;
  late void Function(String) onStatus;
  void Function(String, bool)? _onResult;
  void Function(double)? _onLevel;

  _FakeRecognizer(this.sessions, {this.available = true, this.locales = const ['es-ES']});

  @override
  bool get isListening => _listening;

  @override
  Future<bool> initialize({required void Function(String errorMsg) onError, required void Function(String status) onStatus}) async {
    this.onError = onError;
    this.onStatus = onStatus;
    return available;
  }

  @override
  Future<List<String>> localeIds() async => locales;

  @override
  Future<void> listen({
    required String? localeId,
    required void Function(String words, bool isFinal) onResult,
    required void Function(double level) onSoundLevel,
    required Duration listenFor,
    required Duration pauseFor,
  }) async {
    lastLocale = localeId;
    _onResult = onResult;
    _onLevel = onSoundLevel;
    _listening = true;
    final script = sessions[started++];
    // Run the script after listen() returns, like the plugin's own callbacks.
    Future<void>.delayed(Duration.zero, () => script(this));
  }

  // --- script helpers
  void status(String s) {
    if (s != 'listening') _listening = false;
    onStatus(s);
  }

  void result(String words, {bool isFinal = false}) => _onResult?.call(words, isFinal);
  void level(double l) => _onLevel?.call(l);

  void error(String code) {
    _listening = false;
    onError(code);
  }

  @override
  Future<void> stop() async => _listening = false;

  @override
  Future<void> cancel() async {
    cancels++;
    _listening = false;
  }
}

ContinuousListener _listener(_FakeRecognizer r, {int maxIdle = 3, int maxFailures = 3, String language = 'es'}) => ContinuousListener(
      port: r,
      language: () => language,
      wait: (_) async {},
      maxIdleSessions: maxIdle,
      maxFailures: maxFailures,
    );

void main() {
  group('pickRecognitionLocale', () {
    test('prefers es-CL, then the other Spanish variants', () {
      expect(pickRecognitionLocale(['en-US', 'es-ES', 'es-CL'], 'es'), 'es-CL');
      expect(pickRecognitionLocale(['en-US', 'es-US', 'es-419'], 'es'), 'es-419');
    });

    test('falls back to any locale with the language prefix, then to the first one', () {
      expect(pickRecognitionLocale(['en-US', 'es-MX'], 'es'), 'es-MX');
      expect(pickRecognitionLocale(['fr-FR', 'de-DE'], 'es'), 'fr-FR');
      expect(pickRecognitionLocale(const [], 'es'), isNull);
    });

    test('English picks en-US over en-GB', () {
      expect(pickRecognitionLocale(['en-GB', 'en-US'], 'en'), 'en-US');
    });
  });

  group('ContinuousListener', () {
    test('returns the final transcript of one utterance and passes partials and levels on', () async {
      final r = _FakeRecognizer([
        (r) {
          r.status('listening');
          r.level(3);
          r.result('hola');
          r.result('hola qué tal', isFinal: true);
          r.status('done');
        },
      ]);
      final partials = <String>[];
      final levels = <double>[];
      final result = await _listener(r).listenForUtterance(onPartial: partials.add, onLevel: levels.add);
      expect(result, isA<Heard>().having((h) => h.text, 'text', 'hola qué tal'));
      expect(partials, ['hola', 'hola qué tal']);
      expect(levels, [3]);
      expect(r.lastLocale, 'es-ES');
    });

    test('uses the words heard when the session ends without a final result', () async {
      final r = _FakeRecognizer([
        (r) {
          r.status('listening');
          r.result('quiero un café');
          r.status('notListening');
          r.status('done');
        },
      ]);
      final result = await _listener(r).listenForUtterance();
      expect(result, isA<Heard>().having((h) => h.text, 'text', 'quiero un café'));
    });

    test('keeps listening through silence and no-match until the user speaks', () async {
      final r = _FakeRecognizer([
        (r) => r.error('error_speech_timeout'),
        (r) => r.error('error_no_match'),
        (r) {
          r.status('listening');
          r.result('ahora sí', isFinal: true);
        },
      ]);
      final result = await _listener(r, maxIdle: 5).listenForUtterance();
      expect(result, isA<Heard>().having((h) => h.text, 'text', 'ahora sí'));
      expect(r.started, 3);
    });

    test('a quiet session ending on its own counts as silence too', () async {
      final r = _FakeRecognizer([
        (r) {
          r.status('listening');
          r.status('notListening');
          r.status('done');
        },
        (r) {
          r.status('listening');
          r.result('hola', isFinal: true);
        },
      ]);
      expect(await _listener(r).listenForUtterance(), isA<Heard>());
      expect(r.started, 2);
    });

    test('words heard before a no-match error are not lost', () async {
      final r = _FakeRecognizer([
        (r) {
          r.status('listening');
          r.result('buenas');
          r.error('error_no_match');
        },
      ]);
      expect(await _listener(r).listenForUtterance(), isA<Heard>().having((h) => h.text, 'text', 'buenas'));
    });

    test('returns Idle after too many sessions with nothing said', () async {
      final r = _FakeRecognizer([
        (r) => r.error('error_speech_timeout'),
        (r) => r.error('error_speech_timeout'),
        (r) => r.error('error_speech_timeout'),
      ]);
      expect(await _listener(r, maxIdle: 3).listenForUtterance(), isA<Idle>());
      expect(r.started, 3);
    });

    test('a leftover "done" from the previous session does not end the new one', () async {
      final r = _FakeRecognizer([
        (r) {
          r.status('done'); // belongs to the session before; this one has not started
          r.status('listening');
          r.result('sigo aquí', isFinal: true);
        },
      ]);
      expect(await _listener(r).listenForUtterance(), isA<Heard>().having((h) => h.text, 'text', 'sigo aquí'));
      expect(r.started, 1);
    });

    test('busy and network errors are retried, then reported as a failure', () async {
      final busy = _FakeRecognizer([
        (r) => r.error('error_busy'),
        (r) => r.error('error_busy'),
        (r) => r.error('error_busy'),
      ]);
      expect(await _listener(busy).listenForUtterance(), isA<Failed>().having((f) => f.kind, 'kind', ListenFailureKind.busy));
      expect(busy.started, 3);

      final recovers = _FakeRecognizer([
        (r) => r.error('error_network'),
        (r) {
          r.status('listening');
          r.result('ya volvió', isFinal: true);
        },
      ]);
      expect(await _listener(recovers).listenForUtterance(), isA<Heard>());
    });

    test('permission and missing language pack fail at once', () async {
      final perm = _FakeRecognizer([(r) => r.error('error_permission')]);
      expect(await _listener(perm).listenForUtterance(), isA<Failed>().having((f) => f.kind, 'kind', ListenFailureKind.permission));
      expect(perm.started, 1);

      final lang = _FakeRecognizer([(r) => r.error('error_language_unavailable')]);
      expect(await _listener(lang).listenForUtterance(), isA<Failed>().having((f) => f.kind, 'kind', ListenFailureKind.languageUnavailable));
    });

    test('an unavailable recognizer fails without listening', () async {
      final r = _FakeRecognizer(const [], available: false);
      expect(await _listener(r).listenForUtterance(), isA<Failed>().having((f) => f.kind, 'kind', ListenFailureKind.recognizer));
      expect(r.started, 0);
    });

    test('a failure in between does not count against later sessions', () async {
      final r = _FakeRecognizer([
        (r) => r.error('error_busy'),
        (r) => r.error('error_speech_timeout'),
        (r) => r.error('error_busy'),
        (r) => r.error('error_speech_timeout'),
        (r) {
          r.status('listening');
          r.result('por fin', isFinal: true);
        },
      ]);
      expect(await _listener(r, maxIdle: 10, maxFailures: 2).listenForUtterance(), isA<Heard>());
    });

    test('cancel ends the wait with Cancelled and closes the microphone', () async {
      final r = _FakeRecognizer([(r) => r.status('listening')]);
      final listener = _listener(r);
      final pending = listener.listenForUtterance();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await listener.cancel();
      expect(await pending, isA<Cancelled>());
      expect(r.cancels, greaterThan(0));
    });

    test('can be used again after a cancel, with the same recognizer', () async {
      final r = _FakeRecognizer([
        (r) => r.status('listening'),
        (r) {
          r.status('listening');
          r.result('otra vez', isFinal: true);
        },
      ]);
      final listener = _listener(r);
      final first = listener.listenForUtterance();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await listener.cancel();
      expect(await first, isA<Cancelled>());
      expect(await listener.listenForUtterance(), isA<Heard>());
    });

    test('English picks an English locale', () async {
      final r = _FakeRecognizer([
        (r) {
          r.status('listening');
          r.result('hello', isFinal: true);
        },
      ], locales: const ['es-CL', 'en-US']);
      await _listener(r, language: 'en').listenForUtterance();
      expect(r.lastLocale, 'en-US');
    });
  });
}
