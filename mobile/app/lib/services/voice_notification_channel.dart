import 'package:flutter/services.dart';

/// Bridges to native Android via platform channel
/// `com.yggdrasil.app/voice_notification` — posts the ongoing, tap-to-listen
/// notification from voice-notification-shortcut-design.md §2. A separate
/// channel from `device_tools_channel.dart` on purpose: this is app
/// infrastructure (posted once at startup), not a tool the model invokes.
class VoiceNotificationChannel {
  static const MethodChannel _channel = MethodChannel('com.yggdrasil.app/voice_notification');

  /// Returns false (never throws) when POST_NOTIFICATIONS isn't granted
  /// (Android 13+/API 33+) — not fatal, the app just has no
  /// notification-based shortcut until the user grants it from Settings.
  static Future<bool> post({
    required String title,
    required String body,
    required String actionLabel,
    required String channelName,
    required String channelDescription,
  }) async {
    final result = await _channel.invokeMethod<bool>('post', {
      'title': title,
      'body': body,
      'actionLabel': actionLabel,
      'channelName': channelName,
      'channelDescription': channelDescription,
    });
    return result ?? false;
  }
}
