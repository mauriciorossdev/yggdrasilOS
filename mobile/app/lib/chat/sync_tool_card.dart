import 'package:flutter/material.dart';

import '../capabilities/capability_registry.dart';
import '../l10n/app_strings.dart';

/// Sync device-tool progress card (open_app/list_installed_apps) — states
/// per mobile-chat-ux-flows.md §3. Shared between gateway and standalone
/// chat screens for the same reason as InteractiveToolCard: same 2 tools,
/// same visual contract, only how "retry" is wired differs.
class SyncToolCard extends StatelessWidget {
  final String status; // running|ok|error|timeout
  final String? toolName;
  final String? detail;
  final VoidCallback? onRetry;

  const SyncToolCard({
    super.key,
    required this.status,
    this.toolName,
    this.detail,
    this.onRetry,
  });

  static String _verb(String? toolName) {
    final key = capabilityByName(toolName)?.verbKey;
    return key != null ? AppStrings.t(key) : AppStrings.tp('tool.genericVerb', {'tool': toolName ?? ''});
  }

  static String _okLabel(String? toolName, String? detail) {
    final key = capabilityByName(toolName)?.okKey;
    if (key != null) return AppStrings.t(key);
    return (detail != null && detail.isNotEmpty)
        ? AppStrings.tp('tool.genericOkWithDetail', {'tool': toolName ?? '', 'detail': detail})
        : AppStrings.tp('tool.genericOk', {'tool': toolName ?? ''});
  }

  static String _errorLabel(String? toolName, String? detail) {
    final key = capabilityByName(toolName)?.errorKey;
    final base = key != null ? AppStrings.t(key) : AppStrings.tp('tool.failedGeneric', {'tool': toolName ?? ''});
    return (detail != null && detail.isNotEmpty) ? '$base — $detail' : base;
  }

  @override
  Widget build(BuildContext context) {
    switch (status) {
      case 'running':
        return _pill(context, [
          const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: 6),
          Flexible(child: Text('${_verb(toolName)}…')),
        ]);
      case 'ok':
        return _pill(context, [
          const Icon(Icons.check_circle_outline, size: 18),
          const SizedBox(width: 6),
          Flexible(child: Text(_okLabel(toolName, detail))),
        ]);
      case 'timeout':
        return _pill(
          context,
          [
            const Icon(Icons.error_outline, size: 18),
            const SizedBox(width: 6),
            Flexible(child: Text(AppStrings.t('tool.syncNoResponse'))),
          ],
          action: TextButton(onPressed: onRetry, child: Text(AppStrings.t('common.retry'))),
        );
      case 'denied':
        // Standalone-only local gate (Architect's ruling) — the user tapped
        // Rechazar on the confirmation dialog, never reached execution, so
        // there's no per-tool detail to show, just the generic reason.
        return _pill(context, [
          const Icon(Icons.block_outlined, size: 18),
          const SizedBox(width: 6),
          Flexible(child: Text(AppStrings.t('tool.deniedByUser'))),
        ]);
      default: // error
        return _pill(context, [
          const Icon(Icons.error_outline, size: 18),
          const SizedBox(width: 6),
          Flexible(child: Text(_errorLabel(toolName, detail))),
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
