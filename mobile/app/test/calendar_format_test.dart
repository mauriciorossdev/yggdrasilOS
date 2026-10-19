import 'package:app/capabilities/calendar_format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('timed events become local ISO date-times without milliseconds', () {
    final begin = DateTime(2026, 10, 8, 15, 30).millisecondsSinceEpoch;
    final end = DateTime(2026, 10, 8, 16, 30).millisecondsSinceEpoch;
    final out = formatCalendarResult({
      'events': [
        {'title': 'Reunión', 'beginMs': begin, 'endMs': end, 'allDay': false, 'location': 'Oficina', 'description': ''},
      ],
    });
    expect(out['count'], 1);
    final e = (out['events'] as List).single as Map;
    expect(e['start'], '2026-10-08T15:30:00');
    expect(e['end'], '2026-10-08T16:30:00');
    expect(e['location'], 'Oficina');
    expect(e.containsKey('description'), isFalse); // empty fields are dropped
  });

  test('all-day events use UTC dates and end on the last covered day', () {
    final begin = DateTime.utc(2026, 10, 9).millisecondsSinceEpoch;
    final end = DateTime.utc(2026, 10, 11).millisecondsSinceEpoch; // exclusive: covers 9th and 10th
    final out = formatCalendarResult({
      'events': [
        {'title': 'Viaje', 'beginMs': begin, 'endMs': end, 'allDay': true},
      ],
    });
    final e = (out['events'] as List).single as Map;
    expect(e['start'], '2026-10-09');
    expect(e['end'], '2026-10-10');
    expect(e['allDay'], true);
  });

  test('no events yields an empty list', () {
    expect(formatCalendarResult({'events': []}), {'count': 0, 'events': []});
    expect(formatCalendarResult({}), {'count': 0, 'events': []});
  });
}
