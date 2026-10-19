import 'dart:async';
import 'dart:io';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import 'assistant/assistant_home_screen.dart';
import 'bubble/bubble_assistant_main.dart';
import 'hub/desktop_discovery.dart';
import 'hub/hub_link.dart';
import 'services/push_service.dart';
import 'l10n/app_strings.dart';
import 'projects/open_projects_deep_link.dart';
import 'profiles/connection_profile.dart';
import 'profiles/profile_store.dart';
import 'services/locale_store.dart';
import 'services/voice_notification_channel.dart';
import 'services/voice_trigger_bus.dart';
import 'services/yggdrasil_client.dart';
import 'theme/ygg_theme.dart';
import 'workflows_local/background_entry.dart';

void main() {
  runApp(const YggdrasilApp());
}

/// Native resolves this name in the root library, so it must live here (BackgroundRunner.kt).
@pragma('vm:entry-point')
void workflowBackgroundMain() => runAutomationBackground();

/// Engine entrypoint for the quick-access bubble's UI-less brain (BubbleBrain.kt).
@pragma('vm:entry-point')
void bubbleAssistantMain() => runBubbleAssistant();

/// App shell: owns the single YggdrasilClient/WS connection and fans out
/// every gateway event ({type:"event",...}, per server.ts) to whichever
/// ChatScreen is listening. Screens live under chat/ and only ever call
/// YggdrasilClient's existing public methods (call/sendMessage/etc) —
/// yggdrasil_client.dart itself is Backend's territory right now.
class YggdrasilApp extends StatefulWidget {
  const YggdrasilApp({super.key});

  @override
  State<YggdrasilApp> createState() => _YggdrasilAppState();
}

class _YggdrasilAppState extends State<YggdrasilApp> {
  late YggdrasilClient _client;
  String _status = 'Desconectado';
  List<dynamic> _slashCommands = [];
  final _eventsController = StreamController<Map<String, dynamic>>.broadcast();
  late Future<void> _connectFuture;

  // Which ConnectionProfile _client is currently wired to — lets
  // _applyProfile no-op on the frequent re-syncs ChatListScreen._load()
  // triggers instead of tearing down/reconnecting a socket that's already
  // pointed at the right place.
  ConnectionProfile? _connectedProfile;
  bool _initialSyncDone = false;

  // Chat list "●" indicator (UX doc §1.1) — a session has something pending
  // the user hasn't seen (approval or device-tool-invoke request) until it
  // resolves or the user opens that chat. sessions.list has no such field
  // yet (flagged for Architect in the doc's §6.5), so this is inferred
  // client-side from the same event stream ChatScreen consumes.
  final Set<String> _pendingSessions = {};

  // Global deep-link listener (voice-notification-shortcut-design.md §1.2) —
  // catches yggdrasil://voice/listen from the notification's tap target
  // regardless of which screen/ComposerBar is currently mounted; local to
  // GoogleConnectorScreen is where yggdrasil://oauth/... still gets handled,
  // untouched by this.
  AppLinks? _appLinks;
  StreamSubscription<Uri>? _voiceLinkSub;
  StreamSubscription<void>? _pushOpenSub;

