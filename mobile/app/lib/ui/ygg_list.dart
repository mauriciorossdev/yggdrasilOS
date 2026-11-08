import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

/// Rows grouped in one bordered card with hairline dividers between them —
/// the settings look. Titled with a [YggSectionLabel] above it by the caller.
class YggListGroup extends StatelessWidget {
  final List<Widget> children;

  const YggListGroup({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(YggRadius.lg), side: BorderSide(color: YggColors.border));
    return Material(
      color: YggColors.surface,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) Divider(height: 1, thickness: 1, color: YggColors.border),
            children[i],
          ],
        ],
      ),
    );
  }
}

/// One row of a [YggListGroup]: title, optional subtitle, a trailing value or
/// widget (a chip, say) and a chevron when it opens something.
class YggListRow extends StatelessWidget {
  final String title;
  final String? subtitle;

  /// Sets the subtitle in monospace (paths, ids).
  final bool subtitleMono;

  /// Lines the subtitle may take before it is cut with an ellipsis.
  final int subtitleLines;

  /// Small monospace line under the subtitle ("12 mensajes · hace 5 min").
  final String? meta;

  /// Short muted text on the right ("Español", "28 de 28").
  final String? value;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;

  /// Defaults to true when [onTap] is set.
  final bool? chevron;

  /// Greyed out and inert (a "coming soon" row).
  final bool dimmed;

  /// Tints the title with the accent — for the "add" action at the end of a group.
  final bool accent;

  const YggListRow({
    super.key,
    required this.title,
    this.subtitle,
    this.subtitleMono = false,
    this.subtitleLines = 3,
    this.meta,
    this.value,
    this.leading,
    this.trailing,
    this.onTap,
    this.chevron,
    this.dimmed = false,
    this.accent = false,
  });

  @override
  Widget build(BuildContext context) {
    final showChevron = chevron ?? (onTap != null && !dimmed);
    final row = Container(
      constraints: const BoxConstraints(minHeight: 52),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Row(
        children: [
          if (leading != null) ...[
            IconTheme(data: IconThemeData(size: 20, color: accent ? YggColors.accent : YggColors.textMuted), child: leading!),
            const SizedBox(width: 12),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: accent ? FontWeight.w500 : FontWeight.w400,
                    color: accent ? YggColors.accent : (dimmed ? YggColors.textMuted : YggColors.text),
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    maxLines: subtitleLines,
                    overflow: TextOverflow.ellipsis,
                    style: subtitleMono
                        ? TextStyle(fontFamily: YggFonts.mono, fontSize: 11, color: YggColors.textMuted)
                        : TextStyle(fontSize: 12.5, height: 1.4, color: YggColors.textMuted),
                  ),
                ],
                if (meta != null) ...[
                  const SizedBox(height: 4),
                  Text(meta!, style: TextStyle(fontFamily: YggFonts.mono, fontSize: 11, color: YggColors.textFainter)),
                ],
              ],
            ),
          ),
          if (value != null) ...[
            const SizedBox(width: 12),
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.4),
              child: Text(value!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, color: YggColors.textMuted)),
            ),
          ],
          if (trailing != null) ...[const SizedBox(width: 12), trailing!],
          if (showChevron) ...[
            const SizedBox(width: 8),
            Icon(Icons.chevron_right, size: 18, color: YggColors.textFainter),
          ],
        ],
      ),
    );
    if (onTap == null || dimmed) return row;
    return InkWell(onTap: onTap, child: row);
  }
}
