import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../l10n/app_strings.dart';
import '../profiles/connection_profile.dart';
import '../theme/ygg_theme.dart';
import 'continuous_listener.dart';
import 'speech_output.dart';
import 'speech_recognizer_port.dart';
import 'system_tts_output.dart';
import 'tts_settings.dart';
import 'voice_chat.dart';
import 'voice_orb.dart';
import 'voice_session.dart';

/// Builds the session a [VoiceModeScreen] runs; [confirm] is how it asks the user
/// before a tool that needs a go-ahead. Replaced in tests.
typedef VoiceSessionFactory = Future<VoiceSession> Function(
  Future<bool> Function(String toolName, Map<String, dynamic> args) confirm,
);

/// The voice mode: one continuous spoken conversation with the assistant, hands
/// free, with the screen kept on. The microphone listens, the answer is read
/// aloud, and a tap cuts the assistant off. The conversation is saved as a chat.
class VoiceModeScreen extends StatefulWidget {
  final ConnectionProfile profile;
  final VoiceSessionFactory? sessionFactory;

  /// Asks for the microphone permission; replaced in tests.
  final Future<bool> Function()? requestMic;

  const VoiceModeScreen({super.key, required this.profile, this.sessionFactory, this.requestMic});

  @override
  State<VoiceModeScreen> createState() => _VoiceModeScreenState();
}

