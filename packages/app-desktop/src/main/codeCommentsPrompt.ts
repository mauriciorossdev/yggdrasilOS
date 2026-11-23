import { extname } from "node:path";
import type { CodeComment } from "./codeComments.js";

const SNIPPET_MAX_LINES = 30;

const FENCE_LANG: Record<string, string> = {
  ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx", ".mjs": "js", ".cjs": "js", ".py": "python", ".rs": "rust",
  ".go": "go", ".java": "java", ".kt": "kotlin", ".swift": "swift", ".rb": "ruby", ".php": "php", ".cs": "csharp",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".css": "css", ".scss": "scss", ".html": "html", ".json": "json",
  ".md": "md", ".sh": "sh", ".yml": "yaml", ".yaml": "yaml", ".sql": "sql", ".vue": "vue", ".svelte": "svelte",
};

function lines(c: CodeComment): string {
  return c.startLine === c.endLine ? `línea ${c.startLine}` : `líneas ${c.startLine}-${c.endLine}`;
}

function where(c: CodeComment): string {
  if (c.commitSha) return ` (en el commit ${c.commitSha.slice(0, 7)}${c.side === "original" ? ", versión anterior" : ""})`;
  return c.side === "original" ? " (líneas borradas en el diff)" : "";
}

function clipSnippet(snippet: string): string {
  const all = snippet.replace(/\s+$/, "").split("\n");
  if (all.length <= SNIPPET_MAX_LINES) return all.join("\n");
  return [...all.slice(0, SNIPPET_MAX_LINES), `… (${all.length - SNIPPET_MAX_LINES} líneas más)`].join("\n");
}

/** A fence longer than any backtick run inside the code, so the snippet can't close it early. */
function fenceFor(code: string): string {
  const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (m) => m[0].length));
  return "`".repeat(longest + 1);
}

/**
 * Task text for one or more review comments. Single block of plain text: it's
 * typed into a TUI, so no leading `/` or `!` on the first line and no trailing
 * newline (the pane write adds the Enter). Paths are relative to the repo or
 * worktree root, which is the cwd of the pane that did the work.
 */
export function buildCodeReviewPrompt(comments: CodeComment[], repoLabel: string): string {
  const out: string[] = [
    `Estos son comentarios de revisión sobre el código en ${repoLabel}. Las rutas son relativas a esa carpeta.`,
    "Aplica cada uno. Si tienes la tool MCP `code_comment_done`, llámala con el id de cada comentario apenas lo resuelvas.",
    "",
  ];
  comments.forEach((c, i) => {
    out.push(`### Comentario ${i + 1} (id: ${c.id})`);
    out.push(`Archivo: ${c.path}, ${lines(c)}${where(c)}`);
    const code = clipSnippet(c.snippet);
    if (code.trim()) {
      const fence = fenceFor(code);
      out.push(`${fence}${FENCE_LANG[extname(c.path).toLowerCase()] ?? ""}`, code, fence);
    }
    out.push(`Comentario: ${c.comment}`, "");
  });
  return out.join("\n").trimEnd();
}
