import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'local_companion_client.dart';

/// Read-only text preview — v1 scope per local-projects-termux-design.md:
/// no editing, no binary/image preview (the companion itself already
/// rejects binaries and caps size; this just renders whatever text it
/// returns).
class LocalFileViewerScreen extends StatefulWidget {
  final LocalCompanionClient client;
  final String project;
  final String path;

  const LocalFileViewerScreen({super.key, required this.client, required this.project, required this.path});

  @override
  State<LocalFileViewerScreen> createState() => _LocalFileViewerScreenState();
}

class _LocalFileViewerScreenState extends State<LocalFileViewerScreen> {
  String? _content;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final content = await widget.client.readFile(widget.project, widget.path);
      if (!mounted) return;
      setState(() {
        _content = content;
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
    final fileName = widget.path.split('/').last;
    return Scaffold(
      appBar: AppBar(title: Text(fileName)),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: YggColors.accent))
          : _error != null
              ? Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('${AppStrings.t('common.errorPrefix')}: $_error', style: const TextStyle(color: YggColors.textMuted)),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: SelectableText(
                    _content ?? '',
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, color: YggColors.text),
                  ),
                ),
    );
  }
}
