import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'local_companion_client.dart';
import 'local_companion_settings.dart';
import 'local_file_viewer_screen.dart';
import 'local_terminal_screen.dart';

/// Inside one local project: a read-only file browser (list/descend/view,
/// no editing — v1 scope) plus a CLI chooser to launch a real terminal for
/// this project (claude / agy / shell), each via the companion's
/// /projects/:name/terminal endpoint.
class LocalProjectDetailScreen extends StatefulWidget {
  final LocalCompanionSettings settings;
  final LocalProject project;

  const LocalProjectDetailScreen({super.key, required this.settings, required this.project});

  @override
  State<LocalProjectDetailScreen> createState() => _LocalProjectDetailScreenState();
}

class _LocalProjectDetailScreenState extends State<LocalProjectDetailScreen> {
  late final LocalCompanionClient _client = LocalCompanionClient(widget.settings);
  String _path = '.';
  List<LocalFileEntry> _entries = [];
  bool _loading = true;
  String? _error;
  bool _launching = false;

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
    try {
      final entries = await _client.listFiles(widget.project.name, _path);
      if (!mounted) return;
      setState(() {
        _entries = entries;
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

  String _childPath(String name) => _path == '.' ? name : '$_path/$name';

  String get _parentPath {
    if (!_path.contains('/')) return '.';
    return _path.substring(0, _path.lastIndexOf('/'));
  }

  void _descend(LocalFileEntry entry) {
    setState(() => _path = _childPath(entry.name));
    _load();
  }

  void _ascend() {
    setState(() => _path = _parentPath);
    _load();
  }

  void _openFile(LocalFileEntry entry) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => LocalFileViewerScreen(client: _client, project: widget.project.name, path: _childPath(entry.name))),
    );
  }

  Future<void> _launchTerminal(String cli, String label) async {
    setState(() => _launching = true);
    try {
      final terminal = await _client.startTerminal(widget.project.name, cli);
      if (!mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => LocalTerminalScreen(title: '${widget.project.name} — $label', terminal: terminal)),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _launching = false);
    }
  }

  Widget _cliButton(String cli, String label, IconData icon) {
    return OutlinedButton.icon(
      onPressed: _launching ? null : () => _launchTerminal(cli, label),
      icon: Icon(icon, size: 16),
      label: Text(label),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.project.name)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _cliButton('claude', AppStrings.t('localProjects.cliClaude'), Icons.smart_toy_outlined),
                _cliButton('agy', AppStrings.t('localProjects.cliAntigravity'), Icons.rocket_launch_outlined),
                _cliButton('shell', AppStrings.t('localProjects.cliShell'), Icons.terminal),
                if (_launching) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
                : _error != null
                    ? Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text('${AppStrings.t('common.errorPrefix')}: $_error', style: const TextStyle(color: YggColors.textMuted)),
                      )
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(12, 6, 12, 20),
                        children: [
                          if (_path != '.')
                            ListTile(
                              leading: const Icon(Icons.arrow_upward, color: YggColors.textFaint, size: 18),
                              title: const Text('..'),
                              onTap: _ascend,
                            ),
                          for (final entry in _entries)
                            ListTile(
                              leading: Icon(
                                entry.isDir ? Icons.folder_outlined : Icons.insert_drive_file_outlined,
                                color: YggColors.text,
                                size: 18,
                              ),
                              title: Text(entry.name),
                              onTap: entry.isDir ? () => _descend(entry) : () => _openFile(entry),
                            ),
                          if (_entries.isEmpty && _path == '.')
                            Padding(
                              padding: const EdgeInsets.all(24),
                              child: Text(AppStrings.t('localProjects.emptyFiles'), style: const TextStyle(color: YggColors.textFaint)),
                            ),
                        ],
                      ),
          ),
        ],
      ),
    );
  }
}
