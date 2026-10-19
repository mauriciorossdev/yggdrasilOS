import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import '../services/yggdrasil_client.dart';
import 'assistant_tts.dart';
import 'bubble_tile.dart';
import 'documents_screen.dart';
import 'memory_screen.dart';
import 'assistant_usage.dart';

/// Bottom sheet behind the usage chip in the assistant chat header: model
/// picker, context left, running totals and an optional USD budget.
Future<void> showAssistantUsageSheet(BuildContext context, {required YggdrasilClient client}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    // Tall sheet: keep it below the status bar instead of drawing under the clock/icons.
    useSafeArea: true,
    backgroundColor: YggColors.surface,
    builder: (_) => _UsageSheet(client: client),
  );
}

class _UsageSheet extends StatefulWidget {
  final YggdrasilClient client;

  const _UsageSheet({required this.client});

  @override
  State<_UsageSheet> createState() => _UsageSheetState();
}

class _UsageSheetState extends State<_UsageSheet> {
  final _usage = AssistantUsage.instance;
  final _tts = AssistantTts.instance;
  late final TextEditingController _budget = TextEditingController(
    text: _usage.budgetUsd?.toStringAsFixed(2) ?? '',
  );
  late final TextEditingController _voice = TextEditingController(text: _tts.voiceId);

  @override
  void dispose() {
    _budget.dispose();
    _voice.dispose();
    super.dispose();
  }

  Future<void> _saveBudget() async {
    final raw = _budget.text.trim().replaceAll(',', '.');
    await _usage.setBudget(raw.isEmpty ? null : double.tryParse(raw));
    if (mounted) FocusScope.of(context).unfocus();
  }

  Widget _label(String key) => Padding(
        padding: const EdgeInsets.only(top: 18, bottom: 6),
        child: Text(
          AppStrings.t(key).toUpperCase(),
          style: const TextStyle(fontSize: 11.5, letterSpacing: 1.6, color: YggColors.textMuted),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _usage,
      builder: (context, _) {
        final m = _usage.model;
        final ctxUsed = _usage.lastInput;
        final ratio = m.contextWindow == 0 ? 0.0 : (ctxUsed / m.contextWindow).clamp(0.0, 1.0);
        final remaining = _usage.remainingUsd;
        return Padding(
          padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(AppStrings.t('usage.sheetTitle'), style: const TextStyle(fontSize: 17, color: YggColors.text)),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.psychology_alt_outlined, color: YggColors.accent),
                  title: Text(AppStrings.t('memory.open'), style: const TextStyle(color: YggColors.text)),
                  trailing: const Icon(Icons.chevron_right, color: YggColors.textMuted),
                  onTap: () {
                    final nav = Navigator.of(context);
                    nav.pop();
                    nav.push(MaterialPageRoute(builder: (_) => MemoryScreen(client: widget.client)));
                  },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.folder_open_outlined, color: YggColors.accent),
                  title: Text(AppStrings.t('documents.open'), style: const TextStyle(color: YggColors.text)),
                  trailing: const Icon(Icons.chevron_right, color: YggColors.textMuted),
                  onTap: () {
                    final nav = Navigator.of(context);
                    nav.pop();
                    nav.push(MaterialPageRoute(builder: (_) => DocumentsScreen(client: widget.client)));
                  },
                ),
                const BubbleTile(),
                _label('usage.model'),
                RadioGroup<String?>(
                  groupValue: _usage.modelId,
                  onChanged: (v) => _usage.setModel(v),
                  child: Column(
                    children: [
                      RadioListTile<String?>(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        activeColor: YggColors.accent,
                        value: null,
                        title: Text(AppStrings.t('usage.modelDefault'), style: const TextStyle(color: YggColors.text)),
                      ),
                      for (final model in assistantModels)
                        RadioListTile<String?>(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          activeColor: YggColors.accent,
                          value: model.id,
                          title: Text(model.label, style: const TextStyle(color: YggColors.text)),
                        ),
                    ],
                  ),
                ),
                _label('usage.context'),
                LinearProgressIndicator(
                  value: ratio,
                  minHeight: 6,
                  backgroundColor: YggColors.hairline,
                  color: ratio > 0.8 ? YggColors.errorRed : YggColors.accent,
                ),
                const SizedBox(height: 6),
                Text(
                  '${AppStrings.tp('usage.contextLeft', {'left': formatTokens(_usage.contextRemaining), 'total': formatTokens(m.contextWindow)})}  (${AppStrings.t('usage.estimate')})',
                  style: const TextStyle(color: YggColors.textMuted, fontSize: 13),
                ),
                _label('usage.total'),
                Text(
                  AppStrings.tp('usage.tokens', {'inTokens': formatTokens(_usage.totalIn), 'outTokens': formatTokens(_usage.totalOut)}),
                  style: const TextStyle(color: YggColors.text, fontSize: 14),
                ),
                if (_usage.totalCacheRead > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      AppStrings.tp('usage.cached', {'n': formatTokens(_usage.totalCacheRead)}),
                      style: const TextStyle(color: YggColors.textMuted, fontSize: 13),
                    ),
                  ),
                const SizedBox(height: 4),
                Text(
                  '${AppStrings.t('usage.spent')}: ${formatUsd(_usage.totalUsd)}',
                  style: const TextStyle(color: YggColors.text, fontSize: 14),
                ),
                if (_usage.unpricedUsage || !m.hasPrice)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(AppStrings.t('usage.noPrice'), style: const TextStyle(color: YggColors.textMuted, fontSize: 12)),
                  ),
                _label('usage.budget'),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _budget,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        style: const TextStyle(color: YggColors.text),
                        decoration: InputDecoration(
                          hintText: AppStrings.t('usage.budgetHint'),
                          hintStyle: const TextStyle(color: YggColors.textFaint),
                          isDense: true,
                        ),
                        onSubmitted: (_) => _saveBudget(),
                      ),
                    ),
                    const SizedBox(width: 10),
                    TextButton(onPressed: _saveBudget, child: Text(AppStrings.t('usage.save'))),
                  ],
                ),
                if (remaining != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      AppStrings.tp('usage.budgetLeft', {'left': formatUsd(remaining < 0 ? 0 : remaining)}),
                      style: TextStyle(color: remaining <= 0 ? YggColors.errorRed : YggColors.accent, fontSize: 14),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(AppStrings.t('usage.budgetNote'), style: const TextStyle(color: YggColors.textMuted, fontSize: 12)),
                ),
                _label('tts.section'),
                AnimatedBuilder(
                  animation: _tts,
                  builder: (context, _) => SwitchListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    activeThumbColor: YggColors.accent,
                    value: _tts.enabled,
                    onChanged: _tts.setEnabled,
                    title: Text(AppStrings.t('tts.enable'), style: const TextStyle(color: YggColors.text)),
                  ),
                ),
                TextField(
                  controller: _voice,
                  style: const TextStyle(color: YggColors.text),
                  decoration: InputDecoration(
                    hintText: AppStrings.t('tts.voiceHint'),
                    hintStyle: const TextStyle(color: YggColors.textFaint),
                    isDense: true,
                  ),
                  onChanged: _tts.setVoiceId,
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(AppStrings.t('tts.note'), style: const TextStyle(color: YggColors.textMuted, fontSize: 12)),
                ),
                const SizedBox(height: 10),
                TextButton(
                  onPressed: _usage.resetTotals,
                  child: Text(AppStrings.t('usage.reset'), style: const TextStyle(color: YggColors.textMuted)),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
