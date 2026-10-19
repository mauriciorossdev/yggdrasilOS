import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import 'complemento_manifest.dart';
import 'complementos_repo.dart';
import 'ygg_bridge_js.dart';

final RegExp _scriptSrcTag = RegExp(r'<script[^>]*\ssrc="([^"]+)"[^>]*></script>');
final RegExp _stylesheetLinkTag = RegExp(r'<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"[^>]*/?>');
final RegExp _sdkScriptTag = RegExp(r'<script[^>]*\ssrc="ygg-plugin://sdk/ygg\.js"[^>]*></script>');

bool _isRemote(String src) => src.startsWith('http://') || src.startsWith('https://');

/// Splices a complemento's own app.js/styles.css straight into its
/// index.html (and the mobile ygg.js bridge in place of the
/// `ygg-plugin://sdk/ygg.js` tag desktop serves via its own custom
/// protocol) so `WebViewController.loadHtmlString` can render it as one
/// self-contained document — no custom scheme handler or on-device HTTP
/// server needed for what's normally just 2-3 small files. A remote
/// (http/https) script/stylesheet src is left as-is; it'll simply fail to
/// load under the CSP below, same outcome as desktop's `connect-src
/// 'none'` sandboxing already produces for anything a complemento wasn't
/// built to work fully offline for.
Future<String> _buildInlinedHtml(ComplementosRepo repo, ComplementoManifest manifest) async {
  final html = await repo.readFile(manifest.id, manifest.entry);
  var result = html;

  for (final match in _scriptSrcTag.allMatches(html).toList().reversed) {
    final src = match.group(1)!;
    if (src.startsWith('ygg-plugin://') || _isRemote(src)) continue;
    final content = await repo.readFile(manifest.id, src);
    result = result.replaceRange(match.start, match.end, '<script>\n$content\n</script>');
  }

  for (final match in _stylesheetLinkTag.allMatches(html).toList().reversed) {
    final href = match.group(1)!;
    if (_isRemote(href)) continue;
    final content = await repo.readFile(manifest.id, href);
    result = result.replaceRange(match.start, match.end, '<style>\n$content\n</style>');
  }

  result = result.replaceAll(_sdkScriptTag, '<script>\n$yggBridgeJs\n</script>');

  // Mirrors desktop's `connect-src 'none'` CSP intent — no network access
  // from inside a rendered complemento.
  const csp = '<meta http-equiv="Content-Security-Policy" '
      'content="default-src \'none\'; script-src \'unsafe-inline\'; '
      'style-src \'unsafe-inline\'; img-src data: blob:;">';
  result = result.contains('<head>') ? result.replaceFirst('<head>', '<head>\n$csp') : '$csp\n$result';
  return result;
}

class ComplementoWebViewScreen extends StatefulWidget {
  final YggdrasilClient client;
  final String projectId;
  final ComplementoManifest manifest;

  const ComplementoWebViewScreen({
    super.key,
    required this.client,
    required this.projectId,
    required this.manifest,
  });

  @override
  State<ComplementoWebViewScreen> createState() => _ComplementoWebViewScreenState();
}

class _ComplementoWebViewScreenState extends State<ComplementoWebViewScreen> {
  late final WebViewController _controller;
  late final ComplementosRepo _repo;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repo = ComplementosRepo(widget.client);
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('YggBridge', onMessageReceived: _onBridgeMessage);
    unawaited(_loadComplemento());
  }

  Future<void> _loadComplemento() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final html = await _buildInlinedHtml(_repo, widget.manifest);
      if (!mounted) return;
      await _controller.loadHtmlString(html);
      if (!mounted) return;
      setState(() => _loading = false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '$e';
      });
    }
  }

  String get _storagePrefix => 'yggdrasil_pref_complemento_${widget.projectId}_${widget.manifest.id}_';

  Future<void> _onBridgeMessage(JavaScriptMessage message) async {
    Map<String, dynamic> req;
    try {
      req = jsonDecode(message.message) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    final id = req['id']?.toString();
    final method = req['method']?.toString();
    if (id == null || method == null) return;
    final params = (req['params'] as Map?)?.cast<String, dynamic>() ?? <String, dynamic>{};

    try {
      final result = await _handleRequest(method, params);
      await _reply(id, result: result);
    } catch (e) {
      await _reply(id, error: '$e');
    }
  }

  Future<void> _reply(String id, {dynamic result, String? error}) async {
    final payload = jsonEncode({
      'type': 'res',
      'id': id,
      if (result != null) 'result': result,
      if (error != null) 'error': error,
    });
    await _controller.runJavaScript('window.__yggReceive($payload)');
  }

  Future<dynamic> _handleRequest(String method, Map<String, dynamic> params) async {
    switch (method) {
      case 'ready':
        return {
          'plugin': {'id': widget.manifest.id, 'name': widget.manifest.name},
        };
      case 'storage.get':
        return _storageGet(params['key'] as String);
      case 'storage.set':
        await _storageSet(params['key'] as String, params['value']);
        return null;
      case 'storage.delete':
        await _storageDelete(params['key'] as String);
        return null;
      case 'storage.keys':
        return _storageKeys();
      case 'fs.list':
        return widget.client.call('fs.list', {'relativePath': params['relativePath']});
      case 'fs.read':
        return widget.client.call('fs.read', {'relativePath': params['relativePath']});
      case 'app.notify':
        // No native-notification plumbing wired for a complemento's own
        // call yet — a SnackBar is the closest "the user actually sees
        // it" equivalent without adding a new permission.
        if (mounted) {
          final title = params['title']?.toString() ?? '';
          final body = params['body']?.toString() ?? '';
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(body.isEmpty ? title : '$title: $body')),
          );
        }
        return null;
      case 'app.theme':
        return 'dark'; // the app itself is dark-only today, see theme/ygg_theme.dart
      case 'app.info':
        return {'platform': 'mobile'};
      default:
        throw Exception(AppStrings.t('projects.complementoUnsupported'));
    }
  }

  Future<dynamic> _storageGet(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('$_storagePrefix$key');
    return raw == null ? null : jsonDecode(raw);
  }

  Future<void> _storageSet(String key, dynamic value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('$_storagePrefix$key', jsonEncode(value));
  }

  Future<void> _storageDelete(String key) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('$_storagePrefix$key');
  }

  Future<List<String>> _storageKeys() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getKeys().where((k) => k.startsWith(_storagePrefix)).map((k) => k.substring(_storagePrefix.length)).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.manifest.name, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loading ? null : _loadComplemento),
        ],
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading) const Center(child: CircularProgressIndicator(color: YggColors.accent)),
          if (_error != null)
            Container(
              color: YggColors.surface,
              alignment: Alignment.center,
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      AppStrings.t('projects.complementoLoadError'),
                      style: const TextStyle(color: YggColors.textMuted),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Text(_error!, style: const TextStyle(color: YggColors.textFaint, fontSize: 12)),
                    const SizedBox(height: 12),
                    ElevatedButton(onPressed: _loadComplemento, child: Text(AppStrings.t('common.retry'))),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
