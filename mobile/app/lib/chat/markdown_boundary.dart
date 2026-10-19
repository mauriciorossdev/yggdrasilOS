/// markdown-streaming-render-design.md §2 — scans backward from the end of
/// a streaming message for markdown markers left open (an unclosed `**`,
/// `*`/`_`, or `[link` never followed by `](...)`), and returns the index up
/// to which the text is safe to parse as markdown. Everything before the
/// returned index is a complete-enough prefix to render as markdown; the
/// rest ("cola insegura") should be shown as plain text until it closes.
///
/// Cheap string scan (no real parse) — safe to call on every delta,
/// independent of the render throttle, which only guards the actual
/// markdown parse/widget build.
///
/// An open fenced code block (```` ``` ````) is deliberately NOT treated as
/// unsafe here — it grows in place, line by line, exactly like ChatGPT/
/// Claude web while the model is still writing it; the doc explicitly calls
/// this out as intentional, not a gap. A half-formed table (headers with no
/// separator row yet) is also left alone — package:markdown can't recognize
/// it as a table until the separator arrives either way, so there's nothing
/// this heuristic could cut around; it's one accepted flicker, not a bug.
int findSafeMarkdownBoundary(String text) {
  if (text.isEmpty) return 0;

  // Never rescan an already-complete paragraph — only the last
  // in-progress one needs checking.
  final lastParagraphBreak = text.lastIndexOf('\n\n');
  final scanStart = lastParagraphBreak == -1 ? 0 : lastParagraphBreak + 2;
  final tail = text.substring(scanStart);

  var cut = tail.length;
  void considerCut(int index) {
    if (index >= 0 && index < cut) cut = index;
  }

  // "**" bold — an odd count means the last one never closed.
  final boldIndices = <int>[];
  var searchFrom = 0;
  while (true) {
    final i = tail.indexOf('**', searchFrom);
    if (i == -1) break;
    boldIndices.add(i);
    searchFrom = i + 2;
  }
  if (boldIndices.length.isOdd) considerCut(boldIndices.last);

  // Single "*"/"_" italics — walk the string, skipping "**" pairs so they
  // aren't double-counted as italic markers too.
  for (final marker in ['*', '_']) {
    final singleIndices = <int>[];
    var i = 0;
    while (i < tail.length) {
      if (tail[i] == marker) {
        if (marker == '*' && i + 1 < tail.length && tail[i + 1] == '*') {
          i += 2; // part of "**", not a single-italic marker
          continue;
        }
        singleIndices.add(i);
      }
      i++;
    }
    if (singleIndices.length.isOdd) considerCut(singleIndices.last);
  }

  // "[" with no completed "](...)" after it — link/image mid-write.
  final lastBracket = tail.lastIndexOf('[');
  if (lastBracket != -1) {
    final linkOpen = tail.indexOf('](', lastBracket);
    final linkClosed = linkOpen != -1 && tail.indexOf(')', linkOpen) != -1;
    if (!linkClosed) considerCut(lastBracket);
  }

  return scanStart + cut;
}
