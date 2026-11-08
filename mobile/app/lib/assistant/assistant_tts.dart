import 'dart:async';
import 'dart:convert';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/yggdrasil_client.dart';
import '../voice/speakable_text.dart';

export '../voice/speakable_text.dart' show speakableText, ttsMaxChars;

/// Spoken replies for the assistant chat: settings (on/off, voice) plus
/// playback. Audio is synthesized by the gateway's `tts.synthesize` (Replicate
/// MiniMax) — no provider key on the phone.
class AssistantTts extends ChangeNotifier {
  AssistantTts._();
  static final AssistantTts instance = AssistantTts._();

  static const _kEnabled = 'assistant_tts_enabled';
  static const _kVoice = 'assistant_tts_voice';

  bool enabled = false;

  /// Empty = the gateway's default voice.
  String voiceId = '';
  bool speaking = false;
  String? lastError;

  final AudioPlayer _player = AudioPlayer();
  Completer<void>? _playing; // completes when the current clip ends or is stopped

  int _generation = 0;
  bool _loaded = false;

  Future<void> load() async {
    if (_loaded) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      enabled = prefs.getBool(_kEnabled) ?? false;
      voiceId = prefs.getString(_kVoice) ?? '';
    } catch (_) {
      // Defaults.
    }
    _loaded = true;
    notifyListeners();
  }

  Future<void> setEnabled(bool value) async {
    enabled = value;
    if (!value) await stop();
    notifyListeners();
    await _save();
  }

  Future<void> setVoiceId(String value) async {
    voiceId = value.trim();
    notifyListeners();
    await _save();
  }

  Future<void> _save() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_kEnabled, enabled);
      await prefs.setString(_kVoice, voiceId);
    } catch (_) {
      // Best effort.
    }
  }

  Future<void> stop() async {
    _generation++;
    speaking = false;
    _playing?.complete(); // unblock a speak() that is waiting for the clip to end
    try {
      await _player.stop();
    } catch (_) {}
    notifyListeners();
  }

  /// Synthesizes and plays [markdown]. A newer call (or [stop]) supersedes it.
  Future<void> speak(YggdrasilClient client, String markdown) async {
    final text = speakableText(markdown);
    if (text.isEmpty) return;
    final gen = ++_generation;
    speaking = true;
    lastError = null;
    notifyListeners();
    try {
      final res = await client.call(
        'tts.synthesize',
        {'text': text, if (voiceId.isNotEmpty) 'voiceId': voiceId},
        timeout: const Duration(seconds: 90),
      );
      if (gen != _generation) return;
      final b64 = res is Map ? res['audioBase64']?.toString() : null;
      if (b64 == null || b64.isEmpty) throw StateError('no audio');
      // Listen for the end BEFORE playing (a short clip can finish immediately) and
      // wait on a plain Completer: `onPlayerComplete.first.timeout(onTimeout: () {})`
      // threw a TypeError right after playback started, which made callers think
      // speech had failed and read the reply a second time with the fallback voice.
      final finished = Completer<void>();
      _playing = finished;
      final sub = _player.onPlayerComplete.listen((_) {
        if (!finished.isCompleted) finished.complete();
      });
      try {
        await _player.play(BytesSource(base64Decode(b64), mimeType: 'audio/mpeg'));
        if (gen != _generation) {
          await _player.stop();
          return;
        }
        await finished.future.timeout(const Duration(minutes: 10), onTimeout: () {});
      } finally {
        await sub.cancel();
        if (identical(_playing, finished)) _playing = null;
      }
    } catch (e) {
      if (gen == _generation) lastError = '$e';
    } finally {
      if (gen == _generation) {
        speaking = false;
        notifyListeners();
      }
    }
  }
}
