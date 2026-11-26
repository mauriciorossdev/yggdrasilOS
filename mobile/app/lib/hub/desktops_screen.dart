import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../profiles/profile_editor_screen.dart';
import '../profiles/profile_store.dart';
import 'desktop_discovery.dart';
import 'hub_link.dart';
import 'hub_scan_screen.dart';

/// Desktops published to the link server (Ajustes → Teléfono on the desktop).
/// Tapping a project finds an address that answers (Tailscale, then LAN),
/// creates the profile with the published key and makes it active.
class DesktopsScreen extends StatefulWidget {
  /// Opened from Proyectos: set up Proyectos on the picked computer but leave
  /// the chat where it is (e.g. on the always-on assistant).
  final bool forProjects;

  const DesktopsScreen({super.key, this.forProjects = false});

  @override
  State<DesktopsScreen> createState() => _DesktopsScreenState();
}

class _DesktopsScreenState extends State<DesktopsScreen> {
  HubLink? _hub;
  List<HubDesktop> _desktops = [];
  bool _loading = true;
  String? _error;
  String? _connecting; // "desktopId/projectId"

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final hub = await HubStore.current();
    if (hub == null) {
      if (mounted) {
        setState(() {
          _hub = null;
          _loading = false;
        });
      }
      return;
    }
    try {
      final desktops = await listHubDesktops(hub);
      if (!mounted) return;
      setState(() {
        _hub = hub;
        _desktops = desktops;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _hub = hub;
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _scan() async {
    final linked = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const HubScanScreen()));
    if (linked == true) _load();
  }

  Future<void> _connect(HubDesktop desktop, HubProject project) async {
    setState(() => _connecting = '${desktop.desktopId}/${project.id}');
    try {
      final url = await firstReachable(desktop, project, hubUrl: _hub?.url);
      if (!mounted) return;
      if (url == null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.t('hub.unreachable'))));
        return;
      }
      final profile = await saveDesktopProfile(desktop, project, url, switchChat: !widget.forProjects);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppStrings.tp(widget.forProjects ? 'hub.projectsReady' : 'hub.connected', {'name': profile.name}))),
      );
      Navigator.pop(context, true);
    } finally {
      if (mounted) setState(() => _connecting = null);
    }
  }

  /// How the phone can reach this project, in words ("En tu red Wi-Fi · Por
  /// internet") — the raw IP:port meant nothing to anyone and changes on every
  /// desktop restart anyway.
  String _routesLabel(HubDesktop desktop, HubProject project) {
    final labels = <String>{};
    for (final url in desktop.candidateBaseUrls(project, hubUrl: _hub?.url)) {
      if (isTunnelUrl(url)) {
        labels.add(AppStrings.t('hub.viaTunnel'));
      } else if (desktop.tailscale != null && Uri.tryParse(url)?.host == desktop.tailscale) {
        labels.add(AppStrings.t('hub.viaTailscale'));
      } else {
        labels.add(AppStrings.t('hub.viaLan'));
      }
    }
    return labels.join('  ·  ');
  }

  // "Avanzado": typing a gateway URL by hand, for setups without the QR.
  Future<void> _manual() async {
    final hadActive = await ProfileStore.getActiveId() != null;
    if (!mounted) return;
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const ProfileEditorScreen()));
    if (saved != true) return;
    if (!hadActive) {
      final profiles = await ProfileStore.list();
      if (profiles.isNotEmpty) {
        profiles.sort((a, b) => b.createdAt.compareTo(a.createdAt));
        await ProfileStore.setActiveId(profiles.first.id);
      }
    }
    if (mounted) Navigator.pop(context, true);
  }

  String _ago(int ms) {
    final m = (DateTime.now().millisecondsSinceEpoch - ms) ~/ 60000;
    if (m < 1) return AppStrings.t('hub.justNow');
    if (m < 60) return AppStrings.tp('hub.minutesAgo', {'n': '$m'});
    return AppStrings.tp('hub.hoursAgo', {'n': '${m ~/ 60}'});
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(AppStrings.t('hub.desktopsTitle')),
        actions: [
          IconButton(onPressed: _scan, icon: const Icon(Icons.qr_code_scanner), tooltip: AppStrings.t('hub.scanTitle')),
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _hub == null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(AppStrings.t('hub.noHub'), textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        ElevatedButton.icon(
                          onPressed: _scan,
                          icon: const Icon(Icons.qr_code_scanner),
                          label: Text(AppStrings.t('hub.scanTitle')),
                        ),
                        const SizedBox(height: 8),
                        TextButton(onPressed: _manual, child: Text(AppStrings.t('connect.manual'))),
                      ],
                    ),
                  ),
                )
              : _error != null
                  ? Center(child: Padding(padding: const EdgeInsets.all(32), child: Text('${AppStrings.t('hub.loadError')}\n$_error', textAlign: TextAlign.center)))
                  : _desktops.isEmpty
                      ? Center(child: Padding(padding: const EdgeInsets.all(32), child: Text(AppStrings.t('hub.noDesktops'), textAlign: TextAlign.center)))
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            children: [
                              for (final d in _desktops) ...[
                                ListTile(
                                  leading: Icon(Icons.computer, color: d.online ? colors.primary : colors.outline),
                                  title: Text(d.name),
                                  subtitle: Text(
                                    d.online ? AppStrings.t('hub.online') : '${AppStrings.t('hub.offline')} · ${_ago(d.lastSeen)}',
                                  ),
                                ),
                                if (d.online && d.projects.isEmpty)
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(72, 0, 16, 12),
                                    child: Text(AppStrings.t('hub.noProjectsOpen')),
                                  ),
                                if (d.online)
                                  for (final p in d.projects)
                                    ListTile(
                                      contentPadding: const EdgeInsets.only(left: 72, right: 16),
                                      title: Text(p.name),
                                      subtitle: Text(_routesLabel(d, p)),
                                      trailing: _connecting == '${d.desktopId}/${p.id}'
                                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                          : const Icon(Icons.chevron_right),
                                      onTap: _connecting == null ? () => _connect(d, p) : null,
                                    ),
                                const Divider(height: 1),
                              ],
                            ],
                          ),
                        ),
    );
  }
}
