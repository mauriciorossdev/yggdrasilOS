import 'dart:async';

import '../l10n/app_strings.dart';
import 'speech_locale.dart';
import 'speech_recognizer_port.dart';

enum ListenFailureKind { permission, languageUnavailable, network, busy, recognizer }

/// How one [ContinuousListener.listenForUtterance] ended.
sealed class ListenResult {
  const ListenResult();
}

/// The user said something: [text] is the final transcript of the utterance.
class Heard extends ListenResult {
  final String text;
  const Heard(this.text);
}

/// Nobody spoke for a long while; the caller can ask whether to keep going.
class Idle extends ListenResult {
  const Idle();
}

/// [ContinuousListener.cancel] was called.
class Cancelled extends ListenResult {
  const Cancelled();
}

/// The recognizer can't be used (or kept failing).
class Failed extends ListenResult {
  final ListenFailureKind kind;
  final String message;
  const Failed(this.kind, this.message);
}

sealed class _Attempt {
  const _Attempt();
}

class _Text extends _Attempt {
  final String text;
  const _Text(this.text);
}

class _Silence extends _Attempt {
  const _Silence();
}

class _Error extends _Attempt {
  final String code;
  const _Error(this.code);
}

class _Stopped extends _Attempt {
  const _Stopped();
}

/// Something that waits for the user to say one thing, for a hands-free
/// conversation. [ContinuousListener] is the real one; a voice session takes
/// this interface so it can be tested with a scripted fake.
abstract class UtteranceSource {
  Future<ListenResult> listenForUtterance({void Function(String partial)? onPartial, void Function(double level)? onLevel});

  /// Ends the current wait with [Cancelled] and closes the microphone.
  Future<void> cancel();
}

/// Listens for one utterance at a time, for a hands-free conversation.
///
/// A single `speech_to_text` session is short and brittle (it ends on a pause or
/// after 30 s, and a quiet room just returns "no match"), so this turns it into
/// "wait until the user has said something": it restarts quietly after silence,
/// timeouts and no-match, backs off on busy/network errors, and only gives up
/// on the errors that can't be retried (permission, language pack) or after the
/// same failure keeps coming back. The caller owns the turn-taking: it listens
/// once per user turn and keeps the microphone closed while the assistant
/// thinks or speaks.
class ContinuousListener implements UtteranceSource {
  final SpeechRecognizerPort _port;
  final String Function() _language;
  final Future<void> Function(Duration) _wait;

  /// A pause this long after the user stops talking ends the utterance.
  final Duration pauseFor;

  /// The longest a single recognizer session runs.
  final Duration listenFor;

  /// Pause before reopening the recognizer, to avoid "busy" errors and beeps.
  final Duration restartDelay;

  /// Sessions with nothing heard before [listenForUtterance] returns [Idle].
  final int maxIdleSessions;

  /// Consecutive failing sessions before [listenForUtterance] returns [Failed].
  final int maxFailures;

  /// How long to wait for a late final result after the recognizer reports it is done.
  final Duration statusGrace;

  bool _initialized = false;
  bool _cancelled = false;
  void Function(String code)? _onError;
  void Function(String status)? _onStatus;
  void Function()? _stopAttempt;

  ContinuousListener({
    required SpeechRecognizerPort port,
    String Function()? language,
    Future<void> Function(Duration)? wait,
    this.pauseFor = const Duration(milliseconds: 2500),
    this.listenFor = const Duration(seconds: 30),
    this.restartDelay = const Duration(milliseconds: 300),
    this.maxIdleSessions = 8,
    this.maxFailures = 3,
    this.statusGrace = const Duration(milliseconds: 300),
  })  : _port = port, // ignore: prefer_initializing_formals
        _language = language ?? (() => AppStrings.current),
        _wait = wait ?? Future.delayed;

