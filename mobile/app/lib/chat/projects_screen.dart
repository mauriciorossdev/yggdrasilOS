import 'package:flutter/material.dart';

import '../hub/desktop_discovery.dart';
import '../hub/hub_link.dart';
import '../l10n/app_strings.dart';
import '../pi/pi_chat_screen.dart';
import '../pi/pi_settings.dart';
import '../projects/new_project_sheet.dart';
import '../projects/project_detail_screen.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';

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

  /// Projects open on desktops published to the link server — when the
  /// configured gateway is that server itself, projects.list above is empty and
  /// these are the only ones there are.
  HubLink? _hub;
  List<HubDesktop> _desktops = [];
  String? _connecting; // "desktopId/projectId"
  String _query = '';

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
      await pi.connectNetwork();
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
      YggSectionLabel(AppStrings.tp('newProject.onHost', {'host': _pi!.displayName})),
      YggListGroup(
        children: [
          for (final p in _piProjects)
            YggListRow(
              leading: const Icon(Icons.memory),
              title: p['name']?.toString() ?? '',
              trailing: p['alive'] == true ? YggChip(AppStrings.t('projects.chipOpen'), tone: YggChipTone.ready, dot: true) : null,
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
            ),
        ],
      ),
      const SizedBox(height: 22),
    ];
  }

  int get _desktopProjectCount =>
      _desktops.fold(0, (n, d) => n + d.projects.length);

  /// Opens a desktop project through its own gateway (Tailscale, LAN, then
  /// the link server's tunnel) without touching the active profile, so the
  /// assistant keeps talking to that server.
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
      YggSectionLabel(AppStrings.t('hub.onComputers')),
      YggListGroup(
        children: [
          for (final d in _desktops)
            for (final p in d.projects)
              YggListRow(
                leading: const Icon(Icons.computer),
                title: p.name,
                subtitle: _connecting == '${d.desktopId}/${p.id}' ? AppStrings.t('hub.connectingProject') : d.name,
                trailing: _connecting == '${d.desktopId}/${p.id}'
                    ? SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent))
                    : YggChip(AppStrings.t('projects.chipOpen'), tone: YggChipTone.ready, dot: true),
                onTap: _connecting == null ? () => _openDesktopProject(d, p) : null,
              ),
        ],
      ),
      const SizedBox(height: 22),
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
          // This screen's own connection: it keeps listing and opening projects afterwards.
          ownsClient: false,
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

  bool _matches(ProjectRecord p) {
    if (_query.isEmpty) return true;
    final q = _query.toLowerCase();
    return p.name.toLowerCase().contains(q) || p.path.toLowerCase().contains(q);
  }

  /// The open project, highlighted: its own card instead of a row in the list.
  Widget _openProjectCard(ProjectRecord project) {
    return YggCard(
      radius: YggRadius.lg,
      color: YggColors.surface,
      onTap: () => _openDetail(project),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: YggColors.accentSoft, borderRadius: BorderRadius.circular(YggRadius.md)),
            child: Icon(Icons.folder_outlined, size: 20, color: YggColors.accent),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(project.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: YggColors.text)),
                const SizedBox(height: 3),
                Text(compactPath(project.path), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: YggFonts.mono, fontSize: 11, color: YggColors.textMuted)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          YggChip(AppStrings.t('projects.chipOpen'), tone: YggChipTone.ready, dot: true),
        ],
      ),
    );
  }

  Widget _content() {
    if (_loading) return Center(child: CircularProgressIndicator(color: YggColors.accent));
    if (_error != null) {
      return YggEmptyState(
        icon: Icons.error_outline,
        message: '${AppStrings.t('common.errorPrefix')}: $_error',
        action: OutlinedButton(onPressed: _load, child: Text(AppStrings.t('common.retry'))),
      );
    }
    if (_projects.isEmpty && _desktops.isEmpty && _piProjects.isEmpty) {
      return YggEmptyState(icon: Icons.folder_open_outlined, message: AppStrings.t('projects.empty'));
    }

    final visible = _projects.where(_matches).toList();
    final open = visible.where((p) => p.isOpen).toList();
    final rest = visible.where((p) => !p.isOpen).toList();
    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        children: [
          if (_projects.isNotEmpty) ...[
            YggSearchField(hint: AppStrings.t('projects.searchHint'), onChanged: (v) => setState(() => _query = v.trim())),
            const SizedBox(height: 18),
          ],
          ..._desktopSection(),
          ..._piSection(),
          if (open.isNotEmpty) ...[
            YggSectionLabel(AppStrings.t('projects.openOnDesktop')),
            for (final project in open) ...[_openProjectCard(project), const SizedBox(height: 10)],
            const SizedBox(height: 12),
          ],
          if (rest.isNotEmpty) ...[
            YggSectionLabel(AppStrings.tp('projects.allProjects', {'n': '${rest.length}'})),
            YggListGroup(
              children: [
                for (final project in rest)
                  YggListRow(
                    title: project.name,
                    subtitle: compactPath(project.path),
                    subtitleMono: true,
                    subtitleLines: 1,
                    value: project.lastOpenedAt > 0 ? yggTimeAgo(project.lastOpenedAt) : null,
                    onTap: () => _openDetail(project),
                  ),
              ],
            ),
          ],
          if (visible.isEmpty && _projects.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 40),
              child: YggEmptyState(icon: Icons.search_off, message: AppStrings.t('projects.noMatches')),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return YggScreen(
      title: AppStrings.t('common.projects'),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _newProject,
        icon: const Icon(Icons.add),
        label: Text(AppStrings.t('newProject.fab')),
      ),
      body: _content(),
    );
  }
}
