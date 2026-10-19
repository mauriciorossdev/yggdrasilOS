import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../l10n/app_strings.dart';
import '../services/bubble_channel.dart';
import '../theme/ygg_theme.dart';

/// Settings row that turns the quick-access bubble on or off, walking the user
/// through the one permission only they can grant ("Display over other apps").
class BubbleTile extends StatefulWidget {
  const BubbleTile({super.key});

  @override
  State<BubbleTile> createState() => _BubbleTileState();
}

class _BubbleTileState extends State<BubbleTile> with WidgetsBindingObserver {
  bool _enabled = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Coming back from the system settings screen: re-read the real state.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final enabled = await BubbleChannel.isEnabled();
    if (mounted) setState(() => _enabled = enabled);
  }

  Future<void> _toggle(bool value) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      if (!value) {
        await BubbleChannel.setEnabled(false);
      } else {
        if (!await BubbleChannel.canDrawOverlays()) {
          if (!mounted) return;
          final open = await showDialog<bool>(
            context: context,
            builder: (context) => AlertDialog(
              title: Text(AppStrings.t('bubble.permTitle')),
              content: Text(AppStrings.t('bubble.permBody')),
              actions: [
                TextButton(onPressed: () => Navigator.pop(context, false), child: Text(AppStrings.t('common.cancel'))),
                ElevatedButton(onPressed: () => Navigator.pop(context, true), child: Text(AppStrings.t('bubble.permOpen'))),
              ],
            ),
          );
          if (open == true) await BubbleChannel.openOverlaySettings();
          return;
        }
        // Voice and the service notification need these two; neither blocks showing the bubble.
        await Permission.microphone.request();
        await Permission.notification.request();
        await BubbleChannel.setEnabled(true);
      }
    } finally {
      await _refresh();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SwitchListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          activeThumbColor: YggColors.accent,
          secondary: const Icon(Icons.bubble_chart_outlined, color: YggColors.accent),
          value: _enabled,
          onChanged: _busy ? null : _toggle,
          title: Text(AppStrings.t('bubble.title'), style: const TextStyle(color: YggColors.text)),
          subtitle: Text(
            AppStrings.t('bubble.subtitle'),
            style: const TextStyle(color: YggColors.textMuted, fontSize: 12),
          ),
        ),
        if (_enabled)
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 6),
            child: Text(AppStrings.t('bubble.hint'), style: const TextStyle(color: YggColors.textFaint, fontSize: 11.5)),
          ),
      ],
    );
  }
}
