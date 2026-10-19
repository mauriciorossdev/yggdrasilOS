import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import 'file_content_view.dart';
import 'files_browser_view.dart';

enum _PreviewMode { file, web }

/// Right-hand side of ProjectWorkspaceScreen's split view: a segmented
/// Archivo/Web toggle over either a project file browser+viewer (fs.list/
/// fs.read, same as FilesTab) or a WebView pointed at a port on the SAME
/// host as the project's gateway (dev servers the orchestrator starts run on
/// the desktop machine, not on this phone — "localhost" here would mean the
/// phone itself, so the URL is built from the gateway connection's own host).
class WorkspacePreviewPanel extends StatefulWidget {
  final YggdrasilClient client;
  final String projectPath;

  const WorkspacePreviewPanel({super.key, required this.client, required this.projectPath});

  @override
  State<WorkspacePreviewPanel> createState() => _WorkspacePreviewPanelState();
}

class _WorkspacePreviewPanelState extends State<WorkspacePreviewPanel> {
  _PreviewMode _mode = _PreviewMode.file;
  String? _openFilePath;

  final _portController = TextEditingController();
  String? _loadedUrl;
  WebViewController? _webController;
  bool _webLoading = false;

  @override
  void initState() {
    super.initState();
    _restoreLastPort();
  }

  @override
  void dispose() {
    _portController.dispose();
    super.dispose();
  }

  String get _portPrefKey => 'workspace_port_${widget.projectPath}';

  Future<void> _restoreLastPort() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_portPrefKey);
    if (saved != null && mounted) {
      _portController.text = saved;
    }
  }

  void _goToPort() {
    final port = _portController.text.trim();
    if (port.isEmpty) return;
    SharedPreferences.getInstance().then((prefs) => prefs.setString(_portPrefKey, port));

    final host = Uri.parse(widget.client.baseUrl).host;
    final url = 'http://$host:$port';
    setState(() {
      _loadedUrl = url;
      _webLoading = true;
      _webController = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setNavigationDelegate(
          NavigationDelegate(
            onPageFinished: (_) {
              if (mounted) setState(() => _webLoading = false);
            },
          ),
        )
        ..loadRequest(Uri.parse(url));
    });
  }

  Widget _segmentedToggle() {
    Widget button(String label, _PreviewMode value) {
      final active = _mode == value;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() => _mode = value),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: BoxDecoration(
              color: active ? YggColors.accent : YggColors.cardFillHigh,
              borderRadius: BorderRadius.circular(10),
            ),
            alignment: Alignment.center,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: active ? YggColors.surface : YggColors.text,
              ),
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
      child: Row(
        children: [
          button(AppStrings.t('projects.previewFile'), _PreviewMode.file),
          const SizedBox(width: 8),
          button(AppStrings.t('projects.previewWeb'), _PreviewMode.web),
        ],
      ),
    );
  }

  Widget _fileMode() {
    final openPath = _openFilePath;
    if (openPath != null) {
      return Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(
                children: [
                  IconButton(
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    icon: const Icon(Icons.arrow_back, size: 18, color: YggColors.textFaint),
                    onPressed: () => setState(() => _openFilePath = null),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      openPath,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 12, color: YggColors.text),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(child: FileContentView(client: widget.client, relativePath: openPath)),
          ],
        ),
      );
    }
    return Expanded(
      child: FilesBrowserView(
        client: widget.client,
        onOpenFile: (path, name) => setState(() => _openFilePath = path),
      ),
    );
  }

  Widget _webMode() {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _portController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 13, color: YggColors.text),
                    decoration: InputDecoration(
                      isDense: true,
                      prefixText: 'localhost:',
                      hintText: AppStrings.t('projects.webPortHint'),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onSubmitted: (_) => _goToPort(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.arrow_forward, color: YggColors.accent),
                  onPressed: _goToPort,
                ),
                if (_loadedUrl != null)
                  IconButton(
                    icon: const Icon(Icons.refresh, color: YggColors.text),
                    onPressed: () => _webController?.reload(),
                  ),
              ],
            ),
          ),
          Expanded(
            child: _loadedUrl == null
                ? Center(
                    child: Text(
                      AppStrings.t('projects.webPortEmpty'),
                      style: const TextStyle(color: YggColors.textFaint),
                    ),
                  )
                : Stack(
                    children: [
                      WebViewWidget(controller: _webController!),
                      if (_webLoading) const Center(child: CircularProgressIndicator(color: YggColors.accent)),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _segmentedToggle(),
        if (_mode == _PreviewMode.file) _fileMode() else _webMode(),
      ],
    );
  }
}
