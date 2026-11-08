import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';
import 'suggestion.dart';

/// The offer the assistant makes through suggest_action: what it proposes and
/// two ways to answer. Once answered it stays as a quiet record of what was
/// decided.
class SuggestionCard extends StatelessWidget {
  final Suggestion suggestion;
  final String status;
  final VoidCallback onAccept;
  final VoidCallback onDismiss;

  const SuggestionCard({
    super.key,
    required this.suggestion,
    required this.status,
    required this.onAccept,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    final answered = status != suggestionPending;
    final project = suggestion.kind == SuggestionKind.newProject;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: YggCard(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.lightbulb_outline, size: 16, color: answered ? YggColors.textMuted : YggColors.accent),
                const SizedBox(width: 8),
                Text(
                  AppStrings.t(project ? 'suggest.newProjectLabel' : 'suggest.newChatLabel').toUpperCase(),
                  style: TextStyle(fontFamily: YggFonts.mono, fontSize: 11, letterSpacing: 1.4, color: YggColors.textMuted),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(suggestion.title, style: TextStyle(fontSize: 16, color: answered ? YggColors.textMuted : YggColors.text)),
            if (suggestion.summary.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(suggestion.summary, style: TextStyle(fontSize: 13.5, height: 1.4, color: YggColors.textMuted)),
            ],
            const SizedBox(height: 12),
            if (answered)
              Text(
                AppStrings.t(status == suggestionAccepted ? (project ? 'suggest.projectCreated' : 'suggest.accepted') : 'suggest.dismissed'),
                style: TextStyle(fontFamily: YggFonts.mono, fontSize: 12, color: YggColors.textMuted),
              )
            else
              Row(
                children: [
                  Expanded(child: _Button(label: AppStrings.t('suggest.dismiss'), onTap: onDismiss)),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 2,
                    child: _Button(
                      label: AppStrings.t(project ? 'suggest.createProject' : 'suggest.openChat'),
                      onTap: onAccept,
                      primary: true,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _Button extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  final bool primary;

  const _Button({required this.label, required this.onTap, this.primary = false});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        alignment: Alignment.center,
        height: 42,
        decoration: BoxDecoration(
          color: primary ? YggColors.accent : null,
          borderRadius: BorderRadius.circular(999),
          border: primary ? null : Border.all(color: YggColors.border),
        ),
        child: Text(
          label,
          style: primary
              ? TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: YggColors.onAccent)
              : TextStyle(fontSize: 14, color: YggColors.textMuted),
        ),
      ),
    );
  }
}