  /// Waits for the user to say something. [onPartial] gets the words as they are
  /// recognized and [onLevel] the sound level (for an animation).
  @override
  Future<ListenResult> listenForUtterance({void Function(String partial)? onPartial, void Function(double level)? onLevel}) async {
    _cancelled = false;
    if (!_initialized) {
      final available = await _port.initialize(
        onError: (code) => _onError?.call(code),
        onStatus: (status) => _onStatus?.call(status),
      );
      if (!available) return const Failed(ListenFailureKind.recognizer, 'speech recognition is not available');
      _initialized = true;
    }
    if (_cancelled) return const Cancelled();
    final localeId = pickRecognitionLocale(await _port.localeIds(), _language());

    var idle = 0;
    var failures = 0;
    while (!_cancelled) {
      final attempt = await _attempt(localeId, onPartial, onLevel);
      if (_cancelled || attempt is _Stopped) break;
      switch (attempt) {
        case _Text(:final text):
          return Heard(text);
        case _Silence():
          failures = 0;
          if (++idle >= maxIdleSessions) return const Idle();
        case _Error(:final code):
          final kind = _classify(code);
          if (kind == null) {
            // timeout / no match: ordinary silence.
            failures = 0;
            if (++idle >= maxIdleSessions) return const Idle();
          } else if (kind == ListenFailureKind.permission || kind == ListenFailureKind.languageUnavailable) {
            return Failed(kind, code);
          } else {
            if (++failures >= maxFailures) return Failed(kind, code);
            await _wait(Duration(milliseconds: 400 * failures));
          }
        case _Stopped():
          break;
      }
      if (_cancelled) break;
      await _wait(restartDelay);
    }
    return const Cancelled();
  }

  @override
  Future<void> cancel() async {
    _cancelled = true;
    _stopAttempt?.call();
    try {
      await _port.cancel();
    } catch (_) {}
  }

  // null = not a failure (silence); otherwise what kind of failure it is.
  static ListenFailureKind? _classify(String code) {
    switch (code) {
      case 'error_speech_timeout':
      case 'error_no_match':
        return null;
      case 'error_permission':
      case 'error_insufficient_permissions':
        return ListenFailureKind.permission;
      case 'error_language_unavailable':
      case 'error_language_not_supported':
        return ListenFailureKind.languageUnavailable;
      case 'error_busy':
        return ListenFailureKind.busy;
      case 'error_network':
      case 'error_network_timeout':
      case 'error_server':
      case 'error_server_disconnected':
      case 'error_too_many_requests':
        return ListenFailureKind.network;
      default:
        return ListenFailureKind.recognizer;
    }
  }

  Future<_Attempt> _attempt(String? localeId, void Function(String)? onPartial, void Function(double)? onLevel) {
    final done = Completer<_Attempt>();
    var heard = '';
    var started = false;
    void finish(_Attempt a) {
      if (!done.isCompleted) done.complete(a);
    }

    _onError = (code) {
      final quiet = code == 'error_speech_timeout' || code == 'error_no_match';
      // Words heard before a timeout or no-match are still an utterance.
      finish(quiet && heard.isNotEmpty ? _Text(heard) : _Error(code));
    };
    _onStatus = (status) {
      if (status == 'listening') started = true;
      if (status != 'done' && status != 'notListening') return;
      // A "done" left over from the previous session can arrive after this one
      // began; only a session that has started listening can be finished by one.
      if (!started && heard.isEmpty) return;
      // The final result can land just after the status; give it a moment.
      unawaited(_wait(statusGrace).then((_) => finish(heard.isNotEmpty ? _Text(heard) : const _Silence())));
    };
    _stopAttempt = () => finish(const _Stopped());

    final guard = Timer(listenFor + const Duration(seconds: 3), () => finish(heard.isNotEmpty ? _Text(heard) : const _Silence()));

    _port
        .listen(
          localeId: localeId,
          onResult: (words, isFinal) {
            if (words.trim().isNotEmpty) {
              heard = words.trim();
              onPartial?.call(heard);
            }
            if (isFinal && heard.isNotEmpty) finish(_Text(heard));
          },
          onSoundLevel: (level) => onLevel?.call(level),
          listenFor: listenFor,
          pauseFor: pauseFor,
        )
        .catchError((Object e) => finish(_Error('error_client')));

    return done.future.whenComplete(() async {
      guard.cancel();
      _onError = null;
      _onStatus = null;
      _stopAttempt = null;
      if (_port.isListening) {
        try {
          await _port.cancel();
        } catch (_) {}
      }
    });
  }
}
