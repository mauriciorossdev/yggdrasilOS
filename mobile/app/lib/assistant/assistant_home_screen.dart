import 'package:flutter/material.dart';

import '../chat/chat_list_screen.dart';
import '../chat/chat_screen.dart';
import '../l10n/app_strings.dart';
import '../profiles/connection_profile.dart';
import '../profiles/profile_store.dart';
import '../services/yggdrasil_client.dart';
import '../standalone/direct_chat_screen.dart';
import '../theme/ygg_theme.dart';

/// The one persistent assistant conversation — see
/// notes/asistente-personal/diseno.md. Gateway mode always opens the same
/// session/agent pair, so history, compaction and memory live server-side.
/// Direct mode reuses a single fixed local chat id instead.
const assistantSessionKey = 'assistant:main';
const assistantAgentId = 'assistant';
const assistantDirectChatId = 'assistant-main';

/// Opens the one assistant conversation (gateway session or, in direct mode,
/// the fixed local chat). Shared by the home button and notification taps.
Future<void> openAssistantChat(
  BuildContext context, {
  required YggdrasilClient client,
  required Stream<Map<String, dynamic>> events,
  required Future<void> connected,
  required List<dynamic> slashCommands,
  required void Function(String sessionKey) onOpenSession,
}) async {
  final profile = await ProfileStore.getActive();
  if (!context.mounted) return;
  if (profile?.type == ConnectionProfileType.direct) {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DirectChatScreen(
          profile: profile!,
          chatId: assistantDirectChatId,
          initialTitle: AppStrings.t('assistant.chatTitle'),
        ),
      ),
    );
    return;
  }
  onOpenSession(assistantSessionKey);
  await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (_) => ChatScreen(
        client: client,
        events: events,
        connected: connected,
        sessionKey: assistantSessionKey,
        agentId: assistantAgentId,
        initialTitle: AppStrings.t('assistant.chatTitle'),
        slashCommands: slashCommands,
      ),
    ),
  );
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

  Future<void> _openAssistant(BuildContext context) => openAssistantChat(
        context,
        client: client,
        events: events,
        connected: connected,
        slashCommands: slashCommands,
        onOpenSession: onOpenSession,
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
              style: const TextStyle(
                color: YggColors.accent,
                fontSize: 12,
                letterSpacing: 3,
                fontWeight: FontWeight.w600,
              ),
            ),
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _AssistantButton(onPressed: () => _openAssistant(context)),
                    const SizedBox(height: 28),
                    Text(
                      AppStrings.t('assistant.tapToTalk'),
                      style: const TextStyle(color: YggColors.textMuted, fontSize: 14),
                    ),
                  ],
                ),
              ),
            ),
            TextButton(
              onPressed: () => _openChatList(context),
              child: Text(
                AppStrings.t('assistant.allChats'),
                style: const TextStyle(color: YggColors.textMuted),
              ),
            ),
            const SizedBox(height: 16),
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
          shape: const CircleBorder(side: BorderSide(color: YggColors.accent, width: 1.5)),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: widget.onPressed,
            child: const Center(
              child: Icon(Icons.mic_none_rounded, size: 64, color: YggColors.accent),
            ),
          ),
        ),
      ),
    );
  }
}
