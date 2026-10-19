import 'package:permission_handler/permission_handler.dart';

/// Android manifest names behind the permission_handler permissions the phone
/// tools use. Only these can be requested from the bubble's UI-less engine.
const _androidNames = <String, List<String>>{
  'sms': ['android.permission.SEND_SMS'],
  'phone': ['android.permission.CALL_PHONE'],
  'contacts': ['android.permission.READ_CONTACTS'],
  'calendarFullAccess': ['android.permission.READ_CALENDAR'],
  'locationWhenInUse': ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'],
  'notification': ['android.permission.POST_NOTIFICATIONS'],
  'microphone': ['android.permission.RECORD_AUDIO'],
};

String? _keyFor(Permission p) {
  if (p == Permission.sms) return 'sms';
  if (p == Permission.phone) return 'phone';
  if (p == Permission.contacts) return 'contacts';
  if (p == Permission.calendarFullAccess) return 'calendarFullAccess';
  if (p == Permission.locationWhenInUse) return 'locationWhenInUse';
  if (p == Permission.notification) return 'notification';
  if (p == Permission.microphone) return 'microphone';
  return null;
}

/// Android permission names for [permissions], or null if any can't be asked
/// with a plain runtime dialog (e.g. all-files access lives in system settings).
List<String>? androidNamesFor(List<Permission> permissions) {
  final out = <String>[];
  for (final p in permissions) {
    final key = _keyFor(p);
    if (key == null) return null;
    out.addAll(_androidNames[key]!);
  }
  return out;
}

Future<bool> _allGranted(List<Permission> permissions) async {
  for (final p in permissions) {
    if (!await p.status.isGranted) return false;
  }
  return true;
}

/// Makes sure [permissions] are granted without needing an Activity here:
/// already granted -> true; otherwise [askNative] shows the system dialog
/// through an invisible native activity, and the result is re-checked.
Future<bool> requestInBackground(
  List<Permission> permissions,
  Future<bool> Function(List<String> androidPermissions) askNative,
) async {
  if (await _allGranted(permissions)) return true;
  final names = androidNamesFor(permissions);
  if (names == null) return false;
  await askNative(names);
  return _allGranted(permissions);
}
