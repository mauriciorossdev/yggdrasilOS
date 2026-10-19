import 'package:flutter/material.dart';

import '../hub/desktop_discovery.dart';
import '../hub/hub_link.dart';
import '../l10n/app_strings.dart';
import '../pi/pi_chat_screen.dart';
import '../pi/pi_settings.dart';
import '../pi/tailscale_channel.dart';
import '../projects/new_project_sheet.dart';
import '../projects/project_detail_screen.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

/// Mirrors app-desktop's ProjectRecord (packages/app-desktop/src/main/
/// projects.ts) — id/name/path/createdAt/lastOpenedAt, as returned by the
/// gateway's projects.list.
class ProjectRecord {
  final String id;
  final String name;
  final String path;
  final int lastOpenedAt;

  /// Whether this project currently has a live gateway on the computer, and
  /// its port — added by the gateway's projects.list from
  /// main/openGateways.ts, lets a mobile client connect straight to that
  /// project's own gateway (see project_detail_screen.dart's Terminales tab)
  /// instead of guessing.
  final bool isOpen;
  final int? gatewayPort;

  ProjectRecord({
    required this.id,
    required this.name,
    required this.path,
    required this.lastOpenedAt,
    this.isOpen = false,
    this.gatewayPort,
  });

  factory ProjectRecord.fromJson(Map<String, dynamic> json) => ProjectRecord(
    id: json['id']?.toString() ?? '',
    name: json['name']?.toString() ?? '',
    path: json['path']?.toString() ?? '',
    lastOpenedAt: (json['lastOpenedAt'] as num?)?.toInt() ?? 0,
    isOpen: json['isOpen'] == true,
    gatewayPort: (json['gatewayPort'] as num?)?.toInt(),
  );
}

/// Read-only mirror of the desktop sidebar's collapsible "Projects" section —
/// managing a project (terminals, file tree, ...) stays a desktop-only
/// concern; this just lets the phone see what's there.
class ProjectsScreen extends StatefulWidget {
  final YggdrasilClient client;

  const ProjectsScreen({super.key, required this.client});

