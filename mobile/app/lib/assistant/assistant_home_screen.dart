import 'dart:async';

import 'package:flutter/material.dart';

import '../chat/chat_list_screen.dart';
import '../chat/chat_screen.dart';
import 'assistant_route.dart';
import '../hub/connect_flow.dart';
import '../l10n/app_strings.dart';
import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';
import '../services/yggdrasil_client.dart';
import '../standalone/direct_chat_screen.dart';
import '../theme/ygg_theme.dart';
import '../ui/ui.dart';
import '../voice/voice_mode_screen.dart';

/// The one persistent assistant conversation — see
/// notes/asistente-personal/diseno.md. Gateway mode always opens the same
/// session/agent pair, so history, compaction and memory live server-side.
/// Direct mode reuses a single fixed local chat id instead.
const assistantSessionKey = 'assistant:main';
const assistantAgentId = 'assistant';
const assistantDirectChatId = 'assistant-main';

/// Opens the one assistant conversation, wherever [resolveAssistantRoute]
/// says it lives: the link server's assistant (switching the chat connection to
/// it if needed), the phone's own API key, the active computer's default agent,
/// or the connect screen. Shared by the home button and notification taps.
/// [voice]: the home circle opens voice mode for the API-key route.
Future<void> openAssistantChat(
  BuildContext context, {
  required YggdrasilClient client,
  required Stream<Map<String, dynamic>> events,
  required Future<void> connected,
  required List<dynamic> slashCommands,
  required void Function(String sessionKey) onOpenSession,
  bool voice = false,
}) async {
  // Checking whether the assistant answers can take a few seconds when it's down.
  final messenger = ScaffoldMessenger.maybeOf(context);
  final probing = client.isOpen
      ? null
      : messenger?.showSnackBar(SnackBar(content: Text(AppStrings.t('assistant.reaching')), duration: const Duration(seconds: 10)));
  final route = await resolveAssistantRoute(activeIsOpen: client.isOpen);
  probing?.close();
  final directIsActive = route.kind == AssistantRouteKind.direct && await ProfileStore.getActiveId() == route.profile?.id;
  if (!context.mounted) return;
  switch (route.kind) {
    case AssistantRouteKind.none:
      await ConnectFlow.open(context);
      return;
    case AssistantRouteKind.direct:
      await Navigator.push(
        context,
        MaterialPageRoute(
          // Voice mode only when the API key is the chosen connection, as before;
          // as a fallback for an unreachable assistant it opens the chat.
          builder: (_) => voice && directIsActive
              ? VoiceModeScreen(profile: route.profile!)
              : DirectChatScreen(
                  profile: route.profile!,
                  chatId: assistantDirectChatId,
                  initialTitle: AppStrings.t('assistant.chatTitle'),
                ),
        ),
      );
      return;
    case AssistantRouteKind.assistant:
    case AssistantRouteKind.gatewayDefault:
      final activeId = await ProfileStore.getActiveId();
      if (activeId != route.profile!.id) {
        // The circle means "my assistant": move the chat connection to it.
        // ChatScreen follows the new client through GatewayScope.
        await ProfileStore.setActiveId(route.profile!.id);
        await ConnectFlow.onProfileChanged?.call();
      }
      if (!context.mounted) return;
      onOpenSession(assistantSessionKey);
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ChatScreen(
            client: client,
            events: events,
            connected: connected,
            sessionKey: assistantSessionKey,
            // A computer project has no "assistant" agent: let it use its default.
            agentId: route.kind == AssistantRouteKind.assistant ? assistantAgentId : null,
            initialTitle: AppStrings.t('assistant.chatTitle'),
            slashCommands: slashCommands,
          ),
        ),
      );
  }
}

/// App home: a big round button that jumps into the main assistant chat,
/// with the previous chat list kept one tap away.
class AssistantHomeScreen extends StatelessWidget {
  final YggdrasilClient client;
  final Stream<Map<String, dynamic>> events;
  final Future<void> connected;
  final String status;
  final List<dynamic> slashCommands;
  final Future<void> Function() onProfileChanged;
  final Set<String> pendingSessions;
  final void Function(String sessionKey) onOpenSession;

  const AssistantHomeScreen({
    super.key,
    required this.client,
    required this.events,
    required this.connected,
    required this.status,
    required this.slashCommands,
    required this.onProfileChanged,
    required this.pendingSessions,
    required this.onOpenSession,
  });

  // The big circle promises "tap to talk": it goes wherever the assistant lives
  // (openAssistantChat), in voice mode when that's the phone's own API key.
  Future<void> _onCircleTap(BuildContext context) => openAssistantChat(
        context,
        client: client,
        events: events,
        connected: connected,
        slashCommands: slashCommands,
        onOpenSession: onOpenSession,
        voice: true,
      );

