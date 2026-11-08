import 'package:flutter_tts/flutter_tts.dart';

import 'speakable_text.dart';
import 'speech_output.dart';

/// The phone's own text-to-speech engine: free, offline, no latency.
class SystemTtsOutput implements SpeechOutput {
  final FlutterTts _tts;
  final String locale;

  /// 1.0 is normal speed.
  final double speed;
  bool _configured = false;
  bool _speaking = false;

  SystemTtsOutput({this.locale = 'es', this.speed = 1.0, FlutterTts? tts}) : _tts = tts ?? FlutterTts();

  @override
  bool get speaking => _speaking;

  Future<void> _configure() async {
    if (_configured) return;
    await _tts.awaitSpeakCompletion(true);
    await _tts.setLanguage(await _pickLanguage());
    // flutter_tts on Android: 0.5 is the engine's normal rate.
    await _tts.setSpeechRate((0.5 * speed).clamp(0.1, 1.0));
    _configured = true;
  }

  // Prefer the Chilean voice, then any Spanish; English follows the app language.
  Future<String> _pickLanguage() async {
    final candidates = locale == 'en' ? const ['en-US', 'en-GB'] : const ['es-CL', 'es-419', 'es-ES', 'es-US'];
    for (final c in candidates) {
      try {
        if (await _tts.isLanguageAvailable(c) == true) return c;
      } catch (_) {}
    }
    return candidates.last;
  }

  @override
  Future<void> speak(String text) async {
    final clean = speakableText(text);
    if (clean.isEmpty) return;
    await _configure();
    _speaking = true;
    try {
      // With awaitSpeakCompletion(true) this returns when the speech ends or is stopped.
      await _tts.speak(clean);
    } finally {
      _speaking = false;
    }
  }

  @override
  Future<void> stop() async {
    _speaking = false;
    try {
      await _tts.stop();
    } catch (_) {}
  }
}
