/// Turns the native calendar rows (epoch millis) into what the model reads:
/// local ISO date-times for timed events, plain `YYYY-MM-DD` dates for
/// all-day ones — Android stores those as UTC midnights, so converting them
/// to local time would shift them by a day in negative-offset time zones.
Map<String, dynamic> formatCalendarResult(Map<String, dynamic> native) {
  final raw = (native['events'] as List?) ?? const [];
  final events = <Map<String, dynamic>>[];
  for (final e in raw) {
    final m = Map<String, dynamic>.from(e as Map);
    final allDay = m['allDay'] == true;
    final begin = (m['beginMs'] as num).toInt();
    final end = (m['endMs'] as num).toInt();
    events.add({
      'title': m['title'],
      'allDay': allDay,
      'start': allDay ? _date(DateTime.fromMillisecondsSinceEpoch(begin, isUtc: true)) : _local(begin),
      // An all-day event's END is the (exclusive) next midnight: show the last day it covers.
      'end': allDay
          ? _date(DateTime.fromMillisecondsSinceEpoch(end, isUtc: true).subtract(const Duration(days: 1)))
          : _local(end),
      if ((m['location'] as String?)?.isNotEmpty ?? false) 'location': m['location'],
      if ((m['description'] as String?)?.isNotEmpty ?? false) 'description': m['description'],
    });
  }
  return {'count': events.length, 'events': events};
}

String _local(int ms) {
  final s = DateTime.fromMillisecondsSinceEpoch(ms).toIso8601String();
  return s.contains('.') ? s.substring(0, s.indexOf('.')) : s;
}

String _date(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
