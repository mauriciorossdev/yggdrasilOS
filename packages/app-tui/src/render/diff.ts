export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";

export type DiffLine = {
  text: string;
  kind: DiffLineKind;
};

export function isUnifiedDiff(text: string): boolean {
  const lines = text.split("\n");
  let hunkCount = 0;
  let diffMarkers = 0;
  for (const line of lines) {
    if (line.startsWith("@@")) hunkCount++;
    if (line.startsWith("+++") || line.startsWith("---")) diffMarkers++;
    if (hunkCount >= 1 && diffMarkers >= 2) return true;
  }
  return false;
}

export function parseDiff(text: string): DiffLine[] {
  return text.split("\n").map((line) => {
    if (line.startsWith("@@")) return { text: line, kind: "hunk" };
    if (line.startsWith("+++") || line.startsWith("---")) return { text: line, kind: "meta" };
    if (line.startsWith("+")) return { text: line, kind: "add" };
    if (line.startsWith("-")) return { text: line, kind: "del" };
    return { text: line, kind: "ctx" };
  });
}
