import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../l10n/app_strings.dart';
import '../services/voice_trigger_bus.dart';
import '../theme/ygg_theme.dart';

enum _TriggerState { idle, errorPermission }

/// Voice-to-text mic button — home-screen-voice-input-ux.md §6. The trigger
/// itself is unchanged from §5 (idle/errorPermission, size/enabled as
/// before); what happens after a tap is now a single shared full-screen
/// bottom sheet (waveform + live transcript + Cancel) instead of the old
/// pulse-ring + inline timer/SnackBar, so home/chat/direct-chat show
/// byte-identical feedback. `showInlineFeedback` is gone (§6: "queda
/// obsoleto") — permission-denied still resolves on the button itself
/// (icon flips to mic_off/error, no sheet), everything else goes through
/// the sheet. Colors/timing/radii below are ported 1:1 from the
/// "Yggdrasil Mobile Prototype" Claude Design artboard (Main.dc.html,
/// voiceSheet state) — IBM Plex Mono/Figtree aren't bundled in this app,
/// so the sheet falls back to platform monospace/default sans rather than
/// pulling in a new font dependency for this one surface.
class VoiceMicButton extends StatefulWidget {
  final double size;
  final void Function(String text) onRecognized;
  final bool enabled;

  const VoiceMicButton({
    super.key,
    required this.size,
    required this.onRecognized,
    this.enabled = true,
  });

  @override
  State<VoiceMicButton> createState() => _VoiceMicButtonState();
}

class _VoiceMicButtonState extends State<VoiceMicButton> {
  final _speech = SpeechToText();
  _TriggerState _triggerState = _TriggerState.idle;

  // voice-stt-quality-investigation.md §1 — errorListener is registered once
  // per initialize() call but fires for whatever session is listening when
  // it's registered; _VoiceSheetView (created after initialize() succeeds)
  // listens to this to react to an in-flight session's error, since it
  // doesn't exist yet at the point initialize() is called.
  final _speechError = ValueNotifier<SpeechRecognitionError?>(null);

  // Global, not per-instance (voice-notification-shortcut-design.md §1.3) —
  // this widget remounts fresh on every screen (home/chat/direct-chat), so
  // an instance field can't tell "already acted on this bump" from "never
  // saw it" once the user navigates elsewhere. Tracks the highest
  // VoiceTriggerBus value any button instance has consumed so a later mount
  // doesn't replay an old trigger.
  static int _lastConsumedTrigger = 0;

