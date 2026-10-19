import '../services/yggdrasil_client.dart';
import 'gateway_settings.dart';

/// Opens a fresh connection scoped to whatever's saved under Ajustes >
/// Gateway — separate from main.dart's single long-lived `_client`, which
/// tracks the active chat ConnectionProfile instead (gateway or direct).
/// Screens using this own the lifetime of the returned client: call
/// `disconnect()` when they're done with it (see ProjectsScreen).
class GatewayConnection {
  static Future<YggdrasilClient?> resolve() async {
    final settings = await GatewaySettingsStore.load();
    if (!settings.isReady) return null;

    final client = YggdrasilClient(
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey ?? '',
    );
    client.connectToMirror((_) {});
    // `call()` just queues onto the (already-open) WS sink and returns a
    // Future that only resolves once the response round-trips — awaiting a
    // cheap method here is what actually waits for connect+auth to finish,
    // same role `_client.refreshConfig()` plays in main.dart's `_connect()`.
    await client.call('health', {});
    return client;
  }

  /// Connects to a DIFFERENT project's own gateway — same host as the saved
  /// Gateway setting (every project's gateway is spawned locally by the same
  /// desktop app, so they all share one reachable host), different port.
  /// Used for project_detail_screen.dart's Terminales tab: each open project
  /// has its own gateway process, so live pane/turn data for project X is
  /// only ever available through X's OWN gateway (see projects.list's
  /// `gatewayPort`, sourced from main/openGateways.ts) — never through
  /// whichever gateway happens to be configured under Ajustes > Gateway.
  static Future<YggdrasilClient?> resolveForPort(int port) async {
    final settings = await GatewaySettingsStore.load();
    if (!settings.isReady) return null;

    final uri = Uri.tryParse(settings.baseUrl);
    if (uri == null || uri.host.isEmpty) return null;
    final scheme = uri.scheme.isEmpty ? 'ws' : uri.scheme;
    final baseUrl = '$scheme://${uri.host}:$port';

    final client = YggdrasilClient(
      baseUrl: baseUrl,
      apiKey: settings.apiKey ?? '',
    );
    client.connectToMirror((_) {});
    await client.call('health', {});
    return client;
  }
}
