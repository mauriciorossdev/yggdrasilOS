import { createReadStream, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Parses Claude Code's own native session transcript (the JSONL file it
 * writes to ~/.claude/projects/<slug>/<session-id>.jsonl for every
 * invocation) into a flat, render-ready message list — same spirit as
 * https://github.com/daaain/claude-code-log. Used to give a `claude` pane's
 * mobile viewer a structured chat view instead of raw ANSI terminal text
 * (see terminals.ts's transcript* fields and paneControlServer.ts's
 * GET /panes/:id/transcript).
 */

export type TranscriptMessage =
  | { kind: "user"; text: string; timestamp: string }
  | { kind: "assistant_text"; text: string; timestamp: string }
  | { kind: "thinking"; text: string; timestamp: string }
  | { kind: "tool_use"; toolId: string; name: string; input: unknown; timestamp: string }
  | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean; timestamp: string };

/**
 * Claude Code names a project's transcript directory after the absolute cwd
 * with every non-alphanumeric character (path separators, underscores,
 * dots, ...) collapsed to "-" — confirmed empirically against this app's own
 * ~/.claude/projects entries, e.g. "/Users/x/harness_pp" -> "-Users-x-harness-pp".
 */
export function claudeProjectSlug(absCwd: string): string {
  return absCwd.replace(/[^a-zA-Z0-9]/g, "-");
}

// A grace window before spawnedAtMs — a file created a moment before the pty
// even finished starting up can still legitimately belong to it (clock skew
// between our Date.now() and the filesystem's own timestamp resolution).
const DISCOVERY_GRACE_MS = 3000;

/**
 * Finds this pane's own Claude Code transcript by matching filesystem state
 * rather than trusting a predicted filename — confirmed via real-world
 * testing that `claude --session-id <uuid>` is NOT honored when spawned as a
 * genuine interactive pty (an Ink TUI in a real node-pty session): Claude
 * Code silently keeps the flag but still mints its own random session id
 * for the transcript file, unlike headless/-p mode (tool-cli-delegate's own
 * usage), where --session-id IS honored. Picks the most-recently-created
 * .jsonl in this cwd's project dir with a birth time at/after `spawnedAtMs`
 * (within DISCOVERY_GRACE_MS) — good enough for the common case (one
 * `claude` pane spawned at a time per cwd); two panes spawned in the same
 * cwd within the same couple of seconds can still be misattributed, an
 * accepted edge case. Returns undefined if claude hasn't written its file
 * yet (still starting up) — callers should retry on a later poll.
 */
export async function discoverTranscriptPath(absCwd: string, spawnedAtMs: number): Promise<string | undefined> {
  const dir = join(homedir(), ".claude", "projects", claudeProjectSlug(absCwd));
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return undefined;
  }

  let best: { path: string; birth: number } | undefined;
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    let s;
    try {
      s = await stat(path);
    } catch {
      continue;
    }
    const birth = s.birthtimeMs || s.mtimeMs;
    if (birth < spawnedAtMs - DISCOVERY_GRACE_MS) continue;
    if (!best || birth > best.birth) best = { path, birth };
  }
  return best?.path;
}

// Deliberately loose (every field optional) rather than a discriminated
// union — the real file has block types beyond the four handled below (and
// may grow more), and a strict union's index-signature fallback member
// defeats `.type`-based narrowing in TS anyway. Presence/type of each field
// is checked by hand in parseTranscriptLine instead.
type RawContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | Array<{ type?: string; text?: string }>;
};

type RawLine = {
  type?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: {
    role?: string;
    content?: string | RawContentBlock[];
  };
};

function toolResultText(content: RawContentBlock["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** One JSONL line -> zero or more render-ready messages (an assistant line's content array can mix thinking/tool_use/text blocks). */
export function parseTranscriptLine(line: string): TranscriptMessage[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let raw: RawLine;
  try {
    raw = JSON.parse(trimmed) as RawLine;
  } catch {
    // Last line of a still-being-written file can be a partial flush —
    // silently skip rather than throw, same posture as an unrecognized type.
    return [];
  }

  if (raw.type !== "user" && raw.type !== "assistant") return [];
  if (raw.isMeta || raw.isSidechain) return [];

  const timestamp = raw.timestamp ?? "";
  const content = raw.message?.content;
  const isUser = raw.type === "user";

  if (typeof content === "string") {
    return content ? [{ kind: isUser ? "user" : "assistant_text", text: content, timestamp }] : [];
  }
  if (!Array.isArray(content)) return [];

  // A "user" line's content array isn't always literal human text — it's
  // also how a tool_result gets threaded back in (Claude Code represents a
  // tool's result as the next "user"-role turn), so both roles run through
  // the same block-kind switch; only a plain "text" block's OUTPUT kind
  // depends on which role it came from.
  const out: TranscriptMessage[] = [];
  for (const block of content) {
    switch (block.type) {
      case "text":
        if (block.text) out.push({ kind: isUser ? "user" : "assistant_text", text: block.text, timestamp });
        break;
      case "thinking":
        if (block.thinking) out.push({ kind: "thinking", text: block.thinking, timestamp });
        break;
      case "tool_use":
        if (block.id && block.name) {
          out.push({ kind: "tool_use", toolId: block.id, name: block.name, input: block.input, timestamp });
        }
        break;
      case "tool_result":
        if (block.tool_use_id) {
          out.push({
            kind: "tool_result",
            toolUseId: block.tool_use_id,
            text: toolResultText(block.content),
            isError: block.is_error === true,
            timestamp,
          });
        }
        break;
    }
  }
  return out;
}

export function parseClaudeTranscript(raw: string): TranscriptMessage[] {
  return raw.split("\n").flatMap(parseTranscriptLine);
}

/**
 * Reads only the bytes appended since `sinceOffset` — a claude session's
 * transcript can grow to tens/hundreds of MB over a long-running pane, so
 * re-parsing the whole file on every 1.5s poll isn't viable. Any trailing
 * partial line (the writer flushed mid-JSON-object) is held back and
 * re-consumed on the next call rather than dropped.
 */
export async function readTranscriptTail(
  path: string,
  sinceOffset: number,
  leftover: string,
): Promise<{ messages: TranscriptMessage[]; newOffset: number; newLeftover: string }> {
  const size = statSync(path).size;
  if (size <= sinceOffset) return { messages: [], newOffset: sinceOffset, newLeftover: leftover };

  const chunk = await new Promise<string>((resolve, reject) => {
    const parts: Buffer[] = [];
    const stream = createReadStream(path, { start: sinceOffset });
    stream.on("data", (d) => parts.push(d as Buffer));
    stream.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    stream.on("error", reject);
  });

  const combined = leftover + chunk;
  const lastNewline = combined.lastIndexOf("\n");
  const complete = lastNewline === -1 ? "" : combined.slice(0, lastNewline);
  const newLeftover = lastNewline === -1 ? combined : combined.slice(lastNewline + 1);

  return {
    messages: complete ? parseClaudeTranscript(complete) : [],
    newOffset: sinceOffset + Buffer.byteLength(combined.slice(0, lastNewline + 1), "utf8"),
    newLeftover,
  };
}
