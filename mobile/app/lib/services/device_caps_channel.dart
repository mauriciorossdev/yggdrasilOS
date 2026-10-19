import 'package:flutter/services.dart';

/// Phase 2 native capabilities — channel `com.yggdrasil.app/device_caps`,
/// implemented in DeviceCapabilities.kt. Errors surface as PlatformException
/// (code permission_denied | no_handler | unsupported | unavailable | bad_args | failed)
/// and are forwarded verbatim to the model by both chat modes.
class DeviceCapsChannel {
  static const MethodChannel _channel = MethodChannel('com.yggdrasil.app/device_caps');

  static Future<Map<String, dynamic>> _call(String method, [Map<String, dynamic>? args]) async {
    final result = await _channel.invokeMethod<Map>(method, args);
    return Map<String, dynamic>.from(result ?? {});
  }

  static Future<Map<String, dynamic>> showNotification({String? title, String? body}) =>
      _call('showNotification', {'title': title, 'body': body});

  static Future<Map<String, dynamic>> clipboardGet() => _call('clipboardGet');
  static Future<Map<String, dynamic>> clipboardSet(String text) => _call('clipboardSet', {'text': text});
  static Future<Map<String, dynamic>> deviceState() => _call('deviceState');
  static Future<Map<String, dynamic>> setRingerMode(String mode) => _call('setRingerMode', {'mode': mode});
  static Future<Map<String, dynamic>> setVolume({required String stream, required int percent}) =>
      _call('setVolume', {'stream': stream, 'percent': percent});
  static Future<Map<String, dynamic>> setFlashlight(bool on) => _call('setFlashlight', {'on': on});
  static Future<Map<String, dynamic>> mediaControl({required String action, String? package}) =>
      _call('mediaControl', {'action': action, 'package': package});
  static Future<Map<String, dynamic>> getLocation() => _call('getLocation');
  static Future<Map<String, dynamic>> sendSms({required String to, required String body}) =>
      _call('sendSms', {'to': to, 'body': body});
  static Future<Map<String, dynamic>> composeSms({required String to, String? body}) =>
      _call('composeSms', {'to': to, 'body': body ?? ''});
  static Future<Map<String, dynamic>> call(String number) => _call('call', {'number': number});
  static Future<Map<String, dynamic>> dial(String number) => _call('dial', {'number': number});
  static Future<Map<String, dynamic>> composeWhatsapp({required String number, String? body}) =>
      _call('composeWhatsapp', {'number': number, 'body': body});
  static Future<Map<String, dynamic>> searchContacts({required String query, int? limit}) =>
      _call('searchContacts', {'query': query, 'limit': limit});
  static Future<Map<String, dynamic>> readCalendar({required int beginMs, required int endMs, int? limit}) =>
      _call('readCalendar', {'beginMs': beginMs, 'endMs': endMs, 'limit': limit});
  static Future<Map<String, dynamic>> openUrl(String url) => _call('openUrl', {'url': url});
  static Future<Map<String, dynamic>> shareText({required String text, String? package}) =>
      _call('shareText', {'text': text, 'package': package});
  static Future<Map<String, dynamic>> launchIntent(Map<String, dynamic> spec) => _call('launchIntent', spec);
}