  @override
  void initState() {
    super.initState();
    VoiceTriggerBus.trigger.addListener(_onBusChanged);
    // Cold start: the deep link's getInitialLink (main.dart) can fire before
    // any ComposerBar exists to hear it — addListener only catches changes
    // from here on, so also check whatever the bus already holds at mount.
    if (VoiceTriggerBus.trigger.value > _lastConsumedTrigger) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _onBusChanged());
    }
  }

  @override
  void dispose() {
    VoiceTriggerBus.trigger.removeListener(_onBusChanged);
    _speechError.dispose();
    if (_speech.isListening) _speech.stop();
    super.dispose();
  }

  // §1: the plugin always sends permanent:true regardless of error type
  // (SpeechToTextPlugin.kt bug, per the doc) — permanence isn't a usable
  // signal, so this switches on errorMsg instead. error_permission is the
  // one case handled here rather than by the sheet: it's the same dead-end
  // as a denied runtime permission, so it gets the same recovery UI
  // (_TriggerState.errorPermission — mic_off icon, tap opens Settings).
  void _handleSpeechError(SpeechRecognitionError error) {
    _speechError.value = error;
    if (error.errorMsg == 'error_permission' && mounted) {
      setState(() => _triggerState = _TriggerState.errorPermission);
    }
  }

  // §2 — resolves against whatever locale IDs this device's recognizer
  // actually offers (logged below) rather than assuming es-CL is always
  // present; falls back to any locale matching the app's language prefix,
  // then to the device default if even that's empty. Not cached across taps
  // on purpose: the user can change AppStrings' language in Settings between
  // one tap and the next, and the locales() roundtrip is cheap.
  Future<String?> _resolveLocaleId() async {
    final available = await _speech.locales();
    // TODO(frontend): confirm on the real Samsung what locale IDs
    // locales() actually returns for es-CL before trusting the candidate
    // order below (voice-stt-quality-investigation.md §2, open item).
    debugPrint('speech_to_text locales(): ${available.map((l) => l.localeId).join(', ')}');
    final ids = available.map((l) => l.localeId).toSet();
    final candidates = AppStrings.current == 'en'
        ? const ['en-US', 'en-GB']
        : const ['es-CL', 'es-ES', 'es-419', 'es-US'];
    for (final c in candidates) {
      if (ids.contains(c)) return c;
    }
    final prefix = AppStrings.current == 'en' ? 'en' : 'es';
    for (final id in ids) {
      if (id.startsWith(prefix)) return id;
    }
    return available.isEmpty ? null : available.first.localeId;
  }

  void _onBusChanged() {
    if (!mounted || VoiceTriggerBus.trigger.value <= _lastConsumedTrigger) return;
    _lastConsumedTrigger = VoiceTriggerBus.trigger.value;
    if (!widget.enabled) {
      // Triggered from the notification tray, not a manual tap on the
      // (visibly dimmed) button — the button's own silent no-op isn't a
      // strong enough signal here since the user isn't looking at it
      // (design doc §3).
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.t('voice.turnInProgress'))));
      return;
    }
    _onMicTap();
  }

  Future<void> _onMicTap() async {
    if (_triggerState == _TriggerState.errorPermission) {
      await openAppSettings();
      return;
    }
    if (!widget.enabled) return; // composer-blocked (a turn is in flight)

    final status = await Permission.microphone.request();
    if (!status.isGranted) {
      if (!mounted) return;
      setState(() => _triggerState = _TriggerState.errorPermission);
      return;
    }

    _speechError.value = null; // stale error from a previous session
    final available = await _speech.initialize(onError: _handleSpeechError);
    if (!available) {
      if (!mounted) return;
      await _VoiceSheet.showNotUnderstood(context);
      return;
    }

    final localeId = await _resolveLocaleId();
    if (!mounted) return;
    final text = await _VoiceSheet.showRecording(context, _speech, localeId: localeId, errorNotifier: _speechError);
    if (text != null && text.isNotEmpty) widget.onRecognized(text);
  }

  @override
  Widget build(BuildContext context) {
    final size = widget.size;
    final isError = _triggerState == _TriggerState.errorPermission;
    return Opacity(
      opacity: widget.enabled ? 1 : 0.4,
      child: Semantics(
        button: true,
        label: 'Grabar mensaje de voz',
        child: GestureDetector(
          onTap: _onMicTap,
          child: Container(
            width: size,
            height: size,
            decoration: const BoxDecoration(color: YggColors.cardFillHigh, shape: BoxShape.circle),
            child: Icon(
              isError ? Icons.mic_off : Icons.mic,
              color: isError ? YggColors.errorRed : YggColors.text,
              size: size * 0.35,
            ),
          ),
        ),
      ),
    );
  }
}

enum _SheetMode { recording, processing, notUnderstood }

/// Full-screen bottom-sheet overlay — dark/blurred backdrop + rounded card,
/// shown via showGeneralDialog so it renders above whatever screen the
/// trigger button lives on (home, chat, direct-chat) without each of them
/// needing their own Stack/Overlay plumbing.
class _VoiceSheet {
  static Future<String?> showRecording(
    BuildContext context,
    SpeechToText speech, {
    String? localeId,
    ValueNotifier<SpeechRecognitionError?>? errorNotifier,
  }) {
    return showGeneralDialog<String>(
      context: context,
      barrierColor: Colors.transparent,
      barrierDismissible: false,
      transitionDuration: const Duration(milliseconds: 300),
      pageBuilder: (ctx, anim, secondaryAnim) => _VoiceSheetView(
        speech: speech,
        initialMode: _SheetMode.recording,
        localeId: localeId,
        errorNotifier: errorNotifier,
      ),
      transitionBuilder: (ctx, anim, _, child) => FadeTransition(opacity: anim, child: child),
    );
  }

