import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

/// What a list shows when there is nothing to list: a soft icon tile, a short
/// [message] saying what is missing and, when there is something to do about it,
/// an [action]. Centered, so it also reads right on a short screen.
class YggEmptyState extends StatelessWidget {
  final IconData icon;
  final String message;
  final String? hint;
  final Widget? action;

  const YggEmptyState({super.key, required this.icon, required this.message, this.hint, this.action});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(color: YggColors.accentSoft, borderRadius: BorderRadius.circular(YggRadius.lg)),
              child: Icon(icon, size: 24, color: YggColors.accent),
            ),
            const SizedBox(height: 16),
            Text(message, textAlign: TextAlign.center, style: TextStyle(fontSize: 15, height: 1.4, color: YggColors.text)),
            if (hint != null) ...[
              const SizedBox(height: 6),
              Text(hint!, textAlign: TextAlign.center, style: TextStyle(fontSize: 12.5, height: 1.45, color: YggColors.textMuted)),
            ],
            if (action != null) ...[const SizedBox(height: 18), action!],
          ],
        ),
      ),
    );
  }
}
