import 'package:app/projects/new_project_sheet.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_client.dart';

void main() {
  group('desktopTarget', () {
    test('closes the connection it opened itself once the project is created', () async {
      final client = FakeClient({'projects.create': (_) => {'id': 'p1'}});
      final target = desktopTarget(label: 'PC', connect: () async => client);
      await target.create('demo');
      expect(client.calls, ['projects.create']);
      expect(client.disconnects, 1);
    });

    test('leaves the list screen own connection open, so it can reload and open the new project', () async {
      final client = FakeClient({'projects.create': (_) => {'id': 'p1'}});
      final target = desktopTarget(label: 'Esta computadora', connect: () async => client, ownsClient: false);
      await target.create('demo');
      expect(client.disconnects, 0);
    });

    test('a failing create still closes only what it owns', () async {
      final owned = FakeClient({'projects.create': (_) => throw StateError('boom')});
      await expectLater(desktopTarget(label: 'PC', connect: () async => owned).create('x'), throwsStateError);
      expect(owned.disconnects, 1);

      final shared = FakeClient({'projects.create': (_) => throw StateError('boom')});
      await expectLater(desktopTarget(label: 'PC', connect: () async => shared, ownsClient: false).create('x'), throwsStateError);
      expect(shared.disconnects, 0);
    });
  });
}
