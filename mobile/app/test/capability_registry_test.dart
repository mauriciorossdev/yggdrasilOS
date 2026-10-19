import 'package:app/capabilities/capability_registry.dart';
import 'package:app/l10n/app_strings.dart';
import 'package:app/services/device_tool_specs.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('specs keep the device.tools.register wire format', () {
    for (final spec in phoneDeviceToolSpecs) {
      expect(spec.keys.toSet(), {'name', 'description', 'parameters', 'kind', 'riskLevel'});
      expect(spec['kind'], anyOf('sync', 'interactive'));
      expect(spec['riskLevel'], anyOf('safe', 'moderate', 'destructive'));
      expect((spec['parameters'] as Map)['type'], 'object');
    }
  });

  test('names are unique and phone_-prefixed', () {
    final names = deviceCapabilities.map((c) => c.name).toList();
    expect(names.toSet().length, names.length);
    expect(names.every((n) => n.startsWith('phone_')), isTrue);
  });

  test('interactive capabilities can be cancelled', () {
    for (final c in deviceCapabilities.where((c) => c.isInteractive)) {
      expect(c.cancel, isNotNull, reason: c.name);
    }
  });

  test('every l10n key resolves', () {
    for (final c in deviceCapabilities) {
      for (final key in [c.categoryKey, c.titleKey, c.descriptionKey, c.verbKey, c.okKey, c.errorKey].whereType<String>()) {
        expect(AppStrings.t(key), isNot(key), reason: '${c.name}: $key');
      }
    }
  });
}
