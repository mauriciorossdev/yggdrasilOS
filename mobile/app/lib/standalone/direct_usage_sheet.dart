import 'package:flutter/material.dart';

import '../assistant/assistant_usage.dart' show formatTokens, formatUsd;
import '../l10n/app_strings.dart';
import '../profiles/connection_profile.dart';
import '../theme/ygg_theme.dart';
import 'model_catalog.dart';
import 'token_usage.dart';

/// Bottom sheet behind the model/usage chip of a direct chat: switch model
/// (when the provider has a catalog) and see what this chat has used so far.
/// Provider-agnostic: it only reads [modelsFor] and a [UsageSummary], so a new
/// provider shows up here by filling those two in.
Future<void> showDirectUsageSheet(
  BuildContext context, {
  required DirectProvider? provider,
  required String currentModelId,
  required UsageSummary summary,
  required Future<void> Function(String modelId) onSelectModel,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: YggColors.surface,
    builder: (_) => _DirectUsageSheet(
      provider: provider,
      currentModelId: currentModelId,
      summary: summary,
      onSelectModel: onSelectModel,
    ),
  );
}

class _DirectUsageSheet extends StatefulWidget {
  final DirectProvider? provider;
  final String currentModelId;
  final UsageSummary summary;
  final Future<void> Function(String modelId) onSelectModel;

  const _DirectUsageSheet({
    required this.provider,
    required this.currentModelId,
    required this.summary,
    required this.onSelectModel,
  });

  @override
  State<_DirectUsageSheet> createState() => _DirectUsageSheetState();
}

class _DirectUsageSheetState extends State<_DirectUsageSheet> {
  late String _selected = widget.currentModelId;

  Widget _label(String key) => Padding(
        padding: const EdgeInsets.only(top: 18, bottom: 6),
        child: Text(
          AppStrings.t(key).toUpperCase(),
          style: TextStyle(fontSize: 11.5, letterSpacing: 1.6, color: YggColors.textMuted),
        ),
      );

  Future<void> _select(String id) async {
    if (id == _selected) return;
    setState(() => _selected = id);
    await widget.onSelectModel(id);
  }

  @override
  Widget build(BuildContext context) {
    final models = modelsFor(widget.provider);
    final summary = widget.summary;
    // The window to measure against is the model that answered last; falls back
    // to the selected one before any reply exists.
    final windowModel = findModel(widget.provider, summary.lastModel ?? _selected);
    final contextWindow = windowModel?.contextWindow;

    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(AppStrings.t('usage.directTitle'), style: TextStyle(fontSize: 17, color: YggColors.text)),
            _label('usage.model'),
            if (models.isEmpty) ...[
              Text(
                '${AppStrings.t('usage.currentModel')}: $_selected',
                style: TextStyle(color: YggColors.text, fontSize: 14),
              ),
              const SizedBox(height: 4),
              Text(AppStrings.t('usage.noCatalog'), style: TextStyle(color: YggColors.textMuted, fontSize: 12)),
            ] else
              RadioGroup<String>(
                groupValue: _selected,
                onChanged: (v) {
                  if (v != null) _select(v);
                },
                child: Column(
                  children: [
                    for (final m in models)
                      RadioListTile<String>(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        activeColor: YggColors.accent,
                        value: m.id,
                        title: Text(m.label, style: TextStyle(color: YggColors.text)),
                      ),
                  ],
                ),
              ),
            _label('usage.thisChat'),
            if (models.isEmpty)
              Text(AppStrings.t('usage.providerNoUsage'), style: TextStyle(color: YggColors.textMuted, fontSize: 13))
            else if (summary.isEmpty)
              Text(AppStrings.t('usage.noUsageYet'), style: TextStyle(color: YggColors.textMuted, fontSize: 13))
            else ...[
              if (contextWindow != null) ...[
                LinearProgressIndicator(
                  value: (summary.lastContextTokens / contextWindow).clamp(0.0, 1.0),
                  minHeight: 6,
                  backgroundColor: YggColors.hairline,
                  color: summary.lastContextTokens / contextWindow > 0.8 ? YggColors.errorRed : YggColors.accent,
                ),
                const SizedBox(height: 6),
                Text(
                  AppStrings.tp('usage.contextLeft', {
                    'left': formatTokens((contextWindow - summary.lastContextTokens).clamp(0, contextWindow)),
                    'total': formatTokens(contextWindow),
                  }),
                  style: TextStyle(color: YggColors.textMuted, fontSize: 13),
                ),
                const SizedBox(height: 12),
              ],
              Text(
                AppStrings.tp('usage.tokens', {
                  'inTokens': formatTokens(summary.inTokens),
                  'outTokens': formatTokens(summary.outTokens),
                }),
                style: TextStyle(color: YggColors.text, fontSize: 14),
              ),
              if (summary.cacheRead > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    AppStrings.tp('usage.cached', {'n': formatTokens(summary.cacheRead)}),
                    style: TextStyle(color: YggColors.textMuted, fontSize: 13),
                  ),
                ),
              if (summary.costUsd != null) ...[
                const SizedBox(height: 4),
                Text(
                  '${AppStrings.t('usage.spent')}: ${formatUsd(summary.costUsd!)}',
                  style: TextStyle(color: YggColors.text, fontSize: 14),
                ),
              ],
              if (summary.costUsd == null || summary.unpricedCalls > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(AppStrings.t('usage.noPrice'), style: TextStyle(color: YggColors.textMuted, fontSize: 12)),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