class _VoiceModeScreenState extends State<VoiceModeScreen> with WidgetsBindingObserver {
  VoiceSession? _session;
  Future<void>? _run;
  bool _micDenied = false;
  Failed? _failure;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _boot();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    final session = _session;
    if (session != null) {
      unawaited(session.end());
      // The loop sets its last state as it unwinds: dispose the notifiers after that.
      final run = _run;
      if (run != null) {
        run.whenComplete(session.dispose);
      } else {
        session.dispose();
      }
    }
    _keepAwake(false);
    super.dispose();
  }

  Future<bool> _requestMic() async => (await Permission.microphone.request()).isGranted;

  Future<void> _boot() async {
    final granted = await (widget.requestMic ?? _requestMic)();
    if (!mounted) return;
    if (!granted) {
      setState(() => _micDenied = true);
      return;
    }
    final VoiceSession session;
    try {
      session = await (widget.sessionFactory ?? _defaultSession)(_confirmTool);
    } catch (e) {
      if (mounted) setState(() => _failure = Failed(ListenFailureKind.recognizer, '$e'));
      return;
    }
    if (!mounted) {
      await session.end();
      session.dispose();
      return;
    }
    setState(() => _session = session);
    _keepAwake(true);
    _run = session.run().whenComplete(() {
      if (mounted) setState(() => _failure = session.failure);
    });
  }

  Future<VoiceSession> _defaultSession(Future<bool> Function(String, Map<String, dynamic>) confirm) async {
    final settings = await TtsSettingsStore.load();
    final locale = AppStrings.current;
    final chat = await VoiceChat.start(widget.profile, confirm: confirm);
    return VoiceSession(
      listener: ContinuousListener(port: SpeechToTextPort()),
      output: createSpeechOutput(settings, locale: locale),
      // If the cloud voice fails mid-conversation, the phone's own voice carries on.
      fallbackOutput: settings.effectiveEngine == TtsEngine.replicate ? SystemTtsOutput(locale: locale, speed: settings.speed) : null,
      ask: chat.ask,
      replyFailedText: () => AppStrings.t('voice.mode.replyFailed'),
    );
  }

  // The screen has to stay on for a hands-free conversation; not every platform
  // (or test) has a wakelock, and that is no reason to fail.
  void _keepAwake(bool on) {
    try {
      on ? WakelockPlus.enable() : WakelockPlus.disable();
    } catch (_) {}
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final session = _session;
    if (session == null) return;
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      session.pause(VoicePauseReason.background);
    } else if (state == AppLifecycleState.resumed && session.pauseReason == VoicePauseReason.background) {
      session.resume();
    }
  }

  // The same gate the text chat shows before a tool that needs a go-ahead.
  Future<bool> _confirmTool(String toolName, Map<String, dynamic> args) async {
    if (!mounted) return false;
    final approved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: Text(AppStrings.t('dialog.confirmActionTitle')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(toolName.toUpperCase(), style: const TextStyle(fontFamily: YggFonts.mono, fontWeight: FontWeight.bold)),
            if (args.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(const JsonEncoder.withIndent('  ').convert(args), style: const TextStyle(fontFamily: YggFonts.mono, fontSize: 12)),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(AppStrings.t('common.reject'))),
          ElevatedButton(onPressed: () => Navigator.pop(context, true), child: Text(AppStrings.t('common.approve'))),
        ],
      ),
    );
    return approved ?? false;
  }

  Future<void> _end() async {
    await _session?.end();
    if (mounted) Navigator.of(context).maybePop();
  }

  void _onBodyTap() {
    final session = _session;
    if (session == null) return;
    if (session.state.value == VoiceState.speaking) {
      session.interrupt();
    } else if (session.pauseReason == VoicePauseReason.idle) {
      session.resume();
    }
  }

  void _toggleMute() {
    final session = _session;
    if (session == null) return;
    if (session.pauseReason == VoicePauseReason.muted) {
      session.resume();
    } else {
      session.pause(VoicePauseReason.muted);
    }
  }

  String _statusLabel(VoiceSession s) {
    return switch (s.state.value) {
      VoiceState.listening => AppStrings.t('voice.mode.listening'),
      VoiceState.thinking => AppStrings.t('voice.mode.thinking'),
      VoiceState.speaking => AppStrings.t('voice.mode.speaking'),
      VoiceState.paused => AppStrings.t(s.pauseReason == VoicePauseReason.idle ? 'voice.mode.pausedIdle' : 'voice.mode.paused'),
      VoiceState.ended => '',
    };
  }

  String _failureText(Failed f) {
    return AppStrings.t(switch (f.kind) {
      ListenFailureKind.permission => 'voice.mode.failPermission',
      ListenFailureKind.languageUnavailable => 'voice.mode.failLanguage',
      ListenFailureKind.network => 'voice.mode.failNetwork',
      ListenFailureKind.busy => 'voice.mode.failBusy',
      ListenFailureKind.recognizer => 'voice.mode.failRecognizer',
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: YggColors.bg,
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    if (_micDenied) {
      return _message(AppStrings.t('voice.mode.micDenied'), action: AppStrings.t('voice.mode.openSettings'), onAction: openAppSettings);
    }
    final failure = _failure;
    if (failure != null) {
      return _message(_failureText(failure), action: failure.kind == ListenFailureKind.permission ? AppStrings.t('voice.mode.openSettings') : null, onAction: openAppSettings);
    }
    final session = _session;
    if (session == null) return Center(child: CircularProgressIndicator(color: YggColors.accent));

    final merged = Listenable.merge([session.state, session.partial, session.lastReply, session.lastUserText, session.level]);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _onBodyTap,
      child: AnimatedBuilder(
        animation: merged,
        builder: (context, _) {
          final state = session.state.value;
          final muted = session.pauseReason == VoicePauseReason.muted;
          final heard = session.partial.value.isNotEmpty ? session.partial.value : '';
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                child: Row(
                  children: [
                    _roundButton(Icons.close, AppStrings.t('voice.mode.end'), _end),
                    Expanded(
                      child: Center(
                        child: Text(
                          AppStrings.t('voice.mode.title'),
                          style: TextStyle(fontFamily: YggFonts.mono, fontSize: 12, letterSpacing: 3, color: YggColors.accent),
                        ),
                      ),
                    ),
                    _roundButton(muted ? Icons.mic_off : Icons.mic_none, AppStrings.t(muted ? 'voice.mode.unmute' : 'voice.mode.mute'), _toggleMute,
                        active: muted),
                  ],
                ),
              ),
              const Spacer(flex: 2),
              VoiceOrb(state: state, level: session.level.value),
              const SizedBox(height: 18),
              Text(
                _statusLabel(session),
                style: TextStyle(fontFamily: YggFonts.mono, fontSize: 12, letterSpacing: 2, color: YggColors.textMuted),
              ),
              const SizedBox(height: 18),
              Expanded(
                flex: 3,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 28),
                  child: SingleChildScrollView(
                    child: Column(
                      children: [
                        if (heard.isNotEmpty)
                          Text(heard, textAlign: TextAlign.center, style: TextStyle(fontSize: 20, height: 1.4, color: YggColors.text))
                        else if (session.lastReply.value.isNotEmpty)
                          Text(
                            session.lastReply.value,
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 17, height: 1.5, fontWeight: FontWeight.w300, color: YggColors.text.withValues(alpha: 0.85)),
                          ),
                        if (session.speakError != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Text(AppStrings.t('voice.mode.speakFailed'), style: TextStyle(fontSize: 12.5, color: YggColors.danger)),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: 22),
                child: Text(
                  state == VoiceState.speaking ? AppStrings.t('voice.mode.tapToInterrupt') : '',
                  style: TextStyle(fontSize: 12.5, color: YggColors.textMuted),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _roundButton(IconData icon, String tooltip, VoidCallback onTap, {bool active = false}) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: active ? YggColors.accent : YggColors.cardFillHigh,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(width: 44, height: 44, child: Icon(icon, size: 20, color: active ? YggColors.onAccent : YggColors.text)),
        ),
      ),
    );
  }

  Widget _message(String text, {String? action, VoidCallback? onAction}) {
    return Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.mic_off_outlined, size: 40, color: YggColors.textMuted),
          const SizedBox(height: 16),
          Text(text, textAlign: TextAlign.center, style: TextStyle(fontSize: 16, height: 1.45, color: YggColors.text)),
          const SizedBox(height: 22),
          if (action != null) ...[
            ElevatedButton(onPressed: onAction, child: Text(action)),
            const SizedBox(height: 8),
          ],
          TextButton(onPressed: () => Navigator.of(context).maybePop(), child: Text(AppStrings.t('voice.mode.close'))),
        ],
      ),
    );
  }
}
