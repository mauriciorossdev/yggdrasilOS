import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';
import 'persona.dart';

/// Bottom sheet listing every personality; resolves to the picked id, or null
/// when dismissed.
Future<String?> showPersonaPicker(BuildContext context, {required String selectedId}) async {
  final personas = await PersonaStore.all();
  if (!context.mounted) return null;
  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: YggColors.bg,
    isScrollControlled: true,
    builder: (context) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
        children: [
          YggSectionLabel(AppStrings.t('personas.pickTitle')),
          YggListGroup(
            children: [
              for (final p in personas)
                YggListRow(
                  title: p.name,
                  subtitle: p.builtin ? AppStrings.t('persona.${p.id}.desc') : null,
                  trailing: p.id == selectedId ? Icon(Icons.check, color: YggColors.accent) : null,
                  chevron: false,
                  onTap: () => Navigator.pop(context, p.id),
                ),
            ],
          ),
        ],
      ),
    ),
  );
}
