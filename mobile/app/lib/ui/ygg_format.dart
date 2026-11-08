import '../l10n/app_strings.dart';

/// "hace 5 min", "ayer", "hace 3 d"... for an epoch in milliseconds. 0 (or any
/// non-positive value) means "never recorded" and reads as "nunca".
String yggTimeAgo(int epochMs, {DateTime? now}) {
  if (epochMs <= 0) return AppStrings.t('time.never');
  final reference = now ?? DateTime.now();
  final diff = reference.difference(DateTime.fromMillisecondsSinceEpoch(epochMs));
  if (diff.isNegative || diff.inSeconds < 60) return AppStrings.t('time.justNow');
  if (diff.inMinutes < 60) return AppStrings.tp('time.minutesAgo', {'n': '${diff.inMinutes}'});
  if (diff.inHours < 24) return AppStrings.tp('time.hoursAgo', {'n': '${diff.inHours}'});
  if (diff.inDays < 2) return AppStrings.t('time.yesterday');
  if (diff.inDays < 7) return AppStrings.tp('time.daysAgo', {'n': '${diff.inDays}'});
  if (diff.inDays < 30) return AppStrings.tp('time.weeksAgo', {'n': '${diff.inDays ~/ 7}'});
  return AppStrings.tp('time.monthsAgo', {'n': '${diff.inDays ~/ 30}'});
}

/// Parses an ISO-8601 string (as the workflows API returns `startedAt`) into epoch
/// milliseconds; 0 when it is missing or malformed.
int yggEpochFromIso(Object? iso) {
  final parsed = DateTime.tryParse(iso?.toString() ?? '');
  return parsed?.millisecondsSinceEpoch ?? 0;
}

/// A long path shortened to its last [keep] segments, with a leading "…" when
/// something was cut: `C:\Users\me\AppData\Roaming\app` -> `…\Roaming\app`. The
/// separator of the original is kept. Short paths come back unchanged.
String compactPath(String path, {int keep = 2, int maxLength = 34}) {
  if (path.length <= maxLength) return path;
  final separator = path.contains('\\') ? '\\' : '/';
  final segments = path.split(RegExp(r'[\\/]')).where((s) => s.isNotEmpty).toList();
  if (segments.length <= keep) return path;
  return '…$separator${segments.sublist(segments.length - keep).join(separator)}';
}

final _uuid = RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

/// What to show as a terminal's name: panes that were never titled come back from
/// the desktop with their raw UUID as title, so those become "Terminal · 0be211c8".
String terminalDisplayTitle(String title) {
  final trimmed = title.trim();
  if (trimmed.isEmpty) return AppStrings.t('projects.terminalUntitled');
  if (_uuid.hasMatch(trimmed)) return '${AppStrings.t('projects.terminalUntitled')} · ${trimmed.substring(0, 8)}';
  return trimmed;
}

/// "1 sesión" / "3 sesiones": picks the singular or plural key by [count].
String yggCount(int count, {required String oneKey, required String manyKey}) {
  return AppStrings.tp(count == 1 ? oneKey : manyKey, {'n': '$count'});
}

/// l10n key of the day bucket an epoch (ms) falls in: today, yesterday, this week,
/// earlier. 0 (unknown) is "earlier". Same buckets the chat drawer groups by.
String yggDateBucketKey(int epochMs, {DateTime? now}) {
  if (epochMs <= 0) return 'drawer.bucketOlder';
  final reference = now ?? DateTime.now();
  final date = DateTime.fromMillisecondsSinceEpoch(epochMs);
  final days = DateTime(reference.year, reference.month, reference.day).difference(DateTime(date.year, date.month, date.day)).inDays;
  if (days <= 0) return 'drawer.bucketToday';
  if (days == 1) return 'drawer.bucketYesterday';
  if (days <= 7) return 'drawer.bucketThisWeek';
  return 'drawer.bucketOlder';
}
