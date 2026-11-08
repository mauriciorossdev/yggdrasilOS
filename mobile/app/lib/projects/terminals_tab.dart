import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';
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

  Widget _paneCard(_Pane pane) {
    final title = terminalDisplayTitle(pane.title);
    return YggCard(
      color: YggColors.surface,
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => TerminalViewScreen(
            client: widget.client!,
            paneId: pane.id,
            title: title,
            harnessCommand: pane.command,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: YggColors.text)),
              ),
              const SizedBox(width: 10),
              pane.working
                  ? YggChip(AppStrings.t('projects.statusWorking'), tone: YggChipTone.working, dot: true, pulse: true)
                  : YggChip(AppStrings.t('projects.statusRunning'), tone: YggChipTone.ready, dot: true),
            ],
          ),
          if (pane.cwd.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(compactPath(pane.cwd), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: YggFonts.mono, fontSize: 11, color: YggColors.textMuted)),
          ],
          if (pane.command != null && pane.command!.isNotEmpty) ...[
            const SizedBox(height: 10),
            YggChip(pane.command!),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.client == null) {
      return YggEmptyState(icon: Icons.terminal, message: AppStrings.t('projects.notOpenOnComputer'));
    }
    if (_loading) {
      return Center(child: CircularProgressIndicator(color: YggColors.accent));
    }
    if (_error != null) {
      return YggEmptyState(
        icon: Icons.error_outline,
        message: '${AppStrings.t('common.errorPrefix')}: $_error',
        action: OutlinedButton(onPressed: _load, child: Text(AppStrings.t('common.retry'))),
      );
    }
    if (_panes.isEmpty) {
      return YggEmptyState(icon: Icons.terminal, message: AppStrings.t('projects.noTerminals'), hint: AppStrings.t('projects.terminalsHint'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          for (final pane in _panes) ...[_paneCard(pane), const SizedBox(height: 10)],
          const SizedBox(height: 14),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              AppStrings.t('projects.terminalsHint'),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, height: 1.5, color: YggColors.textFainter),
            ),
          ),
        ],
      ),
    );
  }
}
