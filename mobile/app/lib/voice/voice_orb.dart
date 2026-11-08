import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';
import 'voice_session.dart';

/// The round shape at the center of the voice mode. It breathes with the voice:
/// it swells with the microphone level while listening, spins while the
/// assistant thinks, sends out rings while it speaks and goes dim when paused.
class VoiceOrb extends StatefulWidget {
  final VoiceState state;

  /// Microphone level in the recognizer's own units (about -2 to 10).
  final double level;
  final double size;

  const VoiceOrb({super.key, required this.state, this.level = 0, this.size = 220});

  @override
  State<VoiceOrb> createState() => _VoiceOrbState();
}

class _VoiceOrbState extends State<VoiceOrb> with SingleTickerProviderStateMixin {
  late final AnimationController _loop = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();

  @override
  void dispose() {
    _loop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _loop,
        builder: (context, _) => CustomPaint(
          painter: _OrbPainter(state: widget.state, level: widget.level, t: _loop.value, color: YggColors.accent, muted: YggColors.textMuted),
        ),
      ),
    );
  }
}

class _OrbPainter extends CustomPainter {
  final VoiceState state;
  final double level;
  final double t;
  final Color color;
  final Color muted;

  _OrbPainter({required this.state, required this.level, required this.t, required this.color, required this.muted});

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final base = size.width * 0.27;
    final dim = state == VoiceState.paused || state == VoiceState.ended;
    final tone = dim ? muted : color;

    // The core always breathes a little; while listening it also follows the voice.
    final loud = ((level + 2) / 12).clamp(0.0, 1.0);
    final breath = math.sin(t * 2 * math.pi) * 0.04;
    final swell = state == VoiceState.listening ? loud * 0.28 : 0.0;
    final radius = base * (1 + breath + swell);

    final halo = Paint()
      ..shader = RadialGradient(colors: [tone.withValues(alpha: dim ? 0.10 : 0.28), tone.withValues(alpha: 0)])
          .createShader(Rect.fromCircle(center: c, radius: radius * 2.3));
    canvas.drawCircle(c, radius * 2.3, halo);

    if (state == VoiceState.speaking) {
      // Rings leaving the core, each a third of a cycle behind the last.
      for (var i = 0; i < 3; i++) {
        final p = (t + i / 3) % 1.0;
        final ring = Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = tone.withValues(alpha: (1 - p) * 0.55);
        canvas.drawCircle(c, radius * (1.1 + p * 0.9), ring);
      }
    }

    if (state == VoiceState.thinking) {
      final arc = Paint()
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = 4
        ..color = tone.withValues(alpha: 0.8);
      final rect = Rect.fromCircle(center: c, radius: radius * 1.35);
      canvas.drawArc(rect, t * 2 * math.pi, math.pi * 0.9, false, arc);
      canvas.drawArc(rect, t * 2 * math.pi + math.pi, math.pi * 0.5, false, arc..color = tone.withValues(alpha: 0.4));
    }

    final core = Paint()
      ..shader = RadialGradient(
        center: const Alignment(-0.3, -0.3),
        colors: [Color.lerp(tone, Colors.white, 0.25)!, tone],
      ).createShader(Rect.fromCircle(center: c, radius: radius));
    canvas.drawCircle(c, radius, core);
  }

  @override
  bool shouldRepaint(_OrbPainter old) => old.state != state || old.level != level || old.t != t || old.color != color;
}
