import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';

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
    switch (status) {
      case 'opening':
        return _pill(context, [
          const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: 6),
          Text(AppStrings.t('tool.openingPicker')),
        ]);
      case 'awaitingUser':
        // Static icon, no spinner — a loading spinner here would falsely
        // read as "something is loading" when it's actually waiting on the
        // human at the OS picker.
        return _pill(
          context,
          [
            const Icon(Icons.smartphone_outlined, size: 18),
            const SizedBox(width: 6),
            Flexible(child: Text(AppStrings.t('tool.waitingOnPhone'))),
          ],
          action: TextButton(onPressed: onCancel, child: Text(AppStrings.t('common.cancel'))),
        );
      case 'cancelling':
        return _pill(context, [
          const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: 6),
          Text(AppStrings.t('tool.cancelling')),
        ]);
      case 'resolvedOk':
        return _pill(context, [
          const Icon(Icons.check_circle_outline, size: 18),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              (detail != null && detail!.isNotEmpty) ? AppStrings.tp('tool.fileSelectedWithDetail', {'detail': detail!}) : AppStrings.t('tool.fileSelected'),
            ),
          ),
        ]);
      case 'cancelledByPhone':
        return _pill(context, [
          const Icon(Icons.cancel_outlined, size: 18),
          const SizedBox(width: 6),
          Flexible(child: Text(AppStrings.t('tool.cancelledOnPhone'))),
        ]);
      case 'cancelled':
        return _pill(context, [
          const Icon(Icons.cancel_outlined, size: 18),
          const SizedBox(width: 6),
          Flexible(child: Text(AppStrings.t('tool.cancelled'))),
        ]);
      case 'timedOut':
        return _pill(
          context,
          [
            const Icon(Icons.error_outline, size: 18),
            const SizedBox(width: 6),
            Flexible(child: Text(AppStrings.t('tool.phoneNoResponse'))),
          ],
          action: TextButton(onPressed: onRetry, child: Text(AppStrings.t('common.retry'))),
        );
      case 'disconnected':
        return _pill(
          context,
          [
            const Icon(Icons.error_outline, size: 18),
            const SizedBox(width: 6),
            Flexible(child: Text(AppStrings.t('tool.connectionLostWaiting'))),
          ],
          action: TextButton(onPressed: onRetry, child: Text(AppStrings.t('common.retry'))),
        );
      default: // failed
        return _pill(context, [
          const Icon(Icons.error_outline, size: 18),
          const SizedBox(width: 6),
          Flexible(
            child: Text((detail != null && detail!.isNotEmpty) ? detail! : AppStrings.tp('tool.failedGeneric', {'tool': toolName ?? ''})),
          ),
        ]);
    }
  }

  Widget _pill(BuildContext context, List<Widget> content, {Widget? action}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(mainAxisSize: MainAxisSize.min, children: content),
              ?action,
            ],
          ),
        ),
      ),
    );
  }
}
