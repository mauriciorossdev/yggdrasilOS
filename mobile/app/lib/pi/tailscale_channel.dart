import 'package:flutter/services.dart';

/// Asks the Tailscale app to bring its VPN up (Android only — see
/// MainActivity's "com.yggdrasil.app/tailscale" channel). Fire-and-forget:
/// returns false when Tailscale isn't installed or on platforms without the
/// channel (iOS: use Tailscale's own VPN On Demand instead).
class TailscaleChannel {
  static const MethodChannel _channel = MethodChannel('com.yggdrasil.app/tailscale');

  static Future<bool> connect() async {
    try {
      return await _channel.invokeMethod<bool>('connect') ?? false;
    } catch (_) {
      return false;
    }
  }
}
