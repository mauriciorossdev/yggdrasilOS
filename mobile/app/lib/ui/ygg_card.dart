import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

/// Bordered surface — the base of every card, list group and tool row.
class YggCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final double radius;

  const YggCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(14),
    this.onTap,
    this.color,
    this.radius = YggRadius.lg,
  });

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius), side: BorderSide(color: YggColors.border));
    return Material(
      color: color ?? YggColors.surface,
      shape: shape,
      child: InkWell(
        customBorder: shape,
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}
