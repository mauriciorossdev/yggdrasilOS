import 'package:flutter/material.dart';

import '../capabilities/capability_registry.dart';
import '../l10n/app_strings.dart';
import '../ui/ui.dart';

/// Sync device-tool progress card (open_app/list_installed_apps) — states
/// per mobile-chat-ux-flows.md §3. Shared between gateway and standalone
/// chat screens for the same reason as InteractiveToolCard: same 2 tools,
/// same visual contract, only how "retry" is wired differs.
class SyncToolCard extends StatelessWidget {
  final String status; // running|ok|error|timeout|denied
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
    final name = toolName ?? '';
    switch (status) {
      case 'running':
        return YggToolCard(
          name: name,
          detail: '${_verb(toolName)}…',
          statusLabel: AppStrings.t('tool.statusRunning'),
          tone: YggChipTone.working,
          pulse: true,
        );
      case 'ok':
        return YggToolCard(
          name: name,
          detail: _okLabel(toolName, detail),
          statusLabel: AppStrings.t('tool.statusDone'),
          tone: YggChipTone.ready,
        );
      case 'timeout':
        return YggToolCard(
          name: name,
          detail: AppStrings.t('tool.syncNoResponse'),
          statusLabel: AppStrings.t('tool.statusTimeout'),
          tone: YggChipTone.danger,
          action: TextButton(onPressed: onRetry, child: Text(AppStrings.t('common.retry'))),
        );
      case 'denied':
        // Standalone-only local gate (Architect's ruling) — the user tapped
        // Rechazar on the confirmation dialog, never reached execution, so
        // there's no per-tool detail to show, just the generic reason.
        return YggToolCard(
          name: name,
          detail: AppStrings.t('tool.deniedByUser'),
          statusLabel: AppStrings.t('tool.statusDenied'),
          tone: YggChipTone.neutral,
        );
      default: // error
        return YggToolCard(
          name: name,
          detail: _errorLabel(toolName, detail),
          statusLabel: AppStrings.t('tool.statusFailed'),
          tone: YggChipTone.danger,
        );
    }
  }
}
