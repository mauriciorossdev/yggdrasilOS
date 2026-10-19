import 'package:flutter/services.dart';

import '../capabilities/capability_registry.dart';
import '../services/capabilities_store.dart';

/// Standalone-mode tool execution — remote-access-analysis.md §7.2: same
/// phone_* tools as gateway mode, but the tool-loop and the executor are the
/// SAME process (this app), so there's no requestId/network/ceiling/RPC
/// cancellation — an interactive pick is just an awaited platform-channel
/// call, and cancelling it is a direct local call, not a round-trip.
class DeviceToolExecutor {
  bool _interactivePending = false;
  String? _pendingToolName;

  bool get isInteractivePending => _interactivePending;
  String? get pendingToolName => _pendingToolName;

  /// Best-effort — closes whatever native picker is open for the in-flight
  /// interactive call, if any. No-op if nothing is pending.
  Future<void> cancelPending() async {
    if (!_interactivePending) return;
    await capabilityByName(_pendingToolName)?.cancel?.call();
  }

  /// Throws PlatformException(code:'cancelled', message:'cancelled_by_user')
  /// on cancellation (same contract as gateway mode) so callers can share
  /// the same error-message handling.
  Future<Map<String, dynamic>> execute(
    String name,
    Map<String, dynamic> args, {
    void Function(String status)? onProgress,
  }) async {
    // Defense-in-depth (capabilities-settings-design.md §4 point 5) — covers
    // a toggle landing mid-flight or a stale cached tool list.
    if (!(await CapabilitiesStore.isEnabled(name))) {
      throw PlatformException(code: 'capability_disabled', message: 'capability_disabled');
    }
    final capability = capabilityByName(name);
    if (capability == null) throw Exception('Unknown device tool: $name');
    if (!capability.isInteractive) return capability.invoke(args);

    _interactivePending = true;
    _pendingToolName = name;
    onProgress?.call('awaiting_user');
    try {
      return await capability.invoke(args);
    } finally {
      _interactivePending = false;
      _pendingToolName = null;
    }
  }
}
