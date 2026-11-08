import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

enum YggChipTone { neutral, accent, working, checking, ready, danger }

/// Small status pill — the desktop's `.ygg-chip`. The tone picks the text/fill
/// pair from the active theme; [pulse] fades the dot for "in progress" states.
class YggChip extends StatelessWidget {
  final String label;
  final YggChipTone tone;
  final bool dot;
  final bool pulse;

  const YggChip(this.label, {super.key, this.tone = YggChipTone.neutral, this.dot = false, this.pulse = false});

  (Color fg, Color bg) get _colors {
    switch (tone) {
      case YggChipTone.accent:
        return (YggColors.accent, YggColors.accentSoft);
      case YggChipTone.working:
        return (YggColors.working, YggColors.workingSoft);
      case YggChipTone.checking:
        return (YggColors.checking, YggColors.checkingSoft);
      case YggChipTone.ready:
        return (YggColors.ready, YggColors.readySoft);
      case YggChipTone.danger:
        return (YggColors.danger, YggColors.dangerSoft);
      case YggChipTone.neutral:
        return (YggColors.text2, YggColors.cardFillHighest);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = _colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(YggRadius.pill)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[
            YggDot(color: fg, pulse: pulse),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, height: 1.6, color: fg),
            ),
          ),
        ],
      ),
    );
  }
}

/// The 6dp status dot of a chip; fades in and out while [pulse] is on.
class YggDot extends StatefulWidget {
  final Color color;
  final bool pulse;

  const YggDot({super.key, required this.color, this.pulse = false});

  @override
  State<YggDot> createState() => _YggDotState();
}

class _YggDotState extends State<YggDot> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    // Created here, not lazily: a lazy first access from dispose() would make a ticker
    // on an element that is already being unmounted.
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));
    if (widget.pulse) _controller.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(YggDot old) {
    super.didUpdateWidget(old);
    if (widget.pulse && !_controller.isAnimating) {
      _controller.repeat(reverse: true);
    } else if (!widget.pulse && _controller.isAnimating) {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dot = Container(width: 6, height: 6, decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle));
    if (!widget.pulse || MediaQuery.of(context).disableAnimations) return dot;
    return FadeTransition(opacity: Tween<double>(begin: 1, end: 0.35).animate(_controller), child: dot);
  }
}
