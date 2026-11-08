import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';
import 'ygg_header.dart';
import 'ygg_icon_button.dart';

/// A full screen with the app's header: a back button, an optional mono [eyebrow]
/// (the project's name over a section's title), a serif [title] and [actions].
/// Replaces the stock Scaffold + AppBar on the screens reached from a drawer or a
/// list, so every one of them shares the same top bar.
class YggScreen extends StatelessWidget {
  final String title;
  final String? eyebrow;

  /// Shown after the eyebrow (a status chip, say).
  final Widget? eyebrowTrailing;
  final List<Widget> actions;
  final Widget body;
  final Widget? floatingActionButton;

  const YggScreen({
    super.key,
    required this.title,
    required this.body,
    this.eyebrow,
    this.eyebrowTrailing,
    this.actions = const [],
    this.floatingActionButton,
  });

  @override
  Widget build(BuildContext context) {
    final canPop = Navigator.of(context).canPop();
    return Scaffold(
      backgroundColor: YggColors.bg,
      floatingActionButton: floatingActionButton,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            YggHeader(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              leading: canPop
                  ? YggIconButton(
                      icon: Icons.arrow_back,
                      tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                      onTap: () => Navigator.maybePop(context),
                    )
                  : null,
              eyebrow: eyebrow,
              eyebrowTrailing: eyebrowTrailing,
              title: title,
              titleStyle: TextStyle(fontFamily: YggFonts.serif, fontSize: 26, height: 1.15, letterSpacing: -0.2, color: YggColors.text),
              trailing: actions,
            ),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }
}
