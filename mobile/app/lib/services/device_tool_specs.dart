/// Wire-format view of the capability registry
/// (lib/capabilities/capability_registry.dart) — what both
/// yggdrasil_client.dart's device.tools.register (gateway mode) and the
/// standalone tool-loop advertise to the model. The declarations themselves
/// live in the registry so the two call sites can't drift apart.
///
/// `riskLevel` is standalone-only — gateway mode maps risk server-side by
/// tool name (methods.ts DEVICE_TOOL_RISK_LEVELS), the authoritative source.
library;

import '../capabilities/capability_registry.dart';
import 'capabilities_store.dart';

final List<Map<String, dynamic>> phoneDeviceToolSpecs = [for (final c in deviceCapabilities) c.toSpec()];

/// The subset of phoneDeviceToolSpecs the user hasn't turned off in
/// Configuración → Capacidades (capabilities-settings-design.md §4, point 2).
Future<List<Map<String, dynamic>>> enabledDeviceToolSpecs() async {
  final out = <Map<String, dynamic>>[];
  for (final spec in phoneDeviceToolSpecs) {
    if (await CapabilitiesStore.isEnabled(spec['name'] as String)) out.add(spec);
  }
  return out;
}
