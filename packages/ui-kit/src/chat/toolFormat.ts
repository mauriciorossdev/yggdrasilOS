const PRIMARY_KEYS = ["command", "path", "url", "query", "file", "name", "text"];

/** One short line describing a tool call's arguments: the main string value, else compact key: value pairs. */
export function summarizeArgs(args: Record<string, unknown> | undefined, max = 140): string {
  if (!args) return "";
  const primary = PRIMARY_KEYS.map((k) => args[k]).find((v) => typeof v === "string" && v.trim());
  const text =
    typeof primary === "string"
      ? primary
      : Object.entries(args)
          .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(" · ");
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export type FormattedResult = {
  /** Readable output to show (collapsed); empty when there's nothing worth showing. */
  body: string;
  /** Short status note, e.g. "exit 1". */
  note?: string;
};

/** Turns a tool's raw result string into something readable: shell results lose their JSON envelope. */
export function formatToolResult(raw: string): FormattedResult {
  const text = raw.trim();
  if (!text) return { body: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { body: text };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if ("stdout" in o || "stderr" in o) {
      const out = [o.stdout, o.stderr].filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()).join("\n");
      const code = typeof o.exitCode === "number" && o.exitCode !== 0 ? `exit ${o.exitCode}` : undefined;
      return { body: out, note: code };
    }
  }
  return { body: JSON.stringify(parsed, null, 2) };
}

const PATH_KEYS = ["path", "file", "filePath", "file_path"];

/** Project-relative form of a path, or null if it points outside the project. */
export function toProjectRelative(path: string, projectPath: string | undefined): string | null {
  let p = path.trim();
  if (!p) return null;
  if (p.startsWith("/")) {
    const root = projectPath?.replace(/\/+$/, "");
    if (!root || !p.startsWith(`${root}/`)) return null;
    p = p.slice(root.length + 1);
  }
  p = p.replace(/^\.\//, "");
  return p && !p.split("/").includes("..") ? p : null;
}

/** The file a tool call is about, if it names one inside the project (so its card can offer "open in panel"). */
export function openableFilePath(args: Record<string, unknown> | undefined, projectPath: string | undefined): string | null {
  if (!args) return null;
  for (const key of PATH_KEYS) {
    const v = args[key];
    if (typeof v === "string") return toProjectRelative(v, projectPath);
  }
  return null;
}
