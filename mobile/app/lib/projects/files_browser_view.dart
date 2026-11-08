import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';

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

  /// "/ › notes › features": the current path as mono breadcrumbs.
  Widget _breadcrumb() {
    final segments = _path.isEmpty ? <String>[] : _path.split('/');
    final crumb = TextStyle(fontFamily: YggFonts.mono, fontSize: 12.5, color: YggColors.textMuted);
    return Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      alignment: Alignment.centerLeft,
      decoration: BoxDecoration(color: YggColors.cardFillHigh, borderRadius: BorderRadius.circular(YggRadius.pill)),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        reverse: true,
        child: Row(
          children: [
            Text('/', style: crumb),
            for (var i = 0; i < segments.length; i++) ...[
              Padding(padding: const EdgeInsets.symmetric(horizontal: 6), child: Text('›', style: crumb.copyWith(color: YggColors.textFainter))),
              Text(segments[i], style: i == segments.length - 1 ? crumb.copyWith(color: YggColors.text) : crumb),
            ],
          ],
        ),
      ),
    );
  }

  Widget _entryRow(FileEntry entry) {
    return YggListRow(
      leading: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: entry.isDirectory ? YggColors.accentSoft : YggColors.cardFillHighest,
          borderRadius: BorderRadius.circular(YggRadius.md - 2),
        ),
        child: Icon(entry.isDirectory ? Icons.folder_outlined : Icons.insert_drive_file_outlined, size: 18, color: entry.isDirectory ? YggColors.accent : YggColors.textMuted),
      ),
      title: entry.name,
      chevron: entry.isDirectory,
      onTap: entry.isDirectory
          ? () => _descend(entry.name)
          : () => widget.onOpenFile(_path.isEmpty ? entry.name : '$_path/${entry.name}', entry.name),
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
    if (_entries.isEmpty) {
      return YggEmptyState(icon: Icons.folder_open_outlined, message: AppStrings.t('localProjects.emptyFiles'));
    }
    // Folders first, each group alphabetical (case-insensitive).
    int byName(FileEntry a, FileEntry b) => a.name.toLowerCase().compareTo(b.name.toLowerCase());
    final folders = _entries.where((e) => e.isDirectory).toList()..sort(byName);
    final files = _entries.where((e) => !e.isDirectory).toList()..sort(byName);
    return RefreshIndicator(
      onRefresh: _load,
      color: YggColors.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
        children: [
          if (folders.isNotEmpty) ...[
            YggSectionLabel(AppStrings.tp('files.folders', {'n': '${folders.length}'})),
            YggListGroup(children: [for (final e in folders) _entryRow(e)]),
            const SizedBox(height: 20),
          ],
          if (files.isNotEmpty) ...[
            YggSectionLabel(AppStrings.tp('files.files', {'n': '${files.length}'})),
            YggListGroup(children: [for (final e in files) _entryRow(e)]),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
          child: Row(
            children: [
              YggIconButton(
                icon: Icons.arrow_upward,
                tooltip: AppStrings.t('files.up'),
                onTap: _path.isEmpty ? null : _ascend,
              ),
              const SizedBox(width: 10),
              Expanded(child: _breadcrumb()),
            ],
          ),
        ),
        Expanded(child: _content()),
      ],
    );
  }
}
