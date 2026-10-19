// Mitigation for the one real risk a plain map has over ARB
// (mobile-i18n-proposal.md §3): a key silently missing its 'es' or 'en'
// value. This is the "two lines of test" the doc proposed instead of
// pulling in the whole intl/ARB toolchain just for compile-time validation.
import 'package:flutter_test/flutter_test.dart';

import 'package:app/l10n/app_strings.dart';

void main() {
  test('every string key has both es and en translations', () {
    for (final key in AppStrings.keys) {
      final locales = AppStrings.localesFor(key);
      expect(locales, containsAll(['es', 'en']), reason: '"$key" is missing a translation for one locale');
    }
  });
}
