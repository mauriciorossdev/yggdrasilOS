import 'package:flutter/material.dart';

import '../chat/projects_screen.dart';
import '../gateway/gateway_connection.dart';
import '../gateway/gateway_settings.dart';
import '../l10n/app_strings.dart';

/// yggdrasil://projects (home screen widget, main.dart's deep-link handler) —
/// same Gateway resolution ChatListScreen's own "Proyectos" button already
/// does (gateway/gateway_connection.dart), just reachable from outside any
/// screen's BuildContext via the app-level navigatorKey.
Future<void> openProjectsFromDeepLink(GlobalKey<NavigatorState> navigatorKey) async {
  final navState = navigatorKey.currentState;
  if (navState == null) return;

  final settings = await GatewaySettingsStore.load();
  if (!navState.mounted) return;
  if (!settings.isReady) {
    ScaffoldMessenger.of(navState.context).showSnackBar(
      SnackBar(content: Text(AppStrings.t('projects.gatewayDisabled'))),
    );
    return;
  }

  final client = await GatewayConnection.resolve();
  if (client == null) {
    if (!navState.mounted) return;
    ScaffoldMessenger.of(navState.context).showSnackBar(
      SnackBar(content: Text(AppStrings.t('projects.gatewayDisabled'))),
    );
    return;
  }

  navState.push(MaterialPageRoute(builder: (_) => ProjectsScreen(client: client)));
}
