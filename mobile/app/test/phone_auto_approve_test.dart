import 'package:app/services/phone_auto_approve_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('auto-approve is off by default and persists when turned on', () async {
    expect(await PhoneAutoApproveStore.isEnabled(), isFalse);
    await PhoneAutoApproveStore.setEnabled(true);
    expect(await PhoneAutoApproveStore.isEnabled(), isTrue);
    await PhoneAutoApproveStore.setEnabled(false);
    expect(await PhoneAutoApproveStore.isEnabled(), isFalse);
  });
}
