import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

enum TtsEngine { system, replicate }

const defaultReplicateVoice = 'Spanish_FrankLady';

/// How the assistant speaks: the phone's own voice, or Replicate's MiniMax
/// model called straight from the app. The Replicate token lives here, as the
/// other provider keys do (ConnectionProfile.apiKey).
class TtsSettings {
  final TtsEngine engine;

  /// Replicate voice id; blank = [defaultReplicateVoice].
  final String voice;

  /// 1.0 is normal speed.
  final double speed;
  final String replicateToken;

  const TtsSettings({
    this.engine = TtsEngine.system,
    this.voice = '',
    this.speed = 1.0,
    this.replicateToken = '',
  });

  bool get replicateReady => replicateToken.trim().isNotEmpty;

  /// What actually speaks: Replicate only when it's chosen AND has a token.
  TtsEngine get effectiveEngine => engine == TtsEngine.replicate && replicateReady ? TtsEngine.replicate : TtsEngine.system;

  String get effectiveVoice => voice.trim().isEmpty ? defaultReplicateVoice : voice.trim();

  TtsSettings copyWith({TtsEngine? engine, String? voice, double? speed, String? replicateToken}) => TtsSettings(
        engine: engine ?? this.engine,
        voice: voice ?? this.voice,
        speed: speed ?? this.speed,
        replicateToken: replicateToken ?? this.replicateToken,
      );

  factory TtsSettings.fromJson(Map<String, dynamic> json) => TtsSettings(
        engine: TtsEngine.values.firstWhere((e) => e.name == json['engine'], orElse: () => TtsEngine.system),
        voice: json['voice']?.toString() ?? '',
        speed: ((json['speed'] as num?)?.toDouble() ?? 1.0).clamp(0.5, 2.0),
        replicateToken: json['replicateToken']?.toString() ?? '',
      );

  Map<String, dynamic> toJson() => {
        'engine': engine.name,
        'voice': voice,
        'speed': speed,
        'replicateToken': replicateToken,
      };
}

class TtsSettingsStore {
  static const _key = 'yggdrasil_pref_tts_settings';

  static Future<TtsSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return const TtsSettings();
    try {
      return TtsSettings.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return const TtsSettings();
    }
  }

  static Future<void> save(TtsSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(settings.toJson()));
  }
}
