import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import 'desktop_discovery.dart';
import 'hub_link.dart';
import 'hub_scan_screen.dart';

/// Desktops published to the Railway hub (Ajustes → Teléfono on the desktop).
/// Tapping a project finds an address that answers (Tailscale, then LAN),
/// creates the profile with the published key and makes it active.
class DesktopsScreen extends StatefulWidget {
  const DesktopsScreen({super.key});

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
      final profile = await saveDesktopProfile(desktop, project, url);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppStrings.tp('hub.connected', {'name': profile.name}))),
      );
      Navigator.pop(context, true);
    } finally {
      if (mounted) setState(() => _connecting = null);
    }
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
                                      subtitle: Text(
                                        d
                                            .candidateBaseUrls(p, hubUrl: _hub?.url)
                                            .map((u) => isTunnelUrl(u) ? AppStrings.t('hub.viaTunnel') : u.replaceFirst('http://', ''))
                                            .join('  ·  '),
                                      ),
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
