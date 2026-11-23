/**
 * A line diff for the console's Repository page (git.diff2 returns both sides' full text;
 * the desktop app hands them to Monaco, the console renders this). Plain LCS: fine for the
 * file sizes a review shows; very large files fall back to "too big to diff".
 */
export type DiffLine = { kind: "same" | "add" | "del"; text: string; oldNo?: number; newNo?: number };

export const MAX_DIFF_CELLS = 4_000_000;

export function lineDiff(original: string, modified: string): DiffLine[] | null {
  const a = original === "" ? [] : original.replace(/\n$/, "").split("\n");
  const b = modified === "" ? [] : modified.replace(/\n$/, "").split("\n");
  if (a.length * b.length > MAX_DIFF_CELLS) return null;
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]!, oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]!, oldNo: i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]!, newNo: j + 1 });
      j++;
    }
  }
  for (; i < a.length; i++) out.push({ kind: "del", text: a[i]!, oldNo: i + 1 });
  for (; j < b.length; j++) out.push({ kind: "add", text: b[j]!, newNo: j + 1 });
  return out;
}

/** Keeps changed lines plus `context` unchanged lines around them; long unchanged runs become one "…" gap. */
export function withContext(lines: DiffLine[], context = 3): Array<DiffLine | { kind: "gap"; count: number }> {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: Array<DiffLine | { kind: "gap"; count: number }> = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipped) out.push({ kind: "gap", count: skipped });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ kind: "gap", count: skipped });
  return out;
}
