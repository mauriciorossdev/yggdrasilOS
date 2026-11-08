import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';
import '../voice/speech_output.dart';
import '../voice/tts_settings.dart';

/// Settings > Assistant voice: which engine speaks (the phone's own voice or
/// Replicate), its voice and speed, and a button to hear it.
class VoiceSettingsScreen extends StatefulWidget {
  const VoiceSettingsScreen({super.key});

  @override
  State<VoiceSettingsScreen> createState() => _VoiceSettingsScreenState();
}

class _VoiceSettingsScreenState extends State<VoiceSettingsScreen> {
  TtsSettings _settings = const TtsSettings();
  final _token = TextEditingController();
  final _voice = TextEditingController();
  SpeechOutput? _output;
  bool _loaded = false;
  bool _testing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _output?.stop();
    _token.dispose();
    _voice.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final settings = await TtsSettingsStore.load();
    if (!mounted) return;
    setState(() {
      _settings = settings;
      _token.text = settings.replicateToken;
      _voice.text = settings.voice;
      _loaded = true;
    });
  }

  void _update(TtsSettings settings) {
    setState(() => _settings = settings);
    TtsSettingsStore.save(settings);
  }

  Future<void> _test() async {
    if (_testing) {
      await _output?.stop();
      return;
    }
    setState(() {
      _testing = true;
      _error = null;
    });
    final output = _output = createSpeechOutput(_settings, locale: AppStrings.current);
    try {
      await output.speak(AppStrings.t('voice.settings.sample'));
    } catch (e) {
      if (mounted) setState(() => _error = '${AppStrings.t('voice.settings.failed')}: $e');
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  Widget _engineRow(TtsEngine engine, String title, String description) => YggListRow(
        title: title,
        subtitle: description,
        trailing: _settings.engine == engine ? Icon(Icons.check, color: YggColors.accent) : null,
        chevron: false,
        onTap: () => _update(_settings.copyWith(engine: engine)),
      );

  @override
  Widget build(BuildContext context) {
    final replicate = _settings.engine == TtsEngine.replicate;
    return YggScreen(
      title: AppStrings.t('voice.settings.title'),
      body: !_loaded
          ? Center(child: CircularProgressIndicator(color: YggColors.accent))
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: [
                YggSectionLabel(AppStrings.t('voice.settings.engine')),
                YggListGroup(
                  children: [
                    _engineRow(TtsEngine.system, AppStrings.t('voice.settings.system'), AppStrings.t('voice.settings.systemDesc')),
                    _engineRow(TtsEngine.replicate, 'Replicate', AppStrings.t('voice.settings.replicateDesc')),
                  ],
                ),
                if (replicate) ...[
                  const SizedBox(height: 22),
                  YggSectionLabel('Replicate'),
                  TextField(
                    controller: _token,
                    obscureText: true,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: InputDecoration(labelText: AppStrings.t('voice.settings.token')),
                    onChanged: (v) => _update(_settings.copyWith(replicateToken: v.trim())),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _voice,
                    autocorrect: false,
                    decoration: InputDecoration(
                      labelText: AppStrings.t('voice.settings.voice'),
                      hintText: defaultReplicateVoice,
                    ),
                    onChanged: (v) => _update(_settings.copyWith(voice: v.trim())),
                  ),
                  if (!_settings.replicateReady)
                    Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: Text(AppStrings.t('voice.settings.noToken'), style: TextStyle(fontSize: 12.5, color: YggColors.textMuted)),
                    ),
                ],
                const SizedBox(height: 22),
                YggSectionLabel(AppStrings.t('voice.settings.speed')),
                Row(
                  children: [
                    Expanded(
                      child: Slider(
                        value: _settings.speed.clamp(0.7, 1.5),
                        min: 0.7,
                        max: 1.5,
                        divisions: 8,
                        activeColor: YggColors.accent,
                        onChanged: (v) => setState(() => _settings = _settings.copyWith(speed: v)),
                        onChangeEnd: (v) => _update(_settings.copyWith(speed: v)),
                      ),
                    ),
                    SizedBox(
                      width: 44,
                      child: Text('${_settings.speed.toStringAsFixed(1)}x', style: TextStyle(fontFamily: YggFonts.mono, color: YggColors.textMuted)),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                YggListGroup(
                  children: [
                    YggListRow(
                      title: AppStrings.t(_testing ? 'voice.settings.speaking' : 'voice.settings.test'),
                      leading: Icon(_testing ? Icons.stop_circle_outlined : Icons.volume_up_outlined),
                      accent: true,
                      chevron: false,
                      onTap: _test,
                    ),
                  ],
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(_error!, style: TextStyle(fontSize: 12.5, color: YggColors.danger)),
                  ),
              ],
            ),
    );
  }
}
