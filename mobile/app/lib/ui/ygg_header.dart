import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

/// Top bar of home and chat: a leading button, a title block (optional mono
/// [eyebrow] over the [title]) and trailing actions.
class YggHeader extends StatelessWidget {
  final Widget? leading;
  final String? eyebrow;

  /// Widget shown next to the eyebrow (the usage chip in chat).
  final Widget? eyebrowTrailing;
  final String title;

  /// Set the title in the spaced mono "wordmark" style (home) instead of body text.
  final bool wordmark;

  /// Replaces the default title style (screens use the serif display style).
  final TextStyle? titleStyle;
  final VoidCallback? onTitleTap;
  final List<Widget> trailing;
  final EdgeInsetsGeometry padding;

  const YggHeader({
    super.key,
    this.leading,
    this.eyebrow,
    this.eyebrowTrailing,
    required this.title,
    this.wordmark = false,
    this.titleStyle,
    this.onTitleTap,
    this.trailing = const [],
    this.padding = const EdgeInsets.fromLTRB(16, 12, 16, 10),
  });

  @override
  Widget build(BuildContext context) {
    final titleText = Text(
      wordmark ? title.toUpperCase() : title,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: titleStyle ??
          (wordmark
              ? TextStyle(fontFamily: YggFonts.mono, fontSize: 12, letterSpacing: 2.6, color: YggColors.textMuted)
              : TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: YggColors.text)),
    );
    return Padding(
      padding: padding,
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 12)],
          Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: onTitleTap,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (eyebrow != null)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(eyebrow!.toUpperCase(), style: TextStyle(fontFamily: YggFonts.mono, fontSize: 10, letterSpacing: 1.8, color: YggColors.accent)),
                        if (eyebrowTrailing != null) ...[const SizedBox(width: 10), eyebrowTrailing!],
                      ],
                    ),
                  if (eyebrow != null) const SizedBox(height: 2),
                  titleText,
                ],
              ),
            ),
          ),
          for (final action in trailing) ...[const SizedBox(width: 10), action],
        ],
      ),
    );
  }
}
