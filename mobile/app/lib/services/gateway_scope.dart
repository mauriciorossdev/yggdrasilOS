import 'package:flutter/widgets.dart';

import 'yggdrasil_client.dart';

/// The app's current gateway connection, published above the Navigator.
///
/// main.dart replaces its YggdrasilClient whenever the active profile changes.
/// Screens already on the navigation stack got the old instance through their
/// constructor; reading it from here instead lets them follow the new one.
class GatewayScope extends InheritedWidget {
  final YggdrasilClient client;
  final Future<void> connected;

  const GatewayScope({super.key, required this.client, required this.connected, required super.child});

  static GatewayScope? maybeOf(BuildContext context) => context.dependOnInheritedWidgetOfExactType<GatewayScope>();

  @override
  bool updateShouldNotify(GatewayScope oldWidget) => !identical(client, oldWidget.client) || !identical(connected, oldWidget.connected);
}
