import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';
import 'hub_link.dart';
import 'hub_rpc.dart';

class HubProject {
  final String id;
  final String name;
  final int port;

  const HubProject(this.id, this.name, this.port);
}

/// One desktop as published in the hub (gateway desktops.list).
class HubDesktop {
  final String desktopId;
  final String name;
  final bool online;
  final int lastSeen;
  final List<HubProject> projects;
  final String? lan;
  final String? tailscale;
  final String? gatewayKey;

  /// The desktop keeps its tunnel socket open on the hub: reachable from any network.
  final bool tunnel;

  const HubDesktop({
    required this.desktopId,
    required this.name,
    required this.online,
    required this.lastSeen,
    required this.projects,
    this.lan,
    this.tailscale,
    this.gatewayKey,
    this.tunnel = false,
  });

  factory HubDesktop.fromJson(Map<String, dynamic> json) {
    final endpoints = (json['endpoints'] as Map?) ?? const {};
    return HubDesktop(
      desktopId: json['desktopId']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Desktop',
      online: json['online'] == true,
      lastSeen: (json['lastSeen'] as num?)?.toInt() ?? 0,
      projects: ((json['projects'] as List?) ?? const [])
          .map((p) => (p as Map).cast<String, dynamic>())
          .map((p) => HubProject(p['id']?.toString() ?? '', p['name']?.toString() ?? '', (p['port'] as num?)?.toInt() ?? 0))
          .where((p) => p.id.isNotEmpty && p.port > 0)
          .toList(),
      lan: endpoints['lan']?.toString(),
      tailscale: endpoints['tailscale']?.toString(),
      gatewayKey: json['gatewayKey']?.toString(),
      tunnel: json['tunnel'] == true,
    );
  }

  /// Where to try a project's gateway, best first: direct paths are faster
  /// (Tailscale from any network, the LAN address on the same wifi); the hub
  /// tunnel works from anywhere as long as the desktop keeps it open.
  List<String> candidateBaseUrls(HubProject project, {String? hubUrl}) => [
        if (tailscale != null && tailscale!.isNotEmpty) 'http://$tailscale:${project.port}',
        if (lan != null && lan!.isNotEmpty) 'http://$lan:${project.port}',
        if (tunnel && hubUrl != null && hubUrl.isNotEmpty) tunnelBaseUrl(hubUrl, desktopId, project.id),
      ];
}

typedef Prober = Future<bool> Function(String baseUrl, String apiKey);

/// The hub relay path for one desktop project (packages/gateway/src/tunnel.ts).
String tunnelBaseUrl(String hubUrl, String desktopId, String projectId) =>
    '${hubUrl.replaceAll(RegExp(r'/+$'), '')}/tunnel/$desktopId/${Uri.encodeComponent(projectId)}';

bool isTunnelUrl(String baseUrl) => baseUrl.contains('/tunnel/');

Future<List<HubDesktop>> listHubDesktops(HubLink hub) async {
  final res = await hubRpc(hub.url, hub.key, 'desktops.list', const {});
  final list = (res is Map ? res['desktops'] : null) as List? ?? const [];
  return list.map((d) => HubDesktop.fromJson((d as Map).cast<String, dynamic>())).toList();
}

/// First candidate address that answers with this desktop's key, or null.
Future<String?> firstReachable(HubDesktop desktop, HubProject project, {String? hubUrl, Prober probe = probeGateway}) async {
  final key = desktop.gatewayKey ?? '';
  for (final url in desktop.candidateBaseUrls(project, hubUrl: hubUrl)) {
    if (await probe(url, key)) return url;
  }
  return null;
}

/// Creates (or updates) the profile for [project] on [desktop] pointing at
/// [baseUrl], and makes it the active one.
Future<ConnectionProfile> saveDesktopProfile(HubDesktop desktop, HubProject project, String baseUrl) async {
  ConnectionProfile? profile;
  for (final p in await ProfileStore.list()) {
    if (p.hubDesktopId == desktop.desktopId && p.hubProjectId == project.id) profile = p;
  }
  profile ??= ConnectionProfile(
    id: 'desk-${DateTime.now().millisecondsSinceEpoch}',
    name: '${desktop.name} · ${project.name}',
    type: ConnectionProfileType.gateway,
    hubDesktopId: desktop.desktopId,
    hubProjectId: project.id,
  );
  profile
    ..baseUrl = baseUrl
    ..apiKey = desktop.gatewayKey;
  await ProfileStore.upsert(profile);
  await ProfileStore.setActiveId(profile.id);
  return profile;
}

/// For a profile that came from the hub and stopped answering (the desktop
/// restarted, so its port changed): asks the hub where that project is now and
/// updates the profile. True if the address changed.
Future<bool> refreshHubProfile(ConnectionProfile profile, {Prober probe = probeGateway}) async {
  if (!profile.isFromHub) return false;
  final hub = await HubStore.saved();
  if (hub == null) return false;
  final desktops = await listHubDesktops(hub);
  for (final d in desktops) {
    if (d.desktopId != profile.hubDesktopId || !d.online) continue;
    for (final p in d.projects) {
      if (p.id != profile.hubProjectId) continue;
      final url = await firstReachable(d, p, hubUrl: hub.url, probe: probe);
      if (url == null || (url == profile.baseUrl && d.gatewayKey == profile.apiKey)) return false;
      profile
        ..baseUrl = url
        ..apiKey = d.gatewayKey;
      await ProfileStore.upsert(profile);
      return true;
    }
  }
  return false;
}