  void _openChatList(BuildContext context) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatListScreen(
          client: client,
          events: events,
          connected: connected,
          status: status,
          slashCommands: slashCommands,
          onProfileChanged: onProfileChanged,
          pendingSessions: pendingSessions,
          onOpenSession: onOpenSession,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: YggColors.bg,
      body: SafeArea(
        child: Column(
          children: [
            const SizedBox(height: 24),
            Text(
              AppStrings.t('assistant.brand'),
              style: TextStyle(
                color: YggColors.accent,
                fontFamily: YggFonts.mono,
                fontSize: 12,
                letterSpacing: 3,
              ),
            ),
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _AssistantButton(onPressed: () => _onCircleTap(context)),
                    const SizedBox(height: 28),
                    Text(
                      AppStrings.t('assistant.tapToTalk'),
                      style: TextStyle(color: YggColors.textMuted, fontSize: 14),
                    ),
                    _ConnectBanner(client: client, connected: connected),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 48),
              child: YggNavButton(
                icon: Icons.forum_outlined,
                label: AppStrings.t('assistant.allChats'),
                onTap: () => _openChatList(context),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _AssistantButton extends StatefulWidget {
  final VoidCallback onPressed;

  const _AssistantButton({required this.onPressed});

  @override
  State<_AssistantButton> createState() => _AssistantButtonState();
}

class _AssistantButtonState extends State<_AssistantButton> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 3),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: AppStrings.t('assistant.openButton'),
      child: AnimatedBuilder(
        animation: _pulse,
        builder: (context, child) {
          final glow = 0.15 + 0.2 * _pulse.value;
          return Container(
            width: 168,
            height: 168,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: YggColors.accent.withValues(alpha: glow),
                  blurRadius: 40 + 20 * _pulse.value,
                  spreadRadius: 4,
                ),
              ],
            ),
            child: child,
          );
        },
        child: Material(
          color: YggColors.surface,
          shape: CircleBorder(side: BorderSide(color: YggColors.accent, width: 1.5)),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: widget.onPressed,
            child: Center(
              child: Icon(Icons.mic_none_rounded, size: 64, color: YggColors.accent),
            ),
          ),
        ),
      ),
    );
  }
}

/// Under the big button when nothing answers. With no profile yet (fresh
/// install: the app is trying a localhost gateway a phone doesn't have) it
/// invites to connect a computer. With a profile that dropped (assistant
/// redeploying, network change) it names it and says it's retrying — the
/// client reconnects by itself — after a few seconds, so a blip doesn't flash it.
class _ConnectBanner extends StatefulWidget {
  final YggdrasilClient client;
  final Future<void> connected;

  const _ConnectBanner({required this.client, required this.connected});

  @override
  State<_ConnectBanner> createState() => _ConnectBannerState();
}

class _ConnectBannerState extends State<_ConnectBanner> {
  static const _graceForDrops = Duration(seconds: 4);

  bool _attempted = false;
  ConnectionProfile? _profile;
  bool _showDrop = false;
  Timer? _dropTimer;

  @override
  void initState() {
    super.initState();
    widget.client.connection.addListener(_onConnection);
    _watch();
  }

  @override
  void didUpdateWidget(_ConnectBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.client, widget.client)) {
      oldWidget.client.connection.removeListener(_onConnection);
      widget.client.connection.addListener(_onConnection);
    }
    if (!identical(oldWidget.connected, widget.connected)) _watch();
  }

  @override
  void dispose() {
    widget.client.connection.removeListener(_onConnection);
    _dropTimer?.cancel();
    super.dispose();
  }

  void _onConnection() {
    _dropTimer?.cancel();
    if (widget.client.connection.value) {
      if (_showDrop) setState(() => _showDrop = false);
      return;
    }
    _dropTimer = Timer(_graceForDrops, () {
      if (mounted && !widget.client.connection.value) setState(() => _showDrop = true);
    });
  }

  Future<void> _watch() async {
    final connected = widget.connected;
    if (_attempted) setState(() => _attempted = false);
    try {
      await connected;
    } catch (_) {
      // A failed attempt still counts as attempted: that's when the banner matters.
    }
    final profile = await ProfileStore.getActive();
    if (!mounted || !identical(connected, widget.connected)) return;
    setState(() {
      _attempted = true;
      _profile = profile;
    });
    _onConnection();
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile;
    if (!_attempted || profile?.type == ConnectionProfileType.direct) return const SizedBox.shrink();
    return ValueListenableBuilder<bool>(
      valueListenable: widget.client.connection,
      builder: (context, open, _) {
        if (open || (profile != null && !_showDrop)) return const SizedBox.shrink();
        final fresh = profile == null;
        return Padding(
          padding: const EdgeInsets.fromLTRB(40, 32, 40, 0),
          child: Column(
            children: [
              Text(
                fresh ? AppStrings.t('connect.homeHint') : AppStrings.tp('connect.droppedHint', {'name': profile.name}),
                textAlign: TextAlign.center,
                style: TextStyle(color: YggColors.textMuted, fontSize: 13.5),
              ),
              const SizedBox(height: 12),
              YggNavButton(
                primary: fresh,
                icon: Icons.qr_code_scanner,
                label: AppStrings.t(fresh ? 'connect.cta' : 'connect.another'),
                onTap: () => ConnectFlow.open(context),
              ),
            ],
          ),
        );
      },
    );
  }
}