  static Future<String?> showNotUnderstood(BuildContext context) {
    return showGeneralDialog<String>(
      context: context,
      barrierColor: Colors.transparent,
      barrierDismissible: false,
      transitionDuration: const Duration(milliseconds: 300),
      pageBuilder: (ctx, anim, secondaryAnim) => const _VoiceSheetView(speech: null, initialMode: _SheetMode.notUnderstood),
      transitionBuilder: (ctx, anim, _, child) => FadeTransition(opacity: anim, child: child),
    );
  }
}

class _VoiceSheetView extends StatefulWidget {
  final SpeechToText? speech;
  final _SheetMode initialMode;
  final String? localeId;
  final ValueNotifier<SpeechRecognitionError?>? errorNotifier;

  const _VoiceSheetView({
    required this.speech,
    required this.initialMode,
    this.localeId,
    this.errorNotifier,
  });

  @override
  State<_VoiceSheetView> createState() => _VoiceSheetViewState();
}

class _VoiceSheetViewState extends State<_VoiceSheetView> with TickerProviderStateMixin {
  static const _cardBg = Color(0xFF00302B);
  static const _accent = Color(0xFFC9A54E);

  // width(ms), delay(ms) per bar — ported from the artboard's 7 `ygg-bar`
  // animations (each an infinite ease-in-out scaleY 0.25→1→0.25).
  static const _barDurationsMs = [820, 1050, 680, 1180, 740, 950, 860];
  static const _barDelaysMs = [0, 120, 220, 50, 300, 180, 400];

  late _SheetMode _mode;
  late final List<AnimationController> _barControllers;
  Timer? _maxDurationTimer;
  Timer? _autoCloseTimer;
  String _liveText = '';

  // §1 — set when errorNotifier fires with a mapped error while recording;
  // null keeps the generic voice.notUnderstood fallback (§4b also lands
  // here for the empty-text-and-silence case, without going through
  // errorNotifier at all — the plugin doesn't always emit onError, e.g. the
  // user cuts the session short by tapping the backdrop).
  String? _errorMessageKey;

  // §4b — tracks whether any real audio was heard this session so
  // _stopAndTranscribe can tell "silence" from "heard you, didn't
  // understand" even when the plugin never calls onError for it.
  bool _heardAnySound = false;
  static const _soundHeardThresholdDb = -2.0; // TODO(frontend): calibrate on real device, see §4

  // §4a — real waveform: modulates the decorative per-bar animation by the
  // actual level from onSoundLevelChange instead of leaving the bars purely
  // cosmetic. ValueNotifier (not setState) so only _waveform()'s
  // AnimatedBuilder rebuilds per audio frame, not the whole sheet. Range is
  // the plugin's typical Android dB span noted in the doc (~-2 to ~10+); a
  // ValueNotifier because setState-per-frame would also thrash _liveText's
  // Text widget for no reason.
  final ValueNotifier<double> _soundLevel = ValueNotifier<double>(-2.0);
  static const _soundLevelFloorDb = -2.0;
  static const _soundLevelSpanDb = 12.0;

  @override
  void initState() {
    super.initState();
    _mode = widget.initialMode;
    _barControllers = List.generate(
      7,
      (i) => AnimationController(vsync: this, duration: Duration(milliseconds: _barDurationsMs[i] ~/ 2)),
    );
    if (_mode == _SheetMode.recording) {
      for (var i = 0; i < 7; i++) {
        Future.delayed(Duration(milliseconds: _barDelaysMs[i]), () {
          if (mounted) _barControllers[i].repeat(reverse: true);
        });
      }
      widget.errorNotifier?.addListener(_onSpeechError);
      _startListening();
    } else {
      _scheduleAutoClose();
    }
  }

