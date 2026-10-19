import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../l10n/app_strings.dart';
import '../projects/terminal_view_screen.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';
import 'pi_attachments.dart';
import 'pi_model_button.dart';
import 'pi_settings.dart';
import 'pi_usage_sheet.dart';
import 'tailscale_channel.dart';

// Must match rpi-command-center's TMUX_SESSION (backend/src/config.js).
const piPaneId = 'claude-chat';
const _healthTimeout = Duration(seconds: 6);

/// The always-on Claude chat on the Pi. Claude itself lives in a tmux session
/// on the Pi (it never stops when this screen closes); this screen only owns
/// the WebSocket, and keeps it alive: reconnects with backoff when the socket
/// drops (network change, Pi reboot) and re-checks it when the app comes back
/// to the foreground, where iOS/Android often left a silently dead socket.
/// The chat UI itself is the regular TerminalViewScreen, rebuilt with a fresh
/// key on every new connection.
class PiChatScreen extends StatefulWidget {
  final PiSettings settings;

  /// A project's own pane on the Pi (proj-<slug>); null = the main chat.
  final String? projectId;
  final String? projectName;

  const PiChatScreen({super.key, required this.settings, this.projectId, this.projectName});

  @override
  State<PiChatScreen> createState() => _PiChatScreenState();
}

class _PiChatScreenState extends State<PiChatScreen> with WidgetsBindingObserver {
  YggdrasilClient? _client;
  int _generation = 0;
  int _attempt = 0;
  bool _connecting = false;
  String? _lastError;
  Timer? _retryTimer;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _connect();
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _retryTimer?.cancel();
    _client?.disconnect();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    final client = _client;
    if (client == null || client.isClosed) {
      _reconnectNow();
      return;
    }
    // Socket may look open but be dead after sleeping in the background.
    client.call('health', {}, timeout: _healthTimeout).catchError((_) {
      if (identical(client, _client)) _reconnectNow();
    });
  }

  void _reconnectNow() {
    _retryTimer?.cancel();
    _attempt = 0;
    _connect();
  }

  Future<void> _connect() async {
    if (_connecting || _disposed) return;
    _connecting = true;
    _client?.disconnect();
    if (mounted) setState(() => _client = null);
    // The Pi is only reachable inside the tailnet. Harmless if the VPN is
    // already up; if it wasn't, it takes a second or two, which the
    // backoff retries below absorb.
    await TailscaleChannel.connect();

    final client = YggdrasilClient(baseUrl: widget.settings.baseUrl, apiKey: widget.settings.apiKey);
    client.connectToMirror((_) {}, onDisconnected: () {
      if (identical(client, _client)) _scheduleRetry();
    });
    try {
      await client.call('health', {}, timeout: _healthTimeout);
      // tmux doesn't survive a Pi reboot: revive the project's session first.
      if (widget.projectId != null) {
        await client.call('projects.open', {'id': widget.projectId}, timeout: const Duration(seconds: 20));
      }
      if (_disposed) {
        client.disconnect();
        return;
      }
      _attempt = 0;
      setState(() {
        _client = client;
        _generation++;
        _lastError = null;
      });
    } catch (e) {
      client.disconnect();
      if (_disposed) return;
      setState(() => _lastError = '$e');
      _scheduleRetry();
    } finally {
      _connecting = false;
    }
  }

  void _scheduleRetry() {
    if (_disposed) return;
    _retryTimer?.cancel();
    // 1s, 2s, 4s ... capped at 30s.
    final delay = Duration(seconds: min(30, 1 << min(_attempt, 5)));
    _attempt++;
    if (mounted) setState(() => _client = null);
    _retryTimer = Timer(delay, _connect);
  }

  Future<String?> _attach(YggdrasilClient client) async {
    try {
      return await pickAndUploadToPi(client);
    } catch (e) {
      if (mounted) {
        final msg = e is Map ? (e['message'] ?? e).toString() : '$e';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${AppStrings.t('pi.attachFailed')}: $msg')));
      }
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final client = _client;
    if (client != null) {
      return TerminalViewScreen(
        key: ValueKey(_generation),
        client: client,
        paneId: widget.projectId ?? piPaneId,
        title: widget.projectName ?? AppStrings.t('pi.chatTitle'),
        harnessCommand: 'claude',
        appBarActions: [
          PiModelButton(key: ValueKey('model-$_generation'), client: client, paneId: widget.projectId),
          IconButton(
            tooltip: AppStrings.t('pi.usageTitle'),
            icon: const Icon(Icons.info_outline),
            onPressed: () => showPiUsageSheet(context, client),
          ),
        ],
        onAttach: () => _attach(client),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('pi.chatTitle'))),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircularProgressIndicator(color: YggColors.accent),
              const SizedBox(height: 16),
              Text(AppStrings.t('pi.reconnecting'), style: const TextStyle(color: YggColors.text)),
              if (_lastError != null) ...[
                const SizedBox(height: 8),
                Text(_lastError!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: YggColors.textMuted)),
              ],
              const SizedBox(height: 16),
              TextButton(onPressed: _reconnectNow, child: Text(AppStrings.t('pi.retryNow'))),
            ],
          ),
        ),
      ),
    );
  }
}
