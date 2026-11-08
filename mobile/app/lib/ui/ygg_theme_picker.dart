import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';

/// Lets the user pick one of [YggPalette.all]. Each option previews its own
/// background, surface and accent, so the choice is visible before it is made.
Future<void> showYggThemePicker(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (context) => const _ThemePickerSheet(),
  );
}

class _ThemePickerSheet extends StatelessWidget {
  const _ThemePickerSheet();

  @override
  Widget build(BuildContext context) {
    final controller = YggThemeController.instance;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
                child: Text(AppStrings.t('settings.themeTitle'), style: TextStyle(fontFamily: YggFonts.serif, fontSize: 22, color: YggColors.text)),
              ),
              for (final palette in YggPalette.all) _ThemeOption(palette: palette, selected: palette.id == controller.palette.id),
            ],
          ),
        ),
      ),
    );
  }
}

class _ThemeOption extends StatelessWidget {
  final YggPalette palette;
  final bool selected;

  const _ThemeOption({required this.palette, required this.selected});

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(YggRadius.lg),
      side: BorderSide(color: selected ? YggColors.accent : YggColors.border, width: selected ? 1.5 : 1),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        button: true,
        selected: selected,
        label: palette.name,
        child: Material(
          color: YggColors.cardFill,
          shape: shape,
          child: InkWell(
            customBorder: shape,
            onTap: () => YggThemeController.instance.select(palette),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  _Swatch(palette: palette),
                  const SizedBox(width: 14),
                  Expanded(child: Text(palette.name, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: YggColors.text))),
                  if (selected) Icon(Icons.check, size: 20, color: YggColors.accent),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Miniature of the theme: its background with a surface card and an accent dot on it.
class _Swatch extends StatelessWidget {
  final YggPalette palette;

  const _Swatch({required this.palette});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 56,
      height: 40,
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: palette.bg,
        borderRadius: BorderRadius.circular(YggRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: Container(
        decoration: BoxDecoration(color: palette.surface, borderRadius: BorderRadius.circular(YggRadius.sm), border: Border.all(color: palette.border)),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Padding(
            padding: const EdgeInsets.only(left: 5),
            child: Container(width: 8, height: 8, decoration: BoxDecoration(color: palette.accent, shape: BoxShape.circle)),
          ),
        ),
      ),
    );
  }
}
