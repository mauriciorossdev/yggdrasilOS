import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

const _rpcTimeout = Duration(seconds: 10);

/// Header chip with the session's current model; tapping lists the models
/// the Pi's term-bridge allows and switches with claude.setModel (which
/// types `/model <id>` into the Claude session).
class PiModelButton extends StatefulWidget {
  final YggdrasilClient client;

  /// Project pane to act on; null = the main Claude chat.
  final String? paneId;

  const PiModelButton({super.key, required this.client, this.paneId});

  @override
  State<PiModelButton> createState() => _PiModelButtonState();
}

class _PiModelButtonState extends State<PiModelButton> {
  List<Map<String, String>> _models = const [];
  String? _current;
  bool _switching = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final res = await widget.client.call('claude.models', {if (widget.paneId != null) 'id': widget.paneId}, timeout: _rpcTimeout);
      if (!mounted || res is! Map) return;
      setState(() {
        _models = ((res['models'] as List?) ?? const [])
            .whereType<Map>()
            .map((m) => {'id': m['id'].toString(), 'label': (m['label'] ?? m['id']).toString()})
            .toList();
        _current = res['current']?.toString();
      });
    } catch (_) {
      // Chip just stays generic; the chat itself still works.
    }
  }

  String _label(String? id) {
    if (id == null) return AppStrings.t('pi.model');
    return _models.firstWhere((m) => m['id'] == id, orElse: () => {'label': id})['label']!;
  }

  Future<void> _select(String id) async {
    if (id == _current) return;
    setState(() => _switching = true);
    try {
      await widget.client.call('claude.setModel', {'model': id, if (widget.paneId != null) 'id': widget.paneId}, timeout: _rpcTimeout);
      if (mounted) setState(() => _current = id);
    } catch (e) {
      if (!mounted) return;
      final msg = e is Map ? (e['message'] ?? e).toString() : '$e';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    } finally {
      if (mounted) setState(() => _switching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: AppStrings.t('pi.model'),
      enabled: !_switching,
      onOpened: _refresh,
      onSelected: _select,
      itemBuilder: (_) => [
        for (final m in _models)
          CheckedPopupMenuItem<String>(value: m['id'], checked: m['id'] == _current, child: Text(m['label']!)),
      ],
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 10),
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: YggColors.hairline),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_switching)
              const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 1.5, color: YggColors.accent))
            else
              const Icon(Icons.auto_awesome, size: 14, color: YggColors.textMuted),
            const SizedBox(width: 6),
            Text(_label(_current), style: const TextStyle(fontSize: 13, color: YggColors.text)),
            const Icon(Icons.arrow_drop_down, size: 18, color: YggColors.textMuted),
          ],
        ),
      ),
    );
  }
}
