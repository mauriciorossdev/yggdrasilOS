import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';
import 'ygg_chip.dart';

/// Section tile of a project's grid: an icon, a title and one live detail line
/// ("1 corriendo", "12 sesiones"). [loading] swaps the detail for a placeholder
/// while the number is still coming in; [enabled] false greys the tile out.
class YggTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String? detail;
  final Color? dotColor;
  final bool dotPulse;
  final bool loading;
  final bool enabled;
  final VoidCallback? onTap;

  const YggTile({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.detail,
    this.dotColor,
    this.dotPulse = false,
    this.loading = false,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(YggRadius.lg), side: BorderSide(color: YggColors.border));
    return Semantics(
      button: true,
      enabled: enabled,
      label: detail == null ? label : '$label, $detail',
      excludeSemantics: true,
      child: Opacity(
        opacity: enabled ? 1 : 0.5,
        child: Material(
          color: YggColors.surface,
          shape: shape,
          child: InkWell(
            customBorder: shape,
            onTap: enabled ? onTap : null,
            child: Container(
              constraints: const BoxConstraints(minHeight: 120),
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(color: YggColors.accentSoft, borderRadius: BorderRadius.circular(YggRadius.md)),
                    child: Icon(icon, size: 20, color: YggColors.accent),
                  ),
                  const SizedBox(height: 14),
                  Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: YggColors.text)),
                  const SizedBox(height: 4),
                  if (loading)
                    Container(
                      width: 64,
                      height: 10,
                      decoration: BoxDecoration(color: YggColors.cardFillHighest, borderRadius: BorderRadius.circular(YggRadius.sm)),
                    )
                  else if (detail != null)
                    Row(
                      children: [
                        if (dotColor != null) ...[YggDot(color: dotColor!, pulse: dotPulse), const SizedBox(width: 6)],
                        Expanded(
                          child: Text(detail!, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, height: 1.35, color: YggColors.textMuted)),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
