import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MAX_INPUT_HISTORY = 500;

export function defaultInputHistoryPath(): string {
  return join(homedir(), ".yggdrasil", "tui-history.json");
}

/** Oldest first, like the in-memory list. A missing or corrupt file just means no history. */
export async function loadInputHistory(path: string = defaultInputHistoryPath()): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0).slice(-MAX_INPUT_HISTORY);
  } catch {
    return [];
  }
}

export async function saveInputHistory(entries: string[], path: string = defaultInputHistoryPath()): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entries.slice(-MAX_INPUT_HISTORY)), { mode: 0o600 });
    await rename(tmp, path); // atomic, so two TUIs can't leave a half-written file
  } catch {
    // history is a convenience; never let it break the UI
  }
}

/** What loaded history and this session's entries add up to, without doubling an entry typed in both. */
export function mergeInputHistory(persisted: string[], current: string[]): string[] {
  const merged = [...persisted];
  for (const entry of current) {
    if (merged[merged.length - 1] !== entry) merged.push(entry);
  }
  return merged.slice(-MAX_INPUT_HISTORY);
}
