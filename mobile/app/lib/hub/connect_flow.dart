import 'package:flutter/material.dart';

import 'desktops_screen.dart';

/// The one "Conectar con tu computadora" entry point (connection-ux-review-2026-11-25.md
/// §B): every place that finds the phone unconnected — home, drawer, a failed
/// send, Configuración, Proyectos — opens this same screen (QR first, manual as
/// "advanced"), instead of each one pointing somewhere different.
class ConnectFlow {
  /// main.dart's `_onProfileChanged`: re-syncs the live connection with the
  /// active profile. Registered once at startup so screens deep in the stack
  /// don't each need it threaded through their constructors.
  static Future<void> Function()? onProfileChanged;

  /// Opens the connect screen. Always re-syncs afterwards — scanning the QR alone
  /// can already change the active profile, even if no computer was picked.
  /// True when a computer project was connected.
  ///
  /// [forProjects]: opened from Proyectos, so picking a computer sets up
  /// Proyectos only and never moves the chat off its current connection.
  static Future<bool> open(BuildContext context, {bool forProjects = false}) async {
    final connected = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => DesktopsScreen(forProjects: forProjects)),
    );
    await onProfileChanged?.call();
    return connected == true;
  }
}
