import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'yggdrasil_client.dart';

/// Push notifications from the gateway (FCM): token registration and
/// "tap the notification -> open the assistant chat". Everything is best
/// effort — a phone without Google services, or a gateway without FCM
/// configured, just doesn't get pushes; the app works the same otherwise.
class PushService {
  PushService._();
  static final PushService instance = PushService._();

  final _openAssistant = StreamController<void>.broadcast();

  /// Fires when the user taps a notification that belongs to the assistant.
  Stream<void> get openAssistantRequests => _openAssistant.stream;

  bool _initialized = false;
  FirebaseMessaging? _messaging;
  YggdrasilClient? _lastClient;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;
    try {
      await Firebase.initializeApp();
      final messaging = _messaging = FirebaseMessaging.instance;
      FirebaseMessaging.onMessageOpenedApp.listen(_onOpened);
      final initial = await messaging.getInitialMessage();
      if (initial != null) _onOpened(initial);
      messaging.onTokenRefresh.listen((_) {
        final client = _lastClient;
        if (client != null) unawaited(registerWith(client));
      });
    } catch (e) {
      // ignore: avoid_print
      print('Push no disponible: $e');
      _messaging = null;
    }
  }

  void _onOpened(RemoteMessage message) {
    final type = message.data['type'];
    if (type == 'reminder' || type == 'queue' || type == 'message') _openAssistant.add(null);
  }

  /// Asks for notification permission and tells the gateway this phone's FCM
  /// token. Needs the gateway connection to already know this device (the
  /// token is stored under its deviceId), so call it after device.tools.register.
  Future<void> registerWith(YggdrasilClient client) async {
    final messaging = _messaging;
    if (messaging == null) return;
    _lastClient = client;
    try {
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;
      final token = await messaging.getToken();
      if (token == null || token.isEmpty) return;
      await client.call('push.register', {'token': token}, timeout: const Duration(seconds: 20));
    } catch (e) {
      // ignore: avoid_print
      print('No se pudo registrar el push: $e');
    }
  }
}
