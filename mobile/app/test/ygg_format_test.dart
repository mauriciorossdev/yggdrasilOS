import 'package:app/l10n/app_strings.dart';
import 'package:app/ui/ygg_format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime(2026, 10, 26, 12, 0);
  int ago(Duration d) => now.subtract(d).millisecondsSinceEpoch;

  setUp(() => AppStrings.current = 'es');

  group('yggTimeAgo', () {
    test('reads naturally from "ahora" to months', () {
      expect(yggTimeAgo(ago(const Duration(seconds: 20)), now: now), 'ahora');
      expect(yggTimeAgo(ago(const Duration(minutes: 5)), now: now), 'hace 5 min');
      expect(yggTimeAgo(ago(const Duration(hours: 3)), now: now), 'hace 3 h');
      expect(yggTimeAgo(ago(const Duration(hours: 30)), now: now), 'ayer');
      expect(yggTimeAgo(ago(const Duration(days: 4)), now: now), 'hace 4 d');
      expect(yggTimeAgo(ago(const Duration(days: 15)), now: now), 'hace 2 sem');
      expect(yggTimeAgo(ago(const Duration(days: 95)), now: now), 'hace 3 meses');
    });

    test('an unknown time is "nunca" and a future one is "ahora"', () {
      expect(yggTimeAgo(0, now: now), 'nunca');
      expect(yggTimeAgo(now.add(const Duration(hours: 1)).millisecondsSinceEpoch, now: now), 'ahora');
    });

    test('follows the language', () {
      AppStrings.current = 'en';
      expect(yggTimeAgo(ago(const Duration(minutes: 5)), now: now), '5 min ago');
      expect(yggTimeAgo(ago(const Duration(hours: 30)), now: now), 'yesterday');
    });
  });

  group('yggEpochFromIso', () {
    test('parses ISO strings and falls back to 0', () {
      expect(yggEpochFromIso('2026-10-26T12:00:00.000'), DateTime(2026, 10, 26, 12).millisecondsSinceEpoch);
      expect(yggEpochFromIso(null), 0);
      expect(yggEpochFromIso('not a date'), 0);
    });
  });

  group('compactPath', () {
    test('keeps short paths and trims long ones to their last segments', () {
      expect(compactPath(r'D:\side\open-gym'), r'D:\side\open-gym');
      expect(compactPath(r'C:\Users\me\AppData\Roaming\@yggdrasil\app-desktop'), r'…\@yggdrasil\app-desktop');
      expect(compactPath('/home/mauri/projects/some/deeply/nested/app', keep: 3), '…/deeply/nested/app');
    });
  });

  group('terminalDisplayTitle', () {
    test('a raw UUID becomes "Terminal · first8", a real title stays', () {
      expect(terminalDisplayTitle('0be211c8-83d6-4f36-b905-adc39a000000'), 'Terminal · 0be211c8');
      expect(terminalDisplayTitle('build watcher'), 'build watcher');
      expect(terminalDisplayTitle('  '), 'Terminal');
    });
  });

  group('yggDateBucketKey', () {
    test('buckets by calendar day, not by 24-hour windows', () {
      expect(yggDateBucketKey(ago(const Duration(hours: 2)), now: now), 'drawer.bucketToday');
      expect(yggDateBucketKey(ago(const Duration(hours: 14)), now: now), 'drawer.bucketYesterday');
      expect(yggDateBucketKey(ago(const Duration(days: 5)), now: now), 'drawer.bucketThisWeek');
      expect(yggDateBucketKey(ago(const Duration(days: 40)), now: now), 'drawer.bucketOlder');
      expect(yggDateBucketKey(0, now: now), 'drawer.bucketOlder');
    });
  });

  test('yggCount picks the singular or plural string', () {
    expect(yggCount(1, oneKey: 'sessions.messagesOne', manyKey: 'sessions.messagesMany'), '1 mensaje');
    expect(yggCount(3, oneKey: 'sessions.messagesOne', manyKey: 'sessions.messagesMany'), '3 mensajes');
  });
}
