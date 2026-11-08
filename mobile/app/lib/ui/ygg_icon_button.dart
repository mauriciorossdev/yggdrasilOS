import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

enum YggIconButtonStyle {
  /// Raised surface with a border — header actions.
  surface,

  /// Filled with the accent — the one primary action (send, mic).
  accent,

  /// Soft tint, no border — secondary action inside a field (attach).
  tint,

  /// No fill at all.
  ghost,
}

/// Square-ish (or round) icon button with a 44dp touch target by default.
class YggIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final String? tooltip;
  final double size;
  final double iconSize;
  final bool circle;
  final YggIconButtonStyle style;

  const YggIconButton({
    super.key,
    required this.icon,
    required this.onTap,
    this.tooltip,
    this.size = 44,
    this.iconSize = 20,
    this.circle = false,
    this.style = YggIconButtonStyle.surface,
  });

  @override
  Widget build(BuildContext context) {
    final (Color bg, Color fg, Color? borderColor) = switch (style) {
      YggIconButtonStyle.surface => (YggColors.surface, YggColors.text, YggColors.border),
      YggIconButtonStyle.accent => (YggColors.accent, YggColors.onAccent, null),
      YggIconButtonStyle.tint => (YggColors.cardFillHighest, YggColors.text, null),
      YggIconButtonStyle.ghost => (Colors.transparent, YggColors.textMuted, null),
    };
    final side = borderColor == null ? BorderSide.none : BorderSide(color: borderColor);
    final ShapeBorder shape =
        circle ? CircleBorder(side: side) : RoundedRectangleBorder(borderRadius: BorderRadius.circular(YggRadius.lg), side: side);
    final enabled = onTap != null;

    return Semantics(
      button: true,
      enabled: enabled,
      label: tooltip,
      excludeSemantics: tooltip != null,
      child: Opacity(
        opacity: enabled ? 1 : 0.4,
        child: Material(
          color: bg,
          shape: shape,
          child: InkWell(
            customBorder: shape,
            onTap: onTap,
            child: SizedBox(width: size, height: size, child: Icon(icon, size: iconSize, color: fg)),
          ),
        ),
      ),
    );
  }
}
