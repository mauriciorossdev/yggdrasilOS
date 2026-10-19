import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

class FileEntry {
  final String name;
  final bool isDirectory;

  FileEntry({required this.name, required this.isDirectory});

  factory FileEntry.fromJson(Map<String, dynamic> json) => FileEntry(
    name: json['name']?.toString() ?? '',
    isDirectory: json['type'] == 'directory',
  );
}

/// Browsable project file tree, sourced from the gateway's `fs.list` RPC
/// (packages/gateway/src/methods.ts) — scoped to that project's own
/// workspaceRoot on the live per-project gateway, same connection
/// TerminalsTab already uses (so this only works while the project is open
/// on the computer, exactly like Terminales). Pure list-and-navigate widget:
/// the caller decides what tapping a file actually does (push a screen,
/// FilesTab; swap an inline preview, ProjectWorkspaceScreen's preview panel).
class FilesBrowserView extends StatefulWidget {
  final YggdrasilClient client;
  final void Function(String relativePath, String name) onOpenFile;

  const FilesBrowserView({super.key, required this.client, required this.onOpenFile});

  @override
  State<FilesBrowserView> createState() => _FilesBrowserViewState();
}

class _FilesBrowserViewState extends State<FilesBrowserView> {
  String _path = '';
  List<FileEntry> _entries = [];
  bool _loading = true;
  String? _error;

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
      final res = await widget.client.call('fs.list', {'relativePath': _path});
      final list = (res is Map ? res['entries'] : null) as List<dynamic>? ?? [];
      if (!mounted) return;
      setState(() {
        _entries = list.map((e) => FileEntry.fromJson(e as Map<String, dynamic>)).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is Map ? (e['message'] ?? e).toString() : '$e';
        _loading = false;
      });
    }
  }

  void _descend(String name) {
    setState(() => _path = _path.isEmpty ? name : '$_path/$name');
    _load();
  }

  void _ascend() {
    final segments = _path.split('/')..removeLast();
    setState(() => _path = segments.join('/'));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_path.isNotEmpty)
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: _ascend,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                child: Row(
                  children: [
                    const Icon(Icons.arrow_upward, size: 16, color: YggColors.textFaint),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '/$_path',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 12, color: YggColors.textFaint),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
              : _error != null
              ? Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    '${AppStrings.t('common.errorPrefix')}: $_error',
                    style: const TextStyle(color: YggColors.textMuted),
                  ),
                )
              : _entries.isEmpty
              ? Center(
                  child: Text(
                    AppStrings.t('localProjects.emptyFiles'),
                    style: const TextStyle(color: YggColors.textFaint),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    itemCount: _entries.length,
                    itemBuilder: (_, i) {
                      final entry = _entries[i];
                      return ListTile(
                        dense: true,
                        leading: Icon(
                          entry.isDirectory ? Icons.folder : Icons.insert_drive_file_outlined,
                          size: 20,
                          color: entry.isDirectory ? YggColors.accent : YggColors.textFaint,
                        ),
                        title: Text(
                          entry.name,
                          style: const TextStyle(fontSize: 13.5, color: YggColors.text),
                        ),
                        onTap: entry.isDirectory
                            ? () => _descend(entry.name)
                            : () => widget.onOpenFile(
                                _path.isEmpty ? entry.name : '$_path/${entry.name}',
                                entry.name,
                              ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }
}
