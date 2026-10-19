import 'dart:io';

import 'package:flutter/services.dart';

/// Native side of the quick-access bubble (BubbleService.kt, channel
/// `com.yggdrasil.app/bubble`). Android only; everything is a no-op elsewhere.
class BubbleChannel {
  BubbleChannel._();
  static const MethodChannel _channel = MethodChannel('com.yggdrasil.app/bubble');

  static Future<bool> _bool(String method, [Map<String, dynamic>? args]) async {
    if (!Platform.isAndroid) return false;
    try {
      return await _channel.invokeMethod<bool>(method, args) ?? false;
    } on PlatformException {
      return false;
    }
  }

  /// Whether the user has the bubble turned on (it also restarts after a reboot).
  static Future<bool> isEnabled() => _bool('isEnabled');

  /// "Display over other apps" — can only be granted by the user in system settings.
  static Future<bool> canDrawOverlays() => _bool('canDrawOverlays');

  /// Opens this app's "Display over other apps" screen in system settings.
  static Future<void> openOverlaySettings() async {
    if (Platform.isAndroid) await _channel.invokeMethod<void>('openOverlaySettings');
  }

  /// Starts or stops the bubble. Returns false (and does nothing) if enabling
  /// without the overlay permission.
  static Future<bool> setEnabled(bool enabled) => _bool('setEnabled', {'enabled': enabled});
}
