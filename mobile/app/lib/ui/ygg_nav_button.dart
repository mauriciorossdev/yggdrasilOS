import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

/// Full-width icon + label button of the drawer ("Nuevo chat", "Proyectos"...).
/// [primary] fills it with the accent; otherwise it is a bordered surface.
class YggNavButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool primary;

  /// Half-faded for destinations that are not reachable right now (no gateway).
  final bool dimmed;

  const YggNavButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.primary = false,
    this.dimmed = false,
  });

  @override
  Widget build(BuildContext context) {
    final fg = primary ? YggColors.onAccent : YggColors.text;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(YggRadius.lg),
      side: primary ? BorderSide.none : BorderSide(color: YggColors.border),
    );
    return Opacity(
      opacity: dimmed ? 0.5 : 1,
      child: Material(
        color: primary ? YggColors.accent : YggColors.cardFillHigh,
        shape: shape,
        child: InkWell(
          customBorder: shape,
          onTap: onTap,
          child: Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 15),
            child: Row(
              children: [
                Icon(icon, color: fg, size: 18),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: fg, fontWeight: FontWeight.w500, fontSize: 14.5)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
