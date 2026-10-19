import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";

// Requires at least one "/" so plain words never match, and a leading
// non-"/" lookbehind so it never grabs the tail of a "https://…/…" URL that
// @xterm/addon-web-links' own provider (registered separately) already
// claims — that regex always starts right after "//", so this one simply
// refuses to start there. Trailing ":line" / ":line:col" (how `claude`
// itself cites a location, and how most CLIs/compilers do) is captured so
// it can be stripped before opening.
const PATH_REGEX = /(?<!\/)(?:[~.]{0,2}\/)?(?:[\w.-]+\/)+[\w.-]*(?::\d+(?::\d+)?)?/g;

/**
 * Detects filesystem-path-looking tokens in terminal output and hands them
 * to `activate` on click. Modeled on @xterm/addon-web-links' own
 * WebLinkProvider/LinkComputer (same ILink range convention: 1-based,
 * end-inclusive), reimplemented rather than reused because that addon's
 * computeLink() hardcodes a `new URL(text)` validity check that rejects
 * every plain path. Only scans the single buffer line under the cursor, not
 * wrapped continuation lines like the original — real paths rarely wrap a
 * terminal this wide, and skipping it keeps the position math a plain
 * 1-char-per-cell offset (paths are ASCII-only, so that's always exact).
 */
export class PathLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly activate: (event: MouseEvent, path: string) => void,
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) return callback(undefined);
    const text = line.translateToString(true);
    const rex = new RegExp(PATH_REGEX.source, "g");
    const links: ILink[] = [];
    let match: RegExpExecArray | null;
    while ((match = rex.exec(text))) {
      // Trailing punctuation is almost always sentence structure, not part
      // of the path (e.g. "see packages/foo/bar.ts.").
      const trimmed = match[0].replace(/[.,;:!?)]+$/, "");
      if (!trimmed || !/[a-zA-Z]/.test(trimmed)) continue;
      const idx0 = match.index;
      links.push({
        text: trimmed,
        range: {
          start: { x: idx0 + 1, y: bufferLineNumber },
          end: { x: idx0 + trimmed.length, y: bufferLineNumber },
        },
        activate: this.activate,
      });
    }
    callback(links.length > 0 ? links : undefined);
  }
}
