import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

/// Bottom sheet with the Claude account's plan limits (same data as
/// Claude Code's `/usage`), fetched by the Pi's term-bridge (claude.usage).
Future<void> showPiUsageSheet(BuildContext context, YggdrasilClient client) {
  return showModalBottomSheet(
    context: context,
    showDragHandle: true,
    builder: (_) => _PiUsageSheet(client: client),
  );
}

class _PiUsageSheet extends StatefulWidget {
  final YggdrasilClient client;

  const _PiUsageSheet({required this.client});

  @override
  State<_PiUsageSheet> createState() => _PiUsageSheetState();
}

class _PiUsageSheetState extends State<_PiUsageSheet> {
  Map? _usage;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await widget.client.call('claude.usage', {}, timeout: const Duration(seconds: 15));
      if (mounted) setState(() => _usage = res is Map ? res : {});
    } catch (e) {
      if (mounted) setState(() => _error = e is Map ? (e['message'] ?? e).toString() : '$e');
    }
  }

  static String _kindLabel(String kind) {
    final key = 'pi.limit.$kind';
    final t = AppStrings.t(key);
    return t == key ? kind.replaceAll('_', ' ') : t;
  }

  static String _resets(String? iso) {
    final at = iso == null ? null : DateTime.tryParse(iso)?.toLocal();
    if (at == null) return '';
    final diff = at.difference(DateTime.now());
    final String inText;
    if (diff.inMinutes < 60) {
      inText = '${diff.inMinutes.clamp(0, 59)} min';
    } else if (diff.inHours < 48) {
      inText = '${diff.inHours} h ${diff.inMinutes % 60} min';
    } else {
      inText = '${diff.inDays} d';
    }
    final hh = at.hour.toString().padLeft(2, '0');
    final mm = at.minute.toString().padLeft(2, '0');
    return AppStrings.t('pi.resetsIn').replaceAll('{in}', inText).replaceAll('{at}', '${at.day}/${at.month} $hh:$mm');
  }

  @override
  Widget build(BuildContext context) {
    final usage = _usage;
    final limits = ((usage?['limits'] as List?) ?? const []).whereType<Map>().toList();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(AppStrings.t('pi.usageTitle'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: YggColors.text)),
            if (usage?['plan'] != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text('${AppStrings.t('pi.plan')}: ${usage!['plan']}', style: const TextStyle(fontSize: 12.5, color: YggColors.textMuted)),
              ),
            const SizedBox(height: 16),
            if (_error != null)
              Text(_error!, style: const TextStyle(color: YggColors.textMuted))
            else if (usage == null)
              const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator(color: YggColors.accent)))
            else if (limits.isEmpty)
              Text(AppStrings.t('pi.usageEmpty'), style: const TextStyle(color: YggColors.textMuted))
            else
              for (final l in limits) ...[
                Row(
                  children: [
                    Expanded(child: Text(_kindLabel(l['kind'].toString()), style: const TextStyle(color: YggColors.text))),
                    Text('${(l['percent'] as num).round()}%', style: const TextStyle(fontWeight: FontWeight.w600, color: YggColors.text)),
                  ],
                ),
                const SizedBox(height: 6),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: ((l['percent'] as num) / 100).clamp(0.0, 1.0).toDouble(),
                    minHeight: 6,
                    color: (l['percent'] as num) >= 90
                        ? Colors.redAccent
                        : (l['percent'] as num) >= 70
                            ? Colors.orangeAccent
                            : YggColors.accent,
                    backgroundColor: YggColors.hairline,
                  ),
                ),
                const SizedBox(height: 4),
                Text(_resets(l['resetsAt']?.toString()), style: const TextStyle(fontSize: 11.5, color: YggColors.textFainter)),
                const SizedBox(height: 14),
              ],
          ],
        ),
      ),
    );
  }
}