  @override
  State<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends State<ProjectsScreen> {
  List<ProjectRecord> _projects = [];
  bool _loading = true;
  String? _error;

  /// Projects open on desktops published to the Railway hub — when the
  /// configured gateway is Railway itself, projects.list above is empty and
  /// these are the only ones there are.
  HubLink? _hub;
  List<HubDesktop> _desktops = [];
  String? _connecting; // "desktopId/projectId"

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    widget.client.disconnect();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final desktops = Future.wait([_loadDesktops(), _loadPi()]);
    try {
      final res = await widget.client.call('projects.list', {});
      final list =
          (res is Map ? res['projects'] : null) as List<dynamic>? ?? [];
      await desktops;
      if (!mounted) return;
      setState(() {
        _projects = list
            .map((e) => ProjectRecord.fromJson(e as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (e) {
      await desktops;
      if (!mounted) return;
      setState(() {
        _error = _desktopProjectCount > 0 ? null : '$e';
        _loading = false;
      });
    }
  }

  Future<void> _loadDesktops() async {
    try {
      final hub = await HubStore.current();
      if (hub == null) return;
      final desktops = await listHubDesktops(hub);
      _hub = hub;
      _desktops = desktops
          .where((d) => d.online && d.projects.isNotEmpty)
          .toList();
    } catch (_) {
      // The hub is optional here — the list just shows what projects.list had.
    }
  }

  /// Projects on the Raspberry Pi (term-bridge's projects.list), when it's set up.
  PiSettings? _pi;
  List<Map<String, dynamic>> _piProjects = [];

  Future<void> _loadPi() async {
    YggdrasilClient? client;
    try {
      final pi = await PiSettingsStore.load();
      if (!pi.isReady) return;
      await TailscaleChannel.connect();
      client = YggdrasilClient(baseUrl: pi.baseUrl, apiKey: pi.apiKey);
      client.connectToMirror((_) {});
      final res = await client.call('projects.list', {}, timeout: const Duration(seconds: 6));
      _pi = pi;
      _piProjects = ((res is Map ? res['projects'] : null) as List? ?? const [])
          .map((e) => (e as Map).cast<String, dynamic>())
          .toList();
    } catch (_) {
      // Pi offline or bridge not updated yet — the list just omits its section.
      _piProjects = [];
    } finally {
      client?.disconnect();
    }
  }

  List<Widget> _piSection() {
    if (_pi == null || _piProjects.isEmpty) return const [];
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 14, 12, 4),
        child: Text(
          AppStrings.t('newProject.onPi'),
          style: const TextStyle(fontSize: 12.5, color: YggColors.textMuted),
        ),
      ),
      for (final p in _piProjects)
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => PiChatScreen(
                settings: _pi!,
                projectId: p['id']?.toString(),
                projectName: p['name']?.toString(),
              ),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 12),
            child: Row(
              children: [
                const Icon(Icons.memory, size: 18, color: YggColors.textFaint),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    p['name']?.toString() ?? '',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14.5, color: YggColors.text),
                  ),
                ),
                if (p['alive'] == true)
                  Container(
                    width: 8,
                    height: 8,
                    margin: const EdgeInsets.only(left: 8),
                    decoration: const BoxDecoration(color: YggColors.accent, shape: BoxShape.circle),
                  ),
              ],
            ),
          ),
        ),
    ];
  }

  int get _desktopProjectCount =>
      _desktops.fold(0, (n, d) => n + d.projects.length);

  /// Opens a desktop project through its own gateway (Tailscale, LAN, then
  /// the Railway tunnel) without touching the active profile, so the
  /// assistant keeps talking to Railway.
  Future<void> _openDesktopProject(
    HubDesktop desktop,
    HubProject project,
  ) async {
    setState(() => _connecting = '${desktop.desktopId}/${project.id}');
    YggdrasilClient? client;
    try {
      final url = await firstReachable(desktop, project, hubUrl: _hub?.url);
      if (url == null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(AppStrings.t('hub.unreachable'))),
          );
        }
        return;
      }
      client = YggdrasilClient(baseUrl: url, apiKey: desktop.gatewayKey ?? '');
      client.connectToMirror((_) {});
      await client.call('health', {});
      if (!mounted) return;
      setState(() => _connecting = null);
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ProjectDetailScreen(
            client: client!,
            projectClient: client,
            project: ProjectRecord(
              id: project.id,
              name: project.name,
              path: isTunnelUrl(url)
                  ? '${desktop.name} · ${AppStrings.t('hub.viaTunnel')}'
                  : '${desktop.name} · ${url.replaceFirst('http://', '')}',
              lastOpenedAt: 0,
              isOpen: true,
              gatewayPort: project.port,
            ),
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${AppStrings.t('common.errorPrefix')}: $e')),
        );
      }
    } finally {
      client?.disconnect();
      if (mounted) setState(() => _connecting = null);
    }
  }

  List<Widget> _desktopSection() {
    if (_desktops.isEmpty) return const [];
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 14, 12, 4),
        child: Text(
          AppStrings.t('hub.onComputers'),
          style: const TextStyle(fontSize: 12.5, color: YggColors.textMuted),
        ),
      ),
      for (final d in _desktops)
        for (final p in d.projects)
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _connecting == null ? () => _openDesktopProject(d, p) : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 12),
              child: Row(
                children: [
                  const Icon(
                    Icons.computer,
                    size: 18,
                    color: YggColors.textFaint,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          p.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 14.5,
                            color: YggColors.text,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _connecting == '${d.desktopId}/${p.id}'
                              ? AppStrings.t('hub.connectingProject')
                              : d.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12.5,
                            color: YggColors.textFaint,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_connecting == '${d.desktopId}/${p.id}')
                    const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: YggColors.accent,
                      ),
                    )
                  else
                    Container(
                      width: 8,
                      height: 8,
                      margin: const EdgeInsets.only(left: 8),
                      decoration: const BoxDecoration(
                        color: YggColors.accent,
                        shape: BoxShape.circle,
                      ),
                    ),
                ],
              ),
            ),
          ),
    ];
  }

  /// Computers (and the Pi) a new project can be created on from here.
  Future<List<NewProjectTarget>> _newProjectTargets() async {
    final targets = <NewProjectTarget>[];
    // The gateway this screen is connected to, when it's a desktop one (its
    // projects.list is only non-empty on a desktop).
    if (_projects.isNotEmpty) {
      targets.add(
        desktopTarget(
          label: AppStrings.t('newProject.thisComputer'),
          connect: () async => widget.client,
        ),
      );
    }
    for (final d in _desktops) {
      final project = d.projects.first;
      targets.add(
        desktopTarget(
          label: d.name,
          connect: () async {
            final url = await firstReachable(d, project, hubUrl: _hub?.url);
            if (url == null) throw AppStrings.t('hub.unreachable');
            final client = YggdrasilClient(baseUrl: url, apiKey: d.gatewayKey ?? '');
            client.connectToMirror((_) {});
            return client;
          },
        ),
      );
    }
    final pi = await PiSettingsStore.load();
    if (pi.isReady && mounted) targets.add(piTarget(context, pi));
    return targets;
  }

  Future<void> _newProject() async {
    final targets = await _newProjectTargets();
    if (!mounted) return;
    if (targets.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppStrings.t('newProject.noTargets'))),
      );
      return;
    }
    final created = await showNewProjectSheet(context, targets);
    if (created == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppStrings.t('newProject.created'))),
      );
      _load();
    }
  }

  void _openDetail(ProjectRecord project) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            ProjectDetailScreen(client: widget.client, project: project),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('common.projects'))),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _newProject,
        icon: const Icon(Icons.add),
        label: Text(AppStrings.t('newProject.fab')),
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: YggColors.accent),
            )
          : _error != null
          ? Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                '${AppStrings.t('common.errorPrefix')}: $_error',
                style: const TextStyle(color: YggColors.textMuted),
              ),
            )
          : _projects.isEmpty && _desktops.isEmpty && _piProjects.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  AppStrings.t('projects.empty'),
                  style: const TextStyle(color: YggColors.textFaint),
                ),
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              color: YggColors.accent,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 20),
                children: [
                  ..._desktopSection(),
                  ..._piSection(),
                  for (final project in _projects)
                    GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => _openDetail(project),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: 11,
                          horizontal: 12,
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    project.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 14.5,
                                      color: YggColors.text,
                                    ),
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    project.path,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 12.5,
                                      color: YggColors.textFaint,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (project.isOpen)
                              Container(
                                width: 8,
                                height: 8,
                                margin: const EdgeInsets.only(left: 8),
                                decoration: const BoxDecoration(
                                  color: YggColors.accent,
                                  shape: BoxShape.circle,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}
