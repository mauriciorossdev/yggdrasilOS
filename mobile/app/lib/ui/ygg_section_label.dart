import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

/// Small uppercase monospace label that titles a group ("PERSONALIZACIÓN",
/// drawer date buckets, suggestion tags). [accent] tints it for in-card tags.
class YggSectionLabel extends StatelessWidget {
  final String text;
  final bool accent;
  final EdgeInsetsGeometry padding;

  const YggSectionLabel(
    this.text, {
    super.key,
    this.accent = false,
    this.padding = const EdgeInsets.fromLTRB(4, 0, 4, 8),
  });

  /// The text style on its own, for labels drawn inside other widgets.
  static TextStyle style({bool accent = false, double size = 10}) => TextStyle(
        fontFamily: YggFonts.mono,
        fontSize: size,
        letterSpacing: 1.6,
        color: accent ? YggColors.accent : YggColors.textFainter,
      );

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Text(text.toUpperCase(), style: style(accent: accent)),
    );
  }
}
