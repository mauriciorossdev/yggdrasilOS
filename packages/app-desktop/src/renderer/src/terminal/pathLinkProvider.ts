import type { IBufferCell, IBufferLine, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { pathTokensAt, splitLocator, type Row } from "./pathLinkText.js";

export type ResolvedTerminalPath = {
  abs: string;
  kind: "file" | "directory";
  insideProject: boolean;
  relativePath?: string;
};

/** How many rows around the hovered one are read, so a path split by a TUI's own wrapping is seen whole. */
const CONTEXT_ROWS = 2;

/**
 * Detects filesystem paths in terminal output and hands the resolved target
 * to `activate` on click. Modeled on @xterm/addon-web-links (same ILink range
 * convention: 1-based, end-inclusive), reimplemented because that addon's
 * `new URL(text)` check rejects every plain path.
 *
 * Only paths that exist on disk become links (`resolve` stats them), which is
 * also how a path split across rows is told apart from a path followed by an
 * ordinary word: pathTokensAt offers the joined form first and the first
 * alternative that exists wins, as one link spanning every row it covers.
 */
export class PathLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly resolve: (path: string) => Promise<ResolvedTerminalPath | null>,
    private readonly activate: (target: ResolvedTerminalPath, line: number | undefined) => void,
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const buffer = this.terminal.buffer.active;
    const focus = bufferLineNumber - 1;
    const from = Math.max(0, focus - CONTEXT_ROWS);
    const to = Math.min(buffer.length - 1, focus + CONTEXT_ROWS);
    const rows: Row[] = [];
    const cell = buffer.getNullCell();
    for (let i = from; i <= to; i++) rows.push(readRow(buffer.getLine(i), cell));
    if (!rows[focus - from]) return callback(undefined);

    const groups = pathTokensAt(rows, focus - from);
    if (groups.length === 0) return callback(undefined);

    void Promise.all(
      groups.map(async (alternatives) => {
        for (const token of alternatives) {
          const { path, line } = splitLocator(token.text);
          const target = await this.resolve(path).catch(() => null);
          if (target) return { token, target, line };
        }
        return null;
      }),
    ).then((found) => {
      const links: ILink[] = [];
      for (const hit of found) {
        if (!hit) continue;
        const first = hit.token.spans[0]!;
        const last = hit.token.spans[hit.token.spans.length - 1]!;
        const firstRow = rows[first.row]!;
        const lastRow = rows[last.row]!;
        links.push({
          text: hit.token.text,
          range: {
            start: { x: firstRow.cols[first.start]! + 1, y: from + first.row + 1 },
            end: { x: lastRow.cols[last.end - 1]! + 1, y: from + last.row + 1 },
          },
          activate: () => this.activate(hit.target, hit.line),
        });
      }
      callback(links.length > 0 ? links : undefined);
    });
  }
}

/**
 * A row's text plus the cell column of each string index. Not
 * translateToString: a wide char (CJK, many emoji) is one string char but two
 * cells, which would shift every underline after it.
 */
function readRow(line: IBufferLine | undefined, cell: IBufferCell): Row {
  if (!line) return { text: "", cols: [] };
  let text = "";
  const cols: number[] = [];
  for (let x = 0; x < line.length; x++) {
    line.getCell(x, cell);
    if (cell.getWidth() === 0) continue; // second half of a wide char
    const chars = cell.getChars() || " ";
    for (let i = 0; i < chars.length; i++) cols.push(x);
    text += chars;
  }
  return { text, cols };
}
