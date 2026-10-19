import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import 'file_viewer_screen.dart';
import 'files_browser_view.dart';

/// Real file browser for the project detail screen's "Files" tab, replacing
/// the old placeholder — the gateway's `fs.list`/`fs.read` RPCs it needed
/// already existed (packages/gateway/src/methods.ts), unused by any mobile
/// screen until now. `client` is null under the same condition TerminalsTab
/// treats as "not open" — fs.list/fs.read only exist on that project's own
/// live gateway process (ctx.workspaceRoot), so this needs the project open
/// on the computer just like Terminales does.
class FilesTab extends StatelessWidget {
  final YggdrasilClient? client;

  const FilesTab({super.key, required this.client});

  @override
  Widget build(BuildContext context) {
    final client = this.client;
    if (client == null) {
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
    return FilesBrowserView(
      client: client,
      onOpenFile: (path, name) => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => FileViewerScreen(client: client, relativePath: path)),
      ),
    );
  }
}