  @override
  void dispose() {
    for (final c in _barControllers) {
      c.dispose();
    }
    widget.errorNotifier?.removeListener(_onSpeechError);
    _maxDurationTimer?.cancel();
    _autoCloseTimer?.cancel();
    _soundLevel.dispose();
    super.dispose();
  }

  // §1 — error_permission is handled one level up by VoiceMicButton itself
  // (flips the trigger button to its own error state), so this just closes
  // the sheet for that case instead of also showing a message here.
  void _onSpeechError() {
    final error = widget.errorNotifier?.value;
    if (!mounted || error == null || _mode != _SheetMode.recording) return;
    _maxDurationTimer?.cancel();
    widget.speech?.stop();
    if (error.errorMsg == 'error_permission') {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _mode = _SheetMode.notUnderstood;
      _errorMessageKey = _keyForError(error.errorMsg);
    });
    _scheduleAutoClose();
  }

  String? _keyForError(String errorMsg) {
    switch (errorMsg) {
      case 'error_speech_timeout':
        return 'voice.error.silence';
      case 'error_no_match':
        return 'voice.error.noMatch';
      case 'error_network':
      case 'error_network_timeout':
      case 'error_server':
      case 'error_server_disconnected':
        return 'voice.error.network';
      case 'error_busy':
      case 'error_too_many_requests':
        return 'voice.error.busy';
      // §5 — SODA on-device language pack not downloaded/failed to load for
      // the requested locale (confirmed on real hardware via logcat:
      // "Failed to get language pack of required locale: error 13" ==
      // SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE). Distinct from
      // error_language_not_supported (locale doesn't exist on the device at
      // all, §2's problem, stays in the generic fallback) — this one is a
      // valid locale whose pack just isn't there yet, transient/actionable.
      case 'error_language_unavailable':
        return 'voice.error.languageUnavailable';
      default:
        return null; // error_audio_error/error_client/error_language_not_supported/error_unknown — generic fallback
    }
  }

  void _onLevel(double level) {
    if (!_heardAnySound && level > _soundHeardThresholdDb) {
      _heardAnySound = true;
    }
    _soundLevel.value = level;
  }

  void _startListening() {
    final speech = widget.speech!;
    _maxDurationTimer = Timer(const Duration(seconds: 30), _stopAndTranscribe);
    speech.listen(
      onResult: (result) {
        if (!mounted) return;
        setState(() => _liveText = result.recognizedWords);
      },
      onSoundLevelChange: _onLevel,
      listenOptions: SpeechListenOptions(
        partialResults: true,
        listenMode: ListenMode.dictation,
        listenFor: const Duration(seconds: 30),
        pauseFor: const Duration(seconds: 5),
        localeId: widget.localeId,
      ),
    );
  }

  Future<void> _stopAndTranscribe() async {
    if (_mode != _SheetMode.recording) return;
    _maxDurationTimer?.cancel();
    setState(() => _mode = _SheetMode.processing);
    await widget.speech?.stop();
    if (!mounted) return;
    // Short minimum-visible delay so the spinner doesn't just flash —
    // matches the artboard's 700ms processing→auto-submit timeout.
    await Future.delayed(const Duration(milliseconds: 350));
    if (!mounted) return;
    final text = _liveText.trim();
    if (text.isEmpty) {
      setState(() {
        _mode = _SheetMode.notUnderstood;
        // §4b — no onError necessarily fired (e.g. cut short via backdrop
        // tap before the recognizer detected anything), so this is the
        // fallback signal for "never heard you" vs. "heard you, no match".
        _errorMessageKey = _heardAnySound ? null : 'voice.error.silence';
      });
      _scheduleAutoClose();
      return;
    }
    Navigator.of(context).pop(text);
  }

  void _scheduleAutoClose() {
    _autoCloseTimer?.cancel();
    _autoCloseTimer = Timer(const Duration(milliseconds: 2500), () {
      if (mounted) Navigator.of(context).pop();
    });
  }

  void _cancel() {
    if (_mode == _SheetMode.recording) widget.speech?.stop();
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 6, sigmaY: 6),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              // Tapping the backdrop (or the card, below) while recording
              // stops early — with the trigger button hidden under the
              // sheet, this is the "tap again" path §6 describes.
              onTap: _mode == _SheetMode.recording ? _stopAndTranscribe : null,
              child: Container(color: const Color.fromRGBO(0, 32, 29, 0.72)),
            ),
          ),
        ),
        Align(
          alignment: Alignment.bottomCenter,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 0, 10, 14),
              child: TweenAnimationBuilder<Offset>(
                tween: Tween(begin: const Offset(0, 10), end: Offset.zero),
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeOut,
                builder: (context, offset, child) => Transform.translate(offset: offset, child: child),
                child: GestureDetector(
                  onTap: _mode == _SheetMode.recording ? _stopAndTranscribe : null,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(24, 30, 24, 26),
                    decoration: BoxDecoration(
                      color: _cardBg,
                      borderRadius: BorderRadius.circular(34),
                      border: Border.all(color: const Color.fromRGBO(244, 239, 230, 0.12)),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ..._content(),
                        const SizedBox(height: 22),
                        _cancelButton(),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _content() {
    switch (_mode) {
      case _SheetMode.recording:
        return [
          _label(AppStrings.t('voice.listening')),
          const SizedBox(height: 22),
          _waveform(),
          const SizedBox(height: 22),
          Text(
            _liveText.isEmpty ? '…' : _liveText,
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w300, fontSize: 17, height: 1.4, color: Color.fromRGBO(244, 239, 230, 0.82)),
          ),
        ];
      case _SheetMode.processing:
        return [
          _label(AppStrings.t('voice.transcribing')),
          const SizedBox(height: 22),
          const Center(
            child: SizedBox(
              width: 34,
              height: 34,
              child: CircularProgressIndicator(strokeWidth: 2.5, color: _accent, backgroundColor: Color.fromRGBO(244, 239, 230, 0.18)),
            ),
          ),
        ];
      case _SheetMode.notUnderstood:
        return [
          Text(
            AppStrings.t(_errorMessageKey ?? 'voice.notUnderstood'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w300, fontSize: 17, height: 1.4, color: Color.fromRGBO(244, 239, 230, 0.82)),
          ),
        ];
    }
  }

  Widget _label(String text) => Text(
        text.toUpperCase(),
        textAlign: TextAlign.center,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5, letterSpacing: 1.5, color: _accent),
      );

  Widget _waveform() {
    return SizedBox(
      height: 56,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(7, (i) {
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 3),
            child: AnimatedBuilder(
              animation: Listenable.merge([_barControllers[i], _soundLevel]),
              builder: (context, child) {
                final levelFactor = ((_soundLevel.value - _soundLevelFloorDb) / _soundLevelSpanDb).clamp(0.0, 1.0);
                final baseScale = 0.25 + _barControllers[i].value * 0.75;
                final scaleY = baseScale * (0.5 + 0.5 * levelFactor);
                return Transform(
                  alignment: Alignment.center,
                  transform: Matrix4.diagonal3Values(1, scaleY, 1),
                  child: child,
                );
              },
              child: Container(width: 5, height: 56, decoration: BoxDecoration(color: _accent, borderRadius: BorderRadius.circular(999))),
            ),
          );
        }),
      ),
    );
  }

  Widget _cancelButton() {
    return GestureDetector(
      onTap: _cancel,
      child: Container(
        alignment: Alignment.center,
        height: 48,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: const Color.fromRGBO(244, 239, 230, 0.2)),
        ),
        child: Text(AppStrings.t('common.cancel'), style: const TextStyle(fontSize: 15, color: Color.fromRGBO(244, 239, 230, 0.7))),
      ),
    );
  }
}
