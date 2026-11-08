import 'package:speech_to_text/speech_to_text.dart';

/// What the continuous listener needs from a speech recognizer, so it can be
/// driven by a fake in tests without the plugin.
abstract class SpeechRecognizerPort {
  bool get isListening;

  /// False when the device has no usable recognizer. [onError] receives the
  /// plugin's error code (`error_no_match`, `error_busy`…) for whatever session
  /// is listening; [onStatus] receives `listening`, `notListening` or `done`.
  Future<bool> initialize({required void Function(String errorMsg) onError, required void Function(String status) onStatus});

  Future<List<String>> localeIds();

  /// Starts one recognition session. [onResult] gets the words so far and
  /// whether they are the final result of the session.
  Future<void> listen({
    required String? localeId,
    required void Function(String words, bool isFinal) onResult,
    required void Function(double level) onSoundLevel,
    required Duration listenFor,
    required Duration pauseFor,
  });

  Future<void> stop();
  Future<void> cancel();
}

/// [SpeechRecognizerPort] over the speech_to_text plugin.
class SpeechToTextPort implements SpeechRecognizerPort {
  final SpeechToText _stt;

  SpeechToTextPort([SpeechToText? stt]) : _stt = stt ?? SpeechToText();

  @override
  bool get isListening => _stt.isListening;

  @override
  Future<bool> initialize({required void Function(String errorMsg) onError, required void Function(String status) onStatus}) {
    return _stt.initialize(onError: (e) => onError(e.errorMsg), onStatus: onStatus);
  }

  @override
  Future<List<String>> localeIds() async => (await _stt.locales()).map((l) => l.localeId).toList();

  @override
  Future<void> listen({
    required String? localeId,
    required void Function(String words, bool isFinal) onResult,
    required void Function(double level) onSoundLevel,
    required Duration listenFor,
    required Duration pauseFor,
  }) async {
    await _stt.listen(
      onResult: (r) => onResult(r.recognizedWords, r.finalResult),
      onSoundLevelChange: onSoundLevel,
      listenOptions: SpeechListenOptions(
        partialResults: true,
        listenMode: ListenMode.dictation,
        listenFor: listenFor,
        pauseFor: pauseFor,
        localeId: localeId,
      ),
    );
  }

  @override
  Future<void> stop() => _stt.stop();

  @override
  Future<void> cancel() => _stt.cancel();
}
