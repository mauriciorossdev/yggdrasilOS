import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../ui/ui.dart';

/// Interactive device-tool (SAF picker) progress card — states/copy per
/// notes/yggdrasil-mobile/mobile-chat-ux-flows.md §5. Shared between gateway
/// mode (chat_screen.dart, cancel = RPC round-trip) and standalone mode
/// (direct_chat_screen.dart, cancel = local call) per Architect's explicit
/// instruction not to duplicate this UI (remote-access-analysis.md §7.2) —
/// only what `onCancel`/`onRetry` actually do differs between the two.
class InteractiveToolCard extends StatelessWidget {
  final String status;
  final String? detail;
  final String? toolName;
  final VoidCallback? onCancel;
  final VoidCallback? onRetry;

  const InteractiveToolCard({
    super.key,
    required this.status,
    this.detail,
    this.toolName,
    this.onCancel,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final name = toolName ?? '';
    final retry = TextButton(onPressed: onRetry, child: Text(AppStrings.t('common.retry')));
    switch (status) {
      case 'opening':
        return YggToolCard(
          name: name,
          detail: AppStrings.t('tool.openingPicker'),
          statusLabel: AppStrings.t('tool.statusRunning'),
          tone: YggChipTone.working,
          pulse: true,
        );
      case 'awaitingUser':
        // A pulsing "waiting" chip, not a spinner — a loading spinner here would
        // falsely read as "something is loading" when it's actually waiting on the
        // human at the OS picker.
        return YggToolCard(
          name: name,
          detail: AppStrings.t('tool.waitingOnPhone'),
          statusLabel: AppStrings.t('tool.statusWaiting'),
          tone: YggChipTone.checking,
          pulse: true,
          action: TextButton(onPressed: onCancel, child: Text(AppStrings.t('common.cancel'))),
        );
      case 'cancelling':
        return YggToolCard(
          name: name,
          detail: AppStrings.t('tool.cancelling'),
          statusLabel: AppStrings.t('tool.statusRunning'),
          tone: YggChipTone.working,
          pulse: true,
        );
      case 'resolvedOk':
        return YggToolCard(
          name: name,
          detail: (detail != null && detail!.isNotEmpty) ? AppStrings.tp('tool.fileSelectedWithDetail', {'detail': detail!}) : AppStrings.t('tool.fileSelected'),
          statusLabel: AppStrings.t('tool.statusDone'),
          tone: YggChipTone.ready,
        );
      case 'cancelledByPhone':
        return YggToolCard(
          name: name,
          detail: AppStrings.t('tool.cancelledOnPhone'),
          statusLabel: AppStrings.t('tool.statusCancelled'),
          tone: YggChipTone.neutral,
        );
      case 'cancelled':
        return YggToolCard(
          name: name,
          detail: AppStrings.t('tool.cancelled'),
          statusLabel: AppStrings.t('tool.statusCancelled'),
          tone: YggChipTone.neutral,
        );
      case 'timedOut':
        return YggToolCard(
          name: name,
          detail: AppStrings.t('tool.phoneNoResponse'),
          statusLabel: AppStrings.t('tool.statusTimeout'),
          tone: YggChipTone.danger,
          action: retry,
        );
      case 'disconnected':
        return YggToolCard(
          name: name,
          detail: AppStrings.t('tool.connectionLostWaiting'),
          statusLabel: AppStrings.t('tool.statusTimeout'),
          tone: YggChipTone.danger,
          action: retry,
        );
      default: // failed
        return YggToolCard(
          name: name,
          detail: (detail != null && detail!.isNotEmpty) ? detail : AppStrings.tp('tool.failedGeneric', {'tool': toolName ?? ''}),
          statusLabel: AppStrings.t('tool.statusFailed'),
          tone: YggChipTone.danger,
        );
    }
  }
}
