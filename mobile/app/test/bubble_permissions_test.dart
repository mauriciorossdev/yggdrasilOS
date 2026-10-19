import 'package:app/bubble/bubble_permissions.dart';
import 'package:app/capabilities/device_capability.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:permission_handler/permission_handler.dart';

DeviceCapability _cap(List<Permission> permissions, void Function() onRun) => DeviceCapability(
      name: 'phone_test',
      description: 'x',
      parameters: const {'type': 'object', 'properties': {}},
      kind: 'sync',
      riskLevel: 'moderate',
      categoryKey: 'c',
      titleKey: 't',
      permissions: permissions,
      run: (args) async {
        onRun();
        return {'ok': true};
      },
    );

void main() {
  group('androidNamesFor', () {
    test('maps the permissions the phone tools use', () {
      expect(androidNamesFor([Permission.sms]), ['android.permission.SEND_SMS']);
      expect(androidNamesFor([Permission.contacts, Permission.calendarFullAccess]), [
        'android.permission.READ_CONTACTS',
        'android.permission.READ_CALENDAR',
      ]);
      expect(androidNamesFor([Permission.locationWhenInUse]), hasLength(2));
    });

    test('returns null when a permission cannot be asked with a plain dialog', () {
      expect(androidNamesFor([Permission.sms, Permission.manageExternalStorage]), isNull);
    });
  });

  group('DeviceCapability.invoke with a custom permission requester', () {
    test('runs the tool when the requester reports everything granted', () async {
      var ran = false;
      final result = await _cap([Permission.sms], () => ran = true).invoke({}, requestPermissions: (_) async => true);
      expect(ran, isTrue);
      expect(result, {'ok': true});
    });

    test('refuses with permission_denied (and never runs) when denied', () async {
      var ran = false;
      await expectLater(
        _cap([Permission.sms], () => ran = true).invoke({}, requestPermissions: (_) async => false),
        throwsA(isA<PlatformException>().having((e) => e.code, 'code', 'permission_denied')),
      );
      expect(ran, isFalse);
    });

    test('a tool without permissions never calls the requester', () async {
      var asked = false;
      await _cap(const [], () {}).invoke({}, requestPermissions: (_) async => asked = true);
      expect(asked, isFalse);
    });
  });
}
