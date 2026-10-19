import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';
import 'local_companion_client.dart';

/// Embeds ttyd's own web terminal (full xterm.js UI, served by `ttyd`
/// itself — see mobile/termux/companion.js's /projects/:name/terminal) for a
/// real interactive `claude`/`agy`/shell session.
///
/// Auth goes through the real HTTP 401 challenge/response flow
/// (AndroidWebViewController.setOnHttpAuthRequest), not a header injected on
/// the initial loadRequest — confirmed on-device that the header approach
/// loads the ttyd page fine but leaves its frontend stuck on "Press ⏎ to
/// Reconnect": ttyd's WebSocket (the actual terminal stream) is a second,
/// separate HTTP request that browsers/WebView never expose custom headers
/// to from JS, so it only carries credentials the WebView already has
/// *cached* for that origin — which only happens by answering a real 401
/// challenge, never by pre-supplying a header on an unrelated request.
class LocalTerminalScreen extends StatefulWidget {
  final String title;
  final LocalTerminalInfo terminal;

  const LocalTerminalScreen({super.key, required this.title, required this.terminal});

  @override
  State<LocalTerminalScreen> createState() => _LocalTerminalScreenState();
}

class _LocalTerminalScreenState extends State<LocalTerminalScreen> {
  late final WebViewController _controller;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()..setJavaScriptMode(JavaScriptMode.unrestricted);

    // setOnHttpAuthRequest lives on PlatformNavigationDelegate (Android-
    // specific), not on the cross-platform NavigationDelegate wrapper — this
    // whole delegate replaces the plain `setNavigationDelegate(NavigationDelegate(...))`
    // call other screens use, since that convenience wrapper doesn't expose
    // the HTTP-auth-challenge hook at all.
    final delegate = PlatformNavigationDelegate(const PlatformNavigationDelegateCreationParams())
      ..setOnPageFinished((_) {
        if (mounted) setState(() => _loading = false);
      })
      ..setOnWebResourceError((error) {
        if (mounted) {
          setState(() {
            _loading = false;
            _error = error.description;
          });
        }
      });
    if (delegate is AndroidNavigationDelegate) {
      delegate.setOnHttpAuthRequest((request) {
        request.onProceed(WebViewCredential(user: 'user', password: widget.terminal.token));
      });
    }
    _controller.platform.setPlatformNavigationDelegate(delegate);
    _controller.loadRequest(Uri.parse(widget.terminal.url));
  }

  void _reload() {
    setState(() {
      _loading = true;
      _error = null;
    });
    _controller.reload();
  }

  // A touchscreen has no arrow/Esc/Tab/Ctrl keys, but xterm.js (ttyd's
  // frontend) only reacts to real KeyboardEvents dispatched at its hidden
  // input — `.xterm-helper-textarea` is xterm.js's own, stable class name
  // for that element, not something ttyd defines. Constructing a synthetic
  // KeyboardEvent with the right `key`/ctrlKey and dispatching it there is
  // the standard way to drive an xterm.js terminal from custom on-screen
  // buttons (xterm's keyboard handling switches on `event.key`, same as a
  // real browser would produce). This mirrors why Termux itself ships an
  // "extra keys" row above its own soft keyboard for the exact same reason.
  Future<void> _sendKey(String key, {bool ctrl = false, int keyCode = 0}) async {
    final jsKey = key.replaceAll("'", r"\'");
    await _controller.runJavaScript('''
      (function() {
        var el = document.querySelector('.xterm-helper-textarea');
        if (!el) return;
        el.focus();
        var ev = new KeyboardEvent('keydown', {
          key: '$jsKey',
          code: '$jsKey',
          keyCode: $keyCode,
          which: $keyCode,
          ctrlKey: ${ctrl ? 'true' : 'false'},
          bubbles: true,
          cancelable: true
        });
        el.dispatchEvent(ev);
      })();
    ''');
  }

  Widget _keyButton(String label, {required VoidCallback onPressed}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 3),
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(44, 40),
          padding: const EdgeInsets.symmetric(horizontal: 10),
          foregroundColor: YggColors.text,
          side: const BorderSide(color: YggColors.hairlineStrong),
        ),
        child: Text(label, style: const TextStyle(fontSize: 13)),
      ),
    );
  }

  Widget _buildExtraKeysBar() {
    return Container(
      color: YggColors.surface,
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 6),
        child: Row(
          children: [
            _keyButton('ESC', onPressed: () => _sendKey('Escape', keyCode: 27)),
            _keyButton('TAB', onPressed: () => _sendKey('Tab', keyCode: 9)),
            _keyButton('CTRL+C', onPressed: () => _sendKey('c', ctrl: true, keyCode: 67)),
            _keyButton('◀', onPressed: () => _sendKey('ArrowLeft', keyCode: 37)),
            _keyButton('▲', onPressed: () => _sendKey('ArrowUp', keyCode: 38)),
            _keyButton('▼', onPressed: () => _sendKey('ArrowDown', keyCode: 40)),
            _keyButton('▶', onPressed: () => _sendKey('ArrowRight', keyCode: 39)),
            _keyButton('ENTER', onPressed: () => _sendKey('Enter', keyCode: 13)),
            _keyButton('PGUP', onPressed: () => _sendKey('PageUp', keyCode: 33)),
            _keyButton('PGDN', onPressed: () => _sendKey('PageDown', keyCode: 34)),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _reload)],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
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
                            AppStrings.t('localProjects.terminalConnectError'),
                            style: const TextStyle(color: YggColors.textMuted),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 12),
                          ElevatedButton(onPressed: _reload, child: Text(AppStrings.t('common.retry'))),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          SafeArea(top: false, child: _buildExtraKeysBar()),
        ],
      ),
    );
  }
}
