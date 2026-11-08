import 'dart:async';

import 'package:flutter/foundation.dart';

import 'continuous_listener.dart';
import 'speech_output.dart';

enum VoiceState { listening, thinking, speaking, paused, ended }

/// Why a session is [VoiceState.paused]: the user muted it, the app went to the
/// background, or nobody spoke for a long while.
enum VoicePauseReason { muted, background, idle }

/// One hands-free voice conversation: listen, send what was said, speak the
/// reply, listen again. The microphone is only open while the session is
/// [VoiceState.listening]; it is closed while the assistant thinks and speaks,
/// so the recognizer never hears the assistant's own voice.
///
/// Everything it talks to is injected (the listener, the voice, the function
/// that gets a reply) so the turn-taking is tested with fakes. The UI listens to
/// the notifiers and calls [pause], [resume], [interrupt] and [end].
class VoiceSession {
  final UtteranceSource listener;
  final SpeechOutput output;

  /// Speaks instead when [output] fails (the phone's own voice, say).
  final SpeechOutput? fallbackOutput;

  /// Sends what the user said and returns the assistant's answer.
  final Future<String> Function(String userText) ask;

  /// What is said out loud when [ask] fails.
  final String Function() replyFailedText;
  final Future<void> Function(Duration) _wait;

  /// Pause after the assistant stops talking before the microphone reopens, so
  /// the recognizer doesn't catch the tail of the speech.
  final Duration tailDelay;

  final ValueNotifier<VoiceState> state = ValueNotifier(VoiceState.paused);

  /// What the user has said so far in the current utterance.
  final ValueNotifier<String> partial = ValueNotifier('');
  final ValueNotifier<String> lastUserText = ValueNotifier('');
  final ValueNotifier<String> lastReply = ValueNotifier('');

  /// Microphone level while listening (for an animation).
  final ValueNotifier<double> level = ValueNotifier(0);

  /// Set when the session ended because the recognizer failed for good.
  Failed? failure;

  /// Set when speaking failed (and the fallback, if any, did too).
  String? speakError;

  VoicePauseReason? _pauseReason;
  Completer<void>? _resume;
  bool _running = false;

  VoiceSession({
    required this.listener,
    required this.output,
    this.fallbackOutput,
    required this.ask,
    required this.replyFailedText,
    Future<void> Function(Duration)? wait,
    this.tailDelay = const Duration(milliseconds: 400),
  }) : _wait = wait ?? Future.delayed;

  VoicePauseReason? get pauseReason => _pauseReason;
  bool get running => _running;

  /// Runs the conversation until [end] is called or the recognizer fails.
  Future<void> run() async {
    if (_running) return;
    _running = true;
    try {
      while (_running) {
        if (_pauseReason != null) {
          state.value = VoiceState.paused;
          await (_resume = Completer<void>()).future;
          continue;
        }
        state.value = VoiceState.listening;
        partial.value = '';
        final result = await listener.listenForUtterance(
          onPartial: (t) => partial.value = t,
          onLevel: (l) => level.value = l,
        );
        if (!_running) break;
        if (_pauseReason != null) continue; // paused while listening
        switch (result) {
          case Heard(:final text):
            await _turn(text);
          case Idle():
            _pause(VoicePauseReason.idle);
          case Failed():
            failure = result;
            _running = false;
          case Cancelled():
            // Nothing asked for it (a pause or end would have said so): don't spin.
            _running = false;
        }
      }
    } finally {
      _running = false;
      state.value = VoiceState.ended;
    }
  }

  Future<void> _turn(String text) async {
    lastUserText.value = text;
    partial.value = '';
    state.value = VoiceState.thinking;
    var failed = false;
    var reply = '';
    try {
      reply = await ask(text);
    } catch (_) {
      failed = true;
    }
    if (!_running) return;
    if (!failed) lastReply.value = reply;
    final toSpeak = failed ? replyFailedText() : reply;
    // Paused while thinking: the reply is kept on screen but not read aloud.
    if (_pauseReason != null || toSpeak.trim().isEmpty) return;

    state.value = VoiceState.speaking;
    speakError = null;
    try {
      await output.speak(toSpeak);
    } catch (e) {
      final fallback = fallbackOutput;
      if (fallback != null && _running && _pauseReason == null) {
        try {
          await fallback.speak(toSpeak);
        } catch (e2) {
          speakError = '$e2';
        }
      } else {
        speakError = '$e';
      }
    }
    if (_running && _pauseReason == null) await _wait(tailDelay);
  }

  /// Holds the conversation: closes the microphone and stops any speech.
  void pause([VoicePauseReason reason = VoicePauseReason.muted]) => _pause(reason);

  void _pause(VoicePauseReason reason) {
    if (!_running || _pauseReason != null) return;
    _pauseReason = reason;
    state.value = VoiceState.paused;
    unawaited(listener.cancel());
    unawaited(output.stop());
    unawaited(fallbackOutput?.stop());
  }

  void resume() {
    if (_pauseReason == null) return;
    _pauseReason = null;
    final waiting = _resume;
    _resume = null;
    if (waiting != null && !waiting.isCompleted) waiting.complete();
  }

  /// Cuts the assistant off while it speaks; the session goes back to listening.
  Future<void> interrupt() async {
    if (state.value != VoiceState.speaking) return;
    await output.stop();
    await fallbackOutput?.stop();
  }

  /// Ends the session for good.
  Future<void> end() async {
    if (!_running) {
      state.value = VoiceState.ended;
      return;
    }
    _running = false;
    _pauseReason = null;
    final waiting = _resume;
    if (waiting != null && !waiting.isCompleted) waiting.complete();
    await listener.cancel();
    await output.stop();
    await fallbackOutput?.stop();
  }

  void dispose() {
    state.dispose();
    partial.dispose();
    lastUserText.dispose();
    lastReply.dispose();
    level.dispose();
  }
}
