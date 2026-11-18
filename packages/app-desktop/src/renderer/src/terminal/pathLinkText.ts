// Pure text logic behind terminal/pathLinkProvider.ts: finding path-looking
// tokens in terminal rows, including ones a TUI split across rows.

/**
 * Requires at least one "/" so plain words never match (`~/x` counts), and a leading
 * non-"/" lookbehind so it never grabs the tail of a "https://…/…" URL that
 * @xterm/addon-web-links already claims. Trailing ":line" / ":line:col" (how
 * `claude` and most compilers cite a location) is captured and split off by
 * splitLocator.
 */
export const PATH_REGEX = /(?<![\w./@+:~-])(?:~\/(?:[\w.@+-]+\/)*[\w.@+-]+\/?|(?:\.{1,2})?\/?(?:[\w.@+-]+\/)+[\w.@+-]*)(?::\d+(?::\d+)?)?/g;

/** Characters a path fragment can be made of (no spaces): used to find the pieces around a row break. */
const PATH_CHAR = /[\w.@+~/:-]/;

/** One terminal row as text, plus the 0-based cell column of every string index (wide chars take 2 cells). */
export type Row = { text: string; cols: number[] };

export type Span = { row: number; start: number; end: number };

export type PathToken = {
  /** The whole path text, rows joined, locator included. */
  text: string;
  /** Pieces per row, in order (`end` exclusive, string indexes into that row's text). */
  spans: Span[];
};

export function splitLocator(raw: string): { path: string; line?: number } {
  const m = /^(.*?)(?::(\d+)(?::\d+)?)?$/.exec(raw);
  const path = m?.[1] ?? raw;
  const line = m?.[2] ? Number(m[2]) : undefined;
  return line ? { path, line } : { path };
}

/** Sentence punctuation that trails a path ("see src/a.ts." / "(src/a.ts)"). */
function trimTrailing(text: string): string {
  return text.replace(/[.,;:!?)\]'"`]+$/, "");
}

function leadingIndent(text: string): number {
  return /^\s*/.exec(text)![0].length;
}

/** The run of path chars that ends exactly at the end of the row's (right-trimmed) text, as [start, end). */
function trailingRun(text: string): [number, number] | null {
  const end = text.trimEnd().length;
  let start = end;
  while (start > 0 && PATH_CHAR.test(text[start - 1]!)) start--;
  return start < end ? [start, end] : null;
}

/** The run of path chars right after the row's indentation, as [start, end). */
function leadingRun(text: string): [number, number] | null {
  const start = leadingIndent(text);
  let end = start;
  while (end < text.length && PATH_CHAR.test(text[end]!)) end++;
  return end > start ? [start, end] : null;
}

const MAX_ROWS = 3;

/**
 * Every path-looking token that touches row `focus`, each with the
 * alternatives to try in order: longest join across rows first, then
 * shorter, ending with the token as it appears on its own row. A TUI like
 * Claude Code hard-wraps long lines itself (real newlines + indentation, not
 * xterm's soft wrap), so a row break inside a path can't be told from one
 * after it by the text alone; the caller keeps the first alternative that
 * exists on disk.
 */
export function pathTokensAt(rows: Row[], focus: number): PathToken[][] {
  const results: PathToken[][] = [];
  const seen = new Set<string>();

  // Joins that start on an earlier row and run into `focus`.
  for (let first = Math.max(0, focus - (MAX_ROWS - 1)); first <= focus; first++) {
    const run = trailingRun(rows[first]!.text);
    if (!run) continue;
    // Only a run that is itself the start of a token, i.e. preceded by a non-path char or the row start.
    const head = rows[first]!.text.slice(run[0], run[1]);
    const chains = buildChains(rows, first, run, head);
    const touching = chains.filter((c) => c.spans.some((s) => s.row === focus) && c.spans.length > 1);
    if (touching.length === 0) continue;
    const alternatives: PathToken[] = [];
    for (const chain of touching.sort((a, b) => b.spans.length - a.spans.length)) {
      const token = finalize(chain);
      if (token) alternatives.push(token);
    }
    // The plain single-row token comes last, if the focus row has one at this spot.
    const single = singleRowTokens(rows, focus).find((t) => alternatives.some((a) => overlaps(a, t)));
    if (single) alternatives.push(single);
    if (alternatives.length > 0) {
      const key = alternatives.map((a) => a.text).join("|");
      if (!seen.has(key)) {
        seen.add(key);
        results.push(alternatives);
      }
    }
  }

  // Plain tokens on the focus row that aren't part of a possible join.
  for (const token of singleRowTokens(rows, focus)) {
    if (results.some((alts) => alts.some((a) => overlaps(a, token)))) continue;
    results.push([token]);
  }
  return results;
}

/** Joins a trailing run on `first` with the leading runs of the following rows, one chain per length. */
function buildChains(rows: Row[], first: number, run: [number, number], head: string): { text: string; spans: Span[] }[] {
  const chains: { text: string; spans: Span[] }[] = [];
  let text = head;
  const spans: Span[] = [{ row: first, start: run[0], end: run[1] }];
  chains.push({ text, spans: spans.slice() });
  for (let row = first + 1; row < rows.length && row < first + MAX_ROWS; row++) {
    const next = leadingRun(rows[row]!.text);
    if (!next) break;
    text += rows[row]!.text.slice(next[0], next[1]);
    spans.push({ row, start: next[0], end: next[1] });
    chains.push({ text, spans: spans.slice() });
    // Keep going only if this piece also runs to the end of its row.
    if (next[1] !== rows[row]!.text.trimEnd().length) break;
  }
  return chains;
}

/** Cuts a raw chain down to the path inside it (the regex match covering its start), adjusting the spans. */
function finalize(chain: { text: string; spans: Span[] }): PathToken | null {
  const rex = new RegExp(PATH_REGEX.source, "g");
  let match: RegExpExecArray | null;
  const firstLen = chain.spans[0]!.end - chain.spans[0]!.start;
  while ((match = rex.exec(chain.text))) {
    const startIdx = match.index;
    const text = trimTrailing(match[0]);
    const endIdx = startIdx + text.length;
    // Must cross the first row break, or it isn't a join at all.
    if (startIdx >= firstLen || endIdx <= firstLen) continue;
    if (!/[a-zA-Z]/.test(text)) continue;
    return { text, spans: sliceSpans(chain.spans, startIdx, endIdx) };
  }
  return null;
}

function sliceSpans(spans: Span[], from: number, to: number): Span[] {
  const out: Span[] = [];
  let offset = 0;
  for (const span of spans) {
    const len = span.end - span.start;
    const a = Math.max(from, offset);
    const b = Math.min(to, offset + len);
    if (b > a) out.push({ row: span.row, start: span.start + (a - offset), end: span.start + (b - offset) });
    offset += len;
  }
  return out;
}

function singleRowTokens(rows: Row[], row: number): PathToken[] {
  const text = rows[row]!.text;
  const rex = new RegExp(PATH_REGEX.source, "g");
  const out: PathToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = rex.exec(text))) {
    const trimmed = trimTrailing(match[0]);
    if (!trimmed || !/[a-zA-Z]/.test(trimmed)) continue;
    out.push({ text: trimmed, spans: [{ row, start: match.index, end: match.index + trimmed.length }] });
  }
  return out;
}

function overlaps(a: PathToken, b: PathToken): boolean {
  return a.spans.some((x) => b.spans.some((y) => x.row === y.row && x.start < y.end && y.start < x.end));
}