  // Lets a deep link (yggdrasil://projects, home screen widget) push a
  // screen from here — outside any BuildContext's own widget tree — the
  // same way ChatListScreen's own "Proyectos" button already does.
  final _navigatorKey = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    _client = YggdrasilClient(baseUrl: 'http://127.0.0.1:18889', apiKey: '');
    _connectFuture = _syncToActiveProfile();
    LocaleStore.get().then((saved) {
      if (saved != null && saved.isNotEmpty) AppStrings.current = saved;
      // Posted after the saved locale (if any) is applied so the
      // notification's copy matches it on first post, not always 'es'.
      _postVoiceNotification();
    });
    _initVoiceDeepLink();
    _initPush();
  }

  Future<void> _linkHub(HubLink link) async {
    await applyHubLink(link);
    await _onProfileChanged();
    final context = _navigatorKey.currentContext;
    if (context != null && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.t('hub.linked'))));
    }
  }

  // A desktop profile found through the hub stopped answering — most likely the
  // desktop restarted and its project gateway got a new port. Ask the hub where
  // it is now and switch over without the user retyping anything.
  bool _refreshingHub = false;
  Future<void> _onConnectionLost() async {
    if (_refreshingHub) return;
    _refreshingHub = true;
    try {
      final active = await ProfileStore.getActive();
      if (active == null || !active.isFromHub) return;
      await Future<void>.delayed(const Duration(seconds: 3));
      if (await refreshHubProfile(active)) await _onProfileChanged();
    } catch (_) {
      // Hub unreachable too: the client keeps retrying the old address.
    } finally {
      _refreshingHub = false;
    }
  }

  Future<void> _openAssistantFromLink() async {
    for (var i = 0; i < 20 && _navigatorKey.currentContext == null; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    final context = _navigatorKey.currentContext;
    if (context == null || !context.mounted) return;
    await openAssistantChat(
      context,
      client: _client,
      events: _eventsController.stream,
      connected: _connectFuture,
      slashCommands: _slashCommands,
      onOpenSession: _clearPending,
    );
  }

  // Tapping a gateway push (reminder, pending action) opens the assistant chat.
  void _initPush() {
    _pushOpenSub = PushService.instance.openAssistantRequests.listen((_) async {
      // On a cold start the navigator may not be mounted yet.
      for (var i = 0; i < 20 && _navigatorKey.currentContext == null; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 250));
      }
      final context = _navigatorKey.currentContext;
      if (context == null || !context.mounted) return;
      unawaited(openAssistantChat(
        context,
        client: _client,
        events: _eventsController.stream,
        connected: _connectFuture,
        slashCommands: _slashCommands,
        onOpenSession: _clearPending,
      ));
    });
    unawaited(PushService.instance.init());
  }

  @override
  void dispose() {
    _voiceLinkSub?.cancel();
    _pushOpenSub?.cancel();
    _eventsController.close();
    super.dispose();
  }

  Future<void> _initVoiceDeepLink() async {
    _appLinks = AppLinks();
    try {
      final initial = await _appLinks!.getInitialLink();
      if (initial != null) _handleDeepLink(initial);
    } catch (_) {
      // Best-effort — a failed initial-link read shouldn't block startup.
    }
    _voiceLinkSub = _appLinks!.uriLinkStream.listen(_handleDeepLink);
  }

  // yggdrasil://voice/listen (voice-notification-shortcut-design.md §1.2, also
  // the home screen mic widget) and yggdrasil://projects (home screen
  // Proyectos widget) — same scheme, different host, same disambiguation
  // Android already does for yggdrasil://oauth/... (handled locally by
  // GoogleConnectorScreen, untouched by this).
  void _handleDeepLink(Uri uri) {
    if (uri.scheme != 'yggdrasil') return;
    if (uri.host == 'voice' && uri.path == '/listen') {
      VoiceTriggerBus.fire();
    } else if (uri.host == 'projects') {
      unawaited(openProjectsFromDeepLink(_navigatorKey));
    } else if (uri.host == 'hub') {
      // Opened from the desktop's QR / link: learn the Railway gateway.
      final link = HubLink.parse(uri.toString());
      if (link != null) unawaited(_linkHub(link));
    } else if (uri.host == 'assistant') {
      // Tapping the quick-access bubble: straight to the main assistant chat.
      unawaited(_openAssistantFromLink());
    }
  }

  // §2.1/§2.4: request POST_NOTIFICATIONS (no-op pre-Android 13) and post
  // the ongoing tap-to-listen notification once per app open — MainActivity
  // itself is the "app was opened" event, no BOOT_COMPLETED needed (§2.4).
  Future<void> _postVoiceNotification() async {
    if (!Platform.isAndroid) return;
    await Permission.notification.request();
    await VoiceNotificationChannel.post(
      title: AppStrings.t('voiceNotification.title'),
      body: AppStrings.t('voiceNotification.body'),
      actionLabel: AppStrings.t('voiceNotification.action'),
      channelName: AppStrings.t('voiceNotification.channelName'),
      channelDescription: AppStrings.t('voiceNotification.channelDescription'),
    );
  }

  Future<void> _syncToActiveProfile() async {
    final profile = await ProfileStore.getActive();
    await _applyProfile(profile);
  }

  // settings-consolidation-proposal.md §1/§4.1 — the active ConnectionProfile
  // is now the only source of truth for "where do I connect", replacing the
  // old standalone "URL del gateway" setting (main.dart used to hold its own
  // separate _baseUrl, entirely disconnected from ProfileStore — that was
  // the bug the proposal closes). A direct-mode profile never touches this
  // client at all (DirectChatScreen/StandaloneChatEngine run their own
  // tool-loop) — attempting a connect anyway would just sit there forever:
  // YggdrasilClient.call() has no timeout on a dead/wrong channel, so a
  // wasted connect for a client nothing uses is worse than skipping it.
  Future<void> _applyProfile(ConnectionProfile? profile) async {
    if (_initialSyncDone && _sameConnection(profile, _connectedProfile)) return;
    _initialSyncDone = true;
    _client.disconnect();
    _connectedProfile = profile;

    if (profile != null && profile.type == ConnectionProfileType.direct) {
      setState(() => _status = 'Modo directo (sin gateway)');
      return;
    }

    // profile == null (no profiles saved yet) falls back to the same default
    // a fresh install always used — treated as gateway-eligible, matching
    // the settings screen's "Conectar a un gateway" CTA for this state.
    final baseUrl = (profile?.baseUrl?.isNotEmpty ?? false) ? profile!.baseUrl! : 'http://127.0.0.1:18889';
    final apiKey = profile?.apiKey ?? '';
    setState(() {
      _client = YggdrasilClient(baseUrl: baseUrl, apiKey: apiKey);
      _status = 'Conectando a $baseUrl…';
    });
    await _connect();
  }

  bool _sameConnection(ConnectionProfile? a, ConnectionProfile? b) {
    if (a == null || b == null) return a == b;
    return a.id == b.id && a.baseUrl == b.baseUrl && a.apiKey == b.apiKey && a.type == b.type;
  }

  Future<void> _connect() async {
    try {
      // Each (re)connect re-registers the push token under this device's id.
      final client = _client;
      client.onDeviceRegistered = () => unawaited(PushService.instance.registerWith(client));
      _client.connectToMirror((dynamic message) {
        // Only {type:"event",...} pushed traffic reaches this callback —
        // request/response pairs are resolved inside YggdrasilClient.call,
        // and device.tool.invoke.requested is handled there too.
        if (message is Map<String, dynamic> && message['type'] == 'event') {
          _eventsController.add(message);
          _trackPending(message);
        }
      }, onDisconnected: () => unawaited(_onConnectionLost()));

      await _client.refreshConfig();
      final cmds = await _client.getSlashCommands();

      setState(() {
        _slashCommands = cmds;
        _status = 'Connected to ${_client.baseUrl}';
      });
    } catch (e) {
      unawaited(_onConnectionLost());
      setState(() {
        _status = 'Error: $e';
      });
    }
  }

  Future<void> _onProfileChanged() async {
    final future = _syncToActiveProfile();
    setState(() => _connectFuture = future);
    await future;
  }

  void _trackPending(Map<String, dynamic> message) {
    final event = message['event']?.toString();
    final payload = message['payload'];
    final sessionKey = payload is Map ? payload['sessionKey']?.toString() : null;
    if (sessionKey == null) return;
    switch (event) {
      case 'tool.approval.requested':
      case 'device.tool.invoke.requested':
        if (_pendingSessions.add(sessionKey)) setState(() {});
        break;
      case 'tool.approval.resolved':
      case 'turn.end':
        if (_pendingSessions.remove(sessionKey)) setState(() {});
        break;
      default:
        break;
    }
  }

  void _clearPending(String sessionKey) {
    if (_pendingSessions.remove(sessionKey)) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    // Listening to AppStrings.localeNotifier here means any code anywhere
    // (SettingsScreen's language row) can flip AppStrings.current and have
    // the whole app re-render in the new language — no callback threading
    // needed the way onProfileChanged required.
    return ValueListenableBuilder<String>(
      valueListenable: AppStrings.localeNotifier,
      builder: (context, _, _) => MaterialApp(
        navigatorKey: _navigatorKey,
        title: 'Yggdrasil',
        theme: buildYggTheme(),
        home: AssistantHomeScreen(
          client: _client,
          events: _eventsController.stream,
          connected: _connectFuture,
          status: _status,
          slashCommands: _slashCommands,
          onProfileChanged: _onProfileChanged,
          pendingSessions: _pendingSessions,
          onOpenSession: _clearPending,
        ),
      ),
    );
  }
}
