import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import 'terminal_view_screen.dart';

class _Pane {
  final String id;
  final String title;
  final String cwd;
  final String? sessionKey;
  final bool working;
  final String? command;

  _Pane({
    required this.id,
    required this.title,
    required this.cwd,
    this.sessionKey,
    required this.working,
    this.command,
  });

  factory _Pane.fromJson(Map<String, dynamic> json) => _Pane(
    id: json['id']?.toString() ?? '',
    title: json['title']?.toString() ?? '',
    cwd: json['cwd']?.toString() ?? '',
    sessionKey: json['sessionKey']?.toString(),
    working: json['working'] == true,
    command: json['command']?.toString(),
  );
}

/// Live pane list — `client` is null when this project isn't open on the
/// computer right now (no live gateway to ask), or when project_detail_screen
/// couldn't connect to its gateway. Each desktop project has its own separate
/// gateway process; pane state lives in Electron's main process, reachable
/// only through THAT project's own gateway via terminals.list's bridge into
/// paneControlServer.ts — never through some other project's connection.
class TerminalsTab extends StatefulWidget {
  final YggdrasilClient? client;

  const TerminalsTab({super.key, required this.client});

  @override
  State<TerminalsTab> createState() => _TerminalsTabState();
}

class _TerminalsTabState extends State<TerminalsTab> {
  List<_Pane> _panes = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.client != null) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final client = widget.client;
    if (client == null) return;
    try {
      final res = await client.call('terminals.list', {});
      final list = (res is Map ? res['panes'] : null) as List<dynamic>? ?? [];
      if (!mounted) return;
      setState(() {
        _panes = list
            .map((e) => _Pane.fromJson(e as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.client == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            AppStrings.t('projects.notOpenOnComputer'),
            textAlign: TextAlign.center,
            style: const TextStyle(color: YggColors.textFaint),
          ),
        ),
      );
    }
    if (_loading)
      return const Center(
        child: CircularProgressIndicator(color: YggColors.accent),
      );
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          '${AppStrings.t('common.errorPrefix')}: $_error',
          style: const TextStyle(color: YggColors.textMuted),
        ),
      );
    }
    if (_panes.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            AppStrings.t('projects.noTerminals'),
            style: const TextStyle(color: YggColors.textFaint),
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 20),
        itemCount: _panes.length,
        itemBuilder: (_, i) {
          final pane = _panes[i];
          final statusLabel = pane.working
              ? AppStrings.t('projects.statusWorking')
              : AppStrings.t('projects.statusRunning');
          return GestureDetector(
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => TerminalViewScreen(
                  client: widget.client!,
                  paneId: pane.id,
                  title: pane.title,
                  harnessCommand: pane.command,
                ),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          pane.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 14.5,
                            color: YggColors.text,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          pane.cwd,
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
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: pane.working
                          ? YggColors.accent
                          : YggColors.cardFillHigh,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      statusLabel,
                      style: TextStyle(
                        fontSize: 11,
                        color: pane.working
                            ? YggColors.surface
                            : YggColors.textFaint,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
