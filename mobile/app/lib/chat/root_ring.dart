import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

/// Small ring-with-root-line mark used next to bot messages and the home
/// greeting — the artboard's stand-in for a logo mark (no actual asset).
class RootRing extends StatelessWidget {
  final double size;
  final double opacity;

  const RootRing({super.key, this.size = 20, this.opacity = 0.75});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: YggColors.accent.withValues(alpha: opacity), width: 1),
            ),
          ),
          Container(width: 1, height: size - size * 0.4, color: YggColors.accent),
        ],
      ),
    );
  }
}
