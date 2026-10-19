import 'package:flutter/material.dart';

import '../services/yggdrasil_client.dart';
import 'terminal_chat_view.dart';

/// Full-screen Scaffold shell around TerminalChatView — the actual
/// poll/send/transcript logic lives there now so ProjectWorkspaceScreen's
/// split view can embed it directly, under a shared AppBar, instead of
/// pushing this whole screen. Every existing caller (TerminalsTab, PiChatScreen)
/// keeps its previous look unchanged.
class TerminalViewScreen extends StatelessWidget {
  final YggdrasilClient client;
  final String paneId;
  final String title;
  // "claude" -> this pane gets the parsed chat view instead of raw ANSI
  // text — see TerminalChatView.
  final String? harnessCommand;
  // Optional extras, used by the Pi chat (pi/pi_chat_screen.dart); desktop
  // panes pass neither and look exactly as before.
  final List<Widget> appBarActions;
  final Future<String?> Function()? onAttach;

  const TerminalViewScreen({
    super.key,
    required this.client,
    required this.paneId,
    required this.title,
    this.harnessCommand,
    this.appBarActions = const [],
    this.onAttach,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title, overflow: TextOverflow.ellipsis),
        actions: appBarActions,
      ),
      body: TerminalChatView(
        client: client,
        paneId: paneId,
        harnessCommand: harnessCommand,
        onAttach: onAttach,
      ),
    );
  }
}
