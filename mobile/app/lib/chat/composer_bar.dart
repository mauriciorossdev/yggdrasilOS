import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
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
            padding: const EdgeInsets.fromLTRB(16, 7, 7, 7),
            decoration: BoxDecoration(
              color: YggColors.cardFillHigh,
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: YggColors.hairlineStrong),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (widget.onAttach != null) ...[
                  _RoundButton(
                    onTap: widget.enabled && !_attaching ? _attach : null,
                    bg: YggColors.cardFillHighest,
                    child: _attaching
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent))
                        : const Icon(Icons.attach_file, color: YggColors.text, size: 18),
                  ),
                  const SizedBox(width: 6),
                ],
                Expanded(
                  child: TextField(
                    controller: _controller,
                    enabled: widget.enabled,
                    minLines: 1,
                    maxLines: 4,
                    style: const TextStyle(color: YggColors.text, fontSize: 15.5),
                    cursorColor: YggColors.accent,
                    decoration: InputDecoration(
                      hintText: widget.enabled ? (widget.hint ?? AppStrings.t('composer.hint')) : AppStrings.t('composer.waitingHint'),
                      hintStyle: const TextStyle(color: YggColors.textFaint),
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 9),
                    ),
                    onSubmitted: (_) => _submit(),
                  ),
                ),
                const SizedBox(width: 6),
                if (_hasInput)
                  _RoundButton(
                    onTap: widget.enabled ? _submit : null,
                    bg: YggColors.accent,
                    child: const Icon(Icons.arrow_upward, color: YggColors.surface, size: 18),
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
            const Text(
              'YGGDRASIL 2 · ROOTED MODEL',
              style: TextStyle(fontFamily: 'monospace', fontSize: 10.5, letterSpacing: 1.2, color: Color.fromRGBO(244, 239, 230, 0.32)),
            ),
          ],
        ],
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  final VoidCallback? onTap;
  final Color bg;
  final Widget child;

  const _RoundButton({required this.onTap, required this.bg, required this.child});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
        child: Center(child: child),
      ),
    );
  }
}
