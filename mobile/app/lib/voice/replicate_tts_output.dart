import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:http/http.dart' as http;

import 'speakable_text.dart';
import 'speech_output.dart';

const _replicateBase = 'https://api.replicate.com/v1';
const replicateTtsModel = 'minimax/speech-2.8-turbo';

/// Plays one mp3 clip. Abstracted so the speech pipeline is testable without audio.
abstract class ClipPlayer {
  /// Completes when the clip ends or [stop] is called.
  Future<void> play(Uint8List mp3);
  Future<void> stop();
}

class AudioplayersClipPlayer implements ClipPlayer {
  final AudioPlayer _player = AudioPlayer();
  Completer<void>? _playing;

  @override
  Future<void> play(Uint8List mp3) async {
    // Listen for the end BEFORE playing: a short clip can finish immediately.
    final finished = Completer<void>();
    _playing = finished;
    final sub = _player.onPlayerComplete.listen((_) {
      if (!finished.isCompleted) finished.complete();
    });
    try {
      await _player.play(BytesSource(mp3, mimeType: 'audio/mpeg'));
      await finished.future.timeout(const Duration(minutes: 5), onTimeout: () {});
    } finally {
      await sub.cancel();
      if (identical(_playing, finished)) _playing = null;
    }
  }

  @override
  Future<void> stop() async {
    final playing = _playing;
    if (playing != null && !playing.isCompleted) playing.complete();
    try {
      await _player.stop();
    } catch (_) {}
  }
}

/// MiniMax speech through Replicate, called straight from the phone with the
/// user's own token (the same two-step call the gateway makes in
/// packages/gateway/src/tts.ts: a prediction held open with `Prefer: wait`,
/// then the audio downloaded from the URL it returns).
///
/// The reply comes back from the model whole, so it is spoken sentence by
/// sentence: while one clip plays the next is already being synthesized, which
/// gets the first words out after one short request instead of a long one.
class ReplicateTtsOutput implements SpeechOutput {
  final String token;
  final String voiceId;

  /// 1.0 is normal speed.
  final double speed;
  final http.Client _http;
  final ClipPlayer _player;
  int _generation = 0;
  bool _speaking = false;

  ReplicateTtsOutput({
    required this.token,
    this.voiceId = 'Spanish_FrankLady',
    this.speed = 1.0,
    http.Client? httpClient,
    ClipPlayer? player,
  })  : _http = httpClient ?? http.Client(),
        _player = player ?? AudioplayersClipPlayer();

  @override
  bool get speaking => _speaking;

  @override
  Future<void> speak(String text) async {
    final chunks = splitSentences(speakableText(text));
    if (chunks.isEmpty) return;
    final gen = ++_generation;
    _speaking = true;
    try {
      Future<Uint8List> next = synthesize(chunks.first);
      for (var i = 0; i < chunks.length; i++) {
        final clip = await next;
        if (gen != _generation) return;
        // Start the next request before playing, so it is ready when this clip ends.
        if (i + 1 < chunks.length) {
          next = synthesize(chunks[i + 1]);
          // A failure while this clip plays is reported when it's awaited, not here.
          unawaited(next.then((_) {}, onError: (_) {}));
        }
        await _player.play(clip);
        if (gen != _generation) return;
      }
    } finally {
      if (gen == _generation) _speaking = false;
    }
  }

  /// One chunk of text to mp3 bytes.
  Future<Uint8List> synthesize(String text) async {
    final res = await _http.post(
      Uri.parse('$_replicateBase/models/$replicateTtsModel/predictions'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
        // Hold the request open until the model finishes (about 60 s at most).
        'Prefer': 'wait',
      },
      body: jsonEncode({
        'input': {
          'text': text,
          'pitch': 0,
          'speed': speed,
          'volume': 1,
          'bitrate': 128000,
          'channel': 'mono',
          'emotion': 'neutral',
          'voice_id': voiceId,
          'sample_rate': 32000,
          'audio_format': 'mp3',
          'language_boost': 'Spanish',
          'subtitle_enable': false,
          'english_normalization': false,
        },
      }),
    );
    if (res.statusCode != 200 && res.statusCode != 201) {
      throw Exception('Replicate ${res.statusCode}: ${_truncate(res.body)}');
    }
    final prediction = jsonDecode(res.body) as Map<String, dynamic>;
    if (prediction['status'] != 'succeeded') {
      throw Exception('Replicate: ${prediction['error'] ?? prediction['status'] ?? 'unknown error'}');
    }
    final output = prediction['output'];
    final url = output is List ? (output.isEmpty ? null : output.first?.toString()) : output?.toString();
    if (url == null || url.isEmpty) throw Exception('Replicate returned no audio');
    final audio = await _http.get(Uri.parse(url));
    if (audio.statusCode != 200) throw Exception('Replicate audio download failed (${audio.statusCode})');
    if (audio.bodyBytes.isEmpty) throw Exception('Replicate returned empty audio');
    return audio.bodyBytes;
  }

  @override
  Future<void> stop() async {
    _generation++;
    _speaking = false;
    await _player.stop();
  }
}

String _truncate(String s) => s.length <= 200 ? s : '${s.substring(0, 200)}…';
