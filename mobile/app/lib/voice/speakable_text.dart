/// Longest text a single TTS request takes (the gateway rejects more:
/// packages/gateway/src/tts.ts TTS_MAX_CHARS).
const ttsMaxChars = 2000;

// Pictographs, dingbats, symbols and the joiners/selectors that glue emoji together.
final _emoji = RegExp(
  r'[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]',
  unicode: true,
);

/// Reduces a markdown reply to what's worth reading aloud: no code blocks,
/// links keep their label, no emphasis/heading/list markers, no emoji — and
/// capped at [ttsMaxChars] on a sentence boundary.
String speakableText(String markdown) {
  var t = markdown;
  t = t.replaceAll(RegExp(r'```[\s\S]*?```'), ' ');
  t = t.replaceAllMapped(RegExp(r'`([^`]*)`'), (m) => m[1] ?? '');
  t = t.replaceAllMapped(RegExp(r'!?\[([^\]]*)\]\([^)]*\)'), (m) => m[1] ?? '');
  t = t.replaceAll(RegExp(r'^\s{0,3}#{1,6}\s*', multiLine: true), '');
  t = t.replaceAll(RegExp(r'^\s*[-*+]\s+', multiLine: true), '');
  t = t.replaceAll(RegExp(r'^\s*\d+\.\s+', multiLine: true), '');
  t = t.replaceAll(RegExp(r'[*_~]{1,3}'), '');
  t = t.replaceAll(_emoji, '');
  t = t.replaceAll(RegExp(r'\n{2,}'), '. ').replaceAll('\n', ' ');
  t = t.replaceAll(RegExp(r'\s{2,}'), ' ').trim();
  if (t.length <= ttsMaxChars) return t;
  final cut = t.substring(0, ttsMaxChars);
  final end = cut.lastIndexOf(RegExp(r'[.!?]\s'));
  return end > ttsMaxChars ~/ 2 ? cut.substring(0, end + 1) : cut;
}

/// Splits [text] into chunks that are each worth one synthesis request: whole
/// sentences, with a sentence too short to bother ("Hola.") joined to the next
/// so the first request isn't a one-word clip, and any sentence over
/// [maxChars] cut at a comma or a space.
List<String> splitSentences(String text, {int minChars = 40, int maxChars = 240}) {
  final sentences = text
      .split(RegExp(r'(?<=[.!?…])\s+'))
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .expand((s) => _cutLong(s, maxChars));
  final chunks = <String>[];
  var current = '';
  for (final s in sentences) {
    current = current.isEmpty ? s : '$current $s';
    if (current.length >= minChars) {
      chunks.add(current);
      current = '';
    }
  }
  if (current.isNotEmpty) chunks.add(current);
  return chunks;
}

Iterable<String> _cutLong(String s, int maxChars) sync* {
  var rest = s;
  while (rest.length > maxChars) {
    var at = rest.lastIndexOf(RegExp(r'[,;:]\s'), maxChars);
    if (at < maxChars ~/ 2) at = rest.lastIndexOf(' ', maxChars);
    if (at <= 0) at = maxChars;
    yield rest.substring(0, at + 1).trim();
    rest = rest.substring(at + 1).trim();
  }
  if (rest.isNotEmpty) yield rest;
}
