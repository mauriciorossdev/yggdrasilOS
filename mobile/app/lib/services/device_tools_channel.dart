import 'package:flutter/services.dart';

/// Bridges to native Android via platform channel `com.yggdrasil.app/device_tools`.
/// `openApp`/`listInstalledApps` (sync) and `pickDocument`/`cancelPickDocument`
/// (interactive, backs phone_pick_file — SAF needs a user-facing picker,
/// not a fixed timeout, see phone-gateway-connectivity-design.md §3.3).
class DeviceToolsChannel {
  static const MethodChannel _channel = MethodChannel('com.yggdrasil.app/device_tools');

  static Future<void> openApp(String packageName) async {
    await _channel.invokeMethod<void>('openApp', {'packageName': packageName});
  }

  static Future<List<Map<String, String>>> listInstalledApps() async {
    final result = await _channel.invokeMethod<List<dynamic>>('listInstalledApps');
    return (result ?? [])
        .map((entry) => Map<String, String>.from(entry as Map))
        .toList();
  }

  /// Throws PlatformException(code: 'cancelled', message: 'cancelled_by_user')
  /// if the user backs out of the picker — MainActivity.kt sends that exact
  /// message so it can be forwarded verbatim as device.tools.result's error.
  static Future<Map<String, dynamic>> pickDocument({String? mimeType}) async {
    final result = await _channel.invokeMethod<Map>('pickDocument', {'mimeType': mimeType});
    return Map<String, dynamic>.from(result ?? {});
  }

  /// Size in bytes of a picked document's content URI (-1 if the provider
  /// can't tell).
  static Future<int> uriSize(String uri) async {
    final size = await _channel.invokeMethod<int>('uriSize', {'uri': uri});
    return size ?? -1;
  }

  /// Reads up to [length] bytes of a content URI starting at [offset] — fewer
  /// (possibly zero) at end of file. Used to stream Pi chat attachments.
  static Future<Uint8List> readUriChunk(String uri, int offset, int length) async {
    final bytes = await _channel.invokeMethod<Uint8List>('readUriChunk', {'uri': uri, 'offset': offset, 'length': length});
    return bytes ?? Uint8List(0);
  }

  /// Best-effort: asks the native side to close an in-flight picker. The
  /// gateway has already resolved the tool call by the time this is called
  /// (cancellation is optimistic server-side) — this only tidies up the UI.
  static Future<void> cancelPickDocument() async {
    await _channel.invokeMethod<void>('cancelPickDocument');
  }

  /// phone_list_documents — single directory pick (ACTION_OPEN_DOCUMENT_TREE),
  /// returns {"uri": treeUri, "files": [{"name","uri"}, ...]} for that
  /// directory's immediate children (non-recursive). Same cancellation
  /// contract as pickDocument (PlatformException code 'cancelled').
  static Future<Map<String, dynamic>> pickDirectory() async {
    final result = await _channel.invokeMethod<Map>('pickDirectory');
    return Map<String, dynamic>.from(result ?? {});
  }

  static Future<void> cancelPickDirectory() async {
    await _channel.invokeMethod<void>('cancelPickDirectory');
  }

  /// phone_find_files — sync MediaStore.Files query, no picker. Throws
  /// PlatformException(code: 'permission_required', details: {canAskAgain,
  /// permission}) when the required media/storage permission isn't granted
  /// (notes/yggdrasil-mobile/phone-find-files-design.md §4) — callers must
  /// forward `details`, not just `message`, so the model can pick "ask
  /// again" vs. "go to Settings" without a second round-trip.
  static Future<Map<String, dynamic>> findFiles({
    required String query,
    String? extension,
    String? mimeType,
    int? limit,
  }) async {
    final result = await _channel.invokeMethod<Map>('findFiles', {
      'query': query,
      'extension': extension,
      'mimeType': mimeType,
      'limit': limit,
    });
    return Map<String, dynamic>.from(result ?? {});
  }

  /// phone_set_alarm — Intent(AlarmClock.ACTION_SET_ALARM), no EXTRA_SKIP_UI
  /// (external-actions-and-connectors-analysis.md §2.1 + MainActivity.kt's
  /// handleSetAlarm comment: user confirms in the clock app before it saves).
  static Future<void> setAlarm({required int hour, required int minute, String? label}) async {
    await _channel.invokeMethod<void>('setAlarm', {'hour': hour, 'minute': minute, 'label': label});
  }

  /// phone_set_timer — Intent(AlarmClock.ACTION_SET_TIMER), same shape as
  /// setAlarm (external-actions-and-connectors-analysis.md §2.1).
  static Future<void> setTimer({required int seconds, String? label}) async {
    await _channel.invokeMethod<void>('setTimer', {'seconds': seconds, 'label': label});
  }

  /// phone_add_calendar_event — Intent(ACTION_INSERT) against
  /// CalendarContract.Events (external-actions-and-connectors-analysis.md
  /// §2.2) — native, no OAuth, writes to whichever calendar account is
  /// already configured on the device. Epoch millis so MainActivity.kt never
  /// has to parse a date string itself — callers convert from whatever the
  /// tool call gave them (ISO-8601 local date-time) before invoking this.
  static Future<void> addCalendarEvent({
    required String title,
    String? location,
    String? description,
    required int beginTimeEpochMillis,
    int? endTimeEpochMillis,
    bool allDay = false,
  }) async {
    await _channel.invokeMethod<void>('addCalendarEvent', {
      'title': title,
      'location': location,
      'description': description,
      'beginTime': beginTimeEpochMillis,
      'endTime': endTimeEpochMillis,
      'allDay': allDay,
    });
  }
}
