import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_strings.dart';
import '../services/yggdrasil_client.dart';
import '../theme/ygg_theme.dart';

enum _Status { loading, connected, notConnected, connecting, error }

/// Google connector UI — external-actions-and-connectors-analysis.md §1.3-b
/// (phone-initiated OAuth). The token itself never reaches this screen or
/// this phone — it's exchanged and stored only on the gateway
/// (connectors.google.completeAuth); this widget only opens the system
/// browser, catches the redirect, and forwards the one-time code.
///
/// Gateway-only by design (§1.2): connectors need a gateway to hold the
/// token, so this screen is never reachable in direct/standalone mode
/// (SettingsScreen hides the row the same way it hides Configuración de
/// agente there).
///
/// Redirect URI confirmed with Backend: yggdrasil://oauth/google/callback,
/// fixed server-side via env var (GOOGLE_OAUTH_REDIRECT_URI) — the gateway
/// builds it into the authUrl on its own, this client never sends one.
/// AndroidManifest.xml's intent-filter must keep matching this scheme/host/
/// path if it ever changes on the gateway side. Shapes for
/// authUrl/completeAuth/status confirmed with Backend (see
/// YggdrasilClient's getGoogleAuthUrl/completeGoogleAuth/
/// getGoogleConnectionStatus). Real login
/// is user-supervised, never attempted by this session.
class GoogleConnectorScreen extends StatefulWidget {
  final YggdrasilClient client;

  const GoogleConnectorScreen({super.key, required this.client});

  @override
  State<GoogleConnectorScreen> createState() => _GoogleConnectorScreenState();
}

class _GoogleConnectorScreenState extends State<GoogleConnectorScreen> {
  _Status _status = _Status.loading;
  String? _errorDetail;
  AppLinks? _appLinks;
  StreamSubscription<Uri>? _linkSub;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    setState(() => _status = _Status.loading);
    try {
      final connected = await widget.client.getGoogleConnectionStatus();
      if (!mounted) return;
      setState(() => _status = connected ? _Status.connected : _Status.notConnected);
    } catch (_) {
      // connectors.google.status may not exist server-side yet (Backend
      // still building this) — don't block the connect button on that,
      // just assume not-connected until proven otherwise.
      if (!mounted) return;
      setState(() => _status = _Status.notConnected);
    }
  }

  Future<void> _connect() async {
    setState(() {
      _status = _Status.connecting;
      _errorDetail = null;
    });
    try {
      final auth = await widget.client.getGoogleAuthUrl();
      if (auth.authUrl.isEmpty) throw Exception('El gateway no devolvió una URL de autorización');

      _appLinks ??= AppLinks();
      final completer = Completer<Uri>();
      _linkSub?.cancel();
      _linkSub = _appLinks!.uriLinkStream.listen((uri) {
        if (uri.scheme == 'yggdrasil' && uri.host == 'oauth' && !completer.isCompleted) {
          completer.complete(uri);
        }
      });

      final launched = await launchUrl(Uri.parse(auth.authUrl), mode: LaunchMode.externalApplication);
      if (!launched) throw Exception('No se pudo abrir el navegador');

      final redirect = await completer.future.timeout(const Duration(minutes: 5));
      final code = redirect.queryParameters['code'];
      if (code == null || code.isEmpty) {
        throw Exception(redirect.queryParameters['error'] ?? 'La respuesta de Google no incluyó un código');
      }

      // `state` is the CSRF nonce from getGoogleAuthUrl() — the gateway
      // issued it and validates it single-use, so this must be the value we
      // stored from that call, not (necessarily) whatever the redirect
      // echoes back.
      final ok = await widget.client.completeGoogleAuth(code: code, state: auth.state);
      if (!mounted) return;
      setState(() => _status = ok ? _Status.connected : _Status.error);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _status = _Status.error;
        _errorDetail = e.toString();
      });
    } finally {
      _linkSub?.cancel();
      _linkSub = null;
    }
  }

  String _statusLabel() {
    switch (_status) {
      case _Status.loading:
        return AppStrings.t('connectors.checkingStatus');
      case _Status.connected:
        return AppStrings.t('connectors.connected');
      case _Status.connecting:
        return AppStrings.t('connectors.connecting');
      case _Status.notConnected:
        return AppStrings.t('connectors.notConnected');
      case _Status.error:
        return AppStrings.t('connectors.statusUnknown');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('connectors.title'))),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: YggColors.cardFillHigh, borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.calendar_month_outlined, color: YggColors.text),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Google', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: YggColors.text)),
                      Text(_statusLabel(), style: const TextStyle(fontSize: 12, color: YggColors.textMuted)),
                    ],
                  ),
                ),
                if (_status == _Status.loading || _status == _Status.connecting)
                  const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: YggColors.accent))
                else if (_status == _Status.connected)
                  const Icon(Icons.check_circle, color: YggColors.accent),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              AppStrings.t('connectors.googleDescription'),
              style: const TextStyle(fontWeight: FontWeight.w300, fontSize: 13, color: YggColors.textMuted, height: 1.4),
            ),
            if (_status == _Status.error) ...[
              const SizedBox(height: 10),
              Text(
                _errorDetail ?? AppStrings.t('connectors.errorGeneric'),
                style: const TextStyle(fontSize: 12, color: YggColors.errorRed),
              ),
            ],
            const SizedBox(height: 22),
            if (_status != _Status.connected)
              SizedBox(
                width: double.infinity,
                height: 46,
                child: ElevatedButton(
                  onPressed: _status == _Status.connecting ? null : _connect,
                  style: ElevatedButton.styleFrom(backgroundColor: YggColors.accent, foregroundColor: YggColors.surface),
                  child: Text(_status == _Status.connecting ? AppStrings.t('connectors.connecting') : AppStrings.t('connectors.connect')),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
