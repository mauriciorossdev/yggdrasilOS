import 'package:shared_preferences/shared_preferences.dart';

/// Configuración → Capacidades: when on, phone_* capability calls run without
/// the per-call confirmation (gateway tool.approval.requested is answered
/// automatically on the phone; standalone skips its confirm dialog). Off by
/// default. Only ever covers the phone's own capabilities, never desktop/fs tools.
class PhoneAutoApproveStore {
  static const _key = 'yggdrasil_pref_phone_auto_approve';

  static Future<bool> isEnabled() async => (await SharedPreferences.getInstance()).getBool(_key) ?? false;

  static Future<void> setEnabled(bool enabled) async =>
      (await SharedPreferences.getInstance()).setBool(_key, enabled);
}
