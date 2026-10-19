import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';

/// "Copiar" pill under a chat message — the same control for the user's own
/// bubbles and the assistant's replies, in both the gateway and standalone chats.
class CopyPill extends StatelessWidget {
  final String text;
  const CopyPill({super.key, required this.text});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Clipboard.setData(ClipboardData(text: text)),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: YggColors.hairline)),
        child: Text(AppStrings.t('common.copy'), style: const TextStyle(fontSize: 11.5, color: YggColors.textMuted)),
      ),
    );
  }
}
