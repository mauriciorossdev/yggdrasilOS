/// Picks the recognition locale for [appLanguage] (an AppStrings code) among the
/// [availableIds] this device's recognizer offers, rather than assuming es-CL
/// is there: the preferred regional variants first, then any locale with the
/// language's prefix, then whatever the device lists first. Null when it offers
/// none (the recognizer then uses its own default).
String? pickRecognitionLocale(Iterable<String> availableIds, String appLanguage) {
  final ids = availableIds.toList();
  final set = ids.toSet();
  final english = appLanguage == 'en';
  for (final c in english ? const ['en-US', 'en-GB'] : const ['es-CL', 'es-ES', 'es-419', 'es-US']) {
    if (set.contains(c)) return c;
  }
  final prefix = english ? 'en' : 'es';
  for (final id in ids) {
    if (id.startsWith(prefix)) return id;
  }
  return ids.isEmpty ? null : ids.first;
}
