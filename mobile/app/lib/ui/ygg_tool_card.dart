import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';
import 'ygg_card.dart';
import 'ygg_chip.dart';

/// One tool call in the chat: a monospace name (with a muted detail after it) on
/// the left and a status chip on the right. [action] sits under the row (retry).
class YggToolCard extends StatelessWidget {
  final String name;
  final String? detail;
  final String statusLabel;
  final YggChipTone tone;
  final bool pulse;
  final Widget? action;

  const YggToolCard({
    super.key,
    required this.name,
    this.detail,
    required this.statusLabel,
    required this.tone,
    this.pulse = false,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: YggCard(
        radius: YggRadius.md,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      text: name,
                      style: TextStyle(fontFamily: YggFonts.mono, fontSize: 12, color: YggColors.text),
                      children: [
                        if (detail != null && detail!.isNotEmpty) TextSpan(text: '  $detail', style: TextStyle(color: YggColors.textMuted)),
                      ],
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 10),
                YggChip(statusLabel, tone: tone, dot: true, pulse: pulse),
              ],
            ),
            ?action,
          ],
        ),
      ),
    );
  }
}
