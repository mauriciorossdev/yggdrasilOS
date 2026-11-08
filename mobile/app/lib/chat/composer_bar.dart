import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';
import 'voice_mic_button.dart';

/// Shared composer — pill input + trailing button that toggles between the
/// voice-input trigger (empty) and a send arrow (has text), per the
/// "Yggdrasil Mobile Prototype" artboard. One widget for home, gateway chat
/// and standalone chat so all three look byte-identical — the old separate
/// "Empezar" button + big standalone mic circle (home-screen-voice-input-ux.md
/// §1/§5) are gone: the artboard has no such button, just this composer.
class ComposerBar extends StatefulWidget {
  final TextEditingController? controller;
  final void Function(String text) onSubmit;
  final void Function(String text)? onChanged;
  final bool enabled;
  final String? hint;
  final bool showCaption;

  /// Shows a paperclip; returns text to insert into the input (e.g. an
  /// attachment reference) or null if nothing was attached.
  final Future<String?> Function()? onAttach;

  const ComposerBar({
    super.key,
    this.controller,
    required this.onSubmit,
    this.onChanged,
    this.enabled = true,
    this.hint,
    this.showCaption = true,
    this.onAttach,
  });

  @override
  State<ComposerBar> createState() => _ComposerBarState();
}

class _ComposerBarState extends State<ComposerBar> {
  TextEditingController? _own;
  bool _hasInput = false;
  bool _attaching = false;

  TextEditingController get _controller => widget.controller ?? (_own ??= TextEditingController());

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onTextChanged);
    _hasInput = _controller.text.trim().isNotEmpty;
  }

  @override
  void dispose() {
    _controller.removeListener(_onTextChanged);
    _own?.dispose();
    super.dispose();
  }

  void _onTextChanged() {
    final has = _controller.text.trim().isNotEmpty;
    if (has != _hasInput && mounted) setState(() => _hasInput = has);
    widget.onChanged?.call(_controller.text);
  }

  Future<void> _attach() async {
    final onAttach = widget.onAttach;
    if (onAttach == null || _attaching) return;
    setState(() => _attaching = true);
    try {
      final text = await onAttach();
      if (text == null || !mounted) return;
      final current = _controller.text;
      _controller.text = current.isEmpty || current.endsWith(' ') ? '$current$text' : '$current $text';
      _controller.selection = TextSelection.collapsed(offset: _controller.text.length);
    } finally {
      if (mounted) setState(() => _attaching = false);
    }
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    _controller.clear();
    widget.onSubmit(text);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 26),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [YggColors.bg, YggColors.bg.withValues(alpha: 0)],
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(7, 7, 7, 7),
            decoration: BoxDecoration(
              color: YggColors.surface,
              borderRadius: BorderRadius.circular(YggRadius.pill),
              border: Border.all(color: YggColors.borderStrong),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (widget.onAttach != null) ...[
                  _attaching
                      ? SizedBox(width: 40, height: 40, child: Center(child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent))))
                      : YggIconButton(
                          icon: Icons.attach_file,
                          size: 40,
                          iconSize: 18,
                          circle: true,
                          style: YggIconButtonStyle.tint,
                          tooltip: AppStrings.t('composer.attach'),
                          onTap: widget.enabled ? _attach : null,
                        ),
                  const SizedBox(width: 6),
                ] else
                  const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _controller,
                    enabled: widget.enabled,
                    minLines: 1,
                    maxLines: 4,
                    style: TextStyle(color: YggColors.text, fontSize: 15.5),
                    cursorColor: YggColors.accent,
                    decoration: InputDecoration(
                      hintText: widget.enabled ? (widget.hint ?? AppStrings.t('composer.hint')) : AppStrings.t('composer.waitingHint'),
                      hintStyle: TextStyle(color: YggColors.textFaint),
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 9),
                    ),
                    onSubmitted: (_) => _submit(),
                  ),
                ),
                const SizedBox(width: 6),
                if (_hasInput)
                  YggIconButton(
                    icon: Icons.arrow_upward,
                    size: 40,
                    iconSize: 18,
                    circle: true,
                    style: YggIconButtonStyle.accent,
                    tooltip: AppStrings.t('composer.send'),
                    onTap: widget.enabled ? _submit : null,
                  )
                else
                  VoiceMicButton(
                    size: 40,
                    enabled: widget.enabled,
                    onRecognized: widget.onSubmit,
                  ),
              ],
            ),
          ),
          if (widget.showCaption) ...[
            const SizedBox(height: 10),
            Text(
              'YGGDRASIL 2 · ROOTED MODEL',
              style: TextStyle(fontFamily: YggFonts.mono, fontSize: 10.5, letterSpacing: 1.2, color: YggColors.textFainter),
            ),
          ],
        ],
      ),
    );
  }
}
