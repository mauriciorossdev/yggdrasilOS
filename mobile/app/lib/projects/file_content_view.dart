import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

/// Read-only text preview of one project file, fetched via the gateway's
/// `fs.read` RPC (packages/gateway/src/methods.ts) — scoped to that
/// project's own workspaceRoot, same live per-project gateway connection
/// TerminalsTab/TerminalChatView already use. No syntax highlighting, same
/// tradeoff local_projects/local_file_viewer_screen.dart makes for the
/// Termux-hosted file viewer.
class FileContentView extends StatefulWidget {
  final YggdrasilClient client;
  final String relativePath;

  const FileContentView({super.key, required this.client, required this.relativePath});

  @override
  State<FileContentView> createState() => _FileContentViewState();
}

class _FileContentViewState extends State<FileContentView> {
  String? _content;
  String? _error;
  bool _loading = true;
  bool _truncated = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant FileContentView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.relativePath != widget.relativePath || oldWidget.client != widget.client) {
      setState(() {
        _content = null;
        _error = null;
        _loading = true;
        _truncated = false;
      });
      _load();
    }
  }

  Future<void> _load() async {
    try {
      final res = await widget.client.call('fs.read', {'relativePath': widget.relativePath});
      if (!mounted) return;
      setState(() {
        _content = (res is Map ? res['content'] : null)?.toString() ?? '';
        _truncated = res is Map && res['truncated'] == true;
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

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: YggColors.accent));
    }
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          '${AppStrings.t('common.errorPrefix')}: $_error',
          style: const TextStyle(color: YggColors.textMuted),
        ),
      );
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_truncated)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                AppStrings.t('projects.fileTruncated'),
                style: const TextStyle(color: YggColors.textFaint, fontSize: 12),
              ),
            ),
          SelectableText(
            _content ?? '',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, color: YggColors.text, height: 1.4),
          ),
        ],
      ),
    );
  }
}
