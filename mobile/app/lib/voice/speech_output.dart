import 'replicate_tts_output.dart';
import 'system_tts_output.dart';
import 'tts_settings.dart';

/// Something that can say text out loud.
abstract class SpeechOutput {
  bool get speaking;

  /// Speaks [text] and completes when it has finished, or was stopped. Throws
  /// when the engine fails (no network, bad token…) so the caller can tell the
  /// user or fall back to another voice.
  Future<void> speak(String text);

  /// Stops the current speech, if any; a pending [speak] completes.
  Future<void> stop();
}

/// The output [settings] ask for.
SpeechOutput createSpeechOutput(TtsSettings settings, {String locale = 'es'}) {
  return switch (settings.effectiveEngine) {
    TtsEngine.replicate => ReplicateTtsOutput(
        token: settings.replicateToken.trim(),
        voiceId: settings.effectiveVoice,
        speed: settings.speed,
      ),
    TtsEngine.system => SystemTtsOutput(locale: locale, speed: settings.speed),
  };
}
