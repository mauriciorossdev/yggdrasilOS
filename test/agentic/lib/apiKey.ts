import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the Ollama Cloud key lives when it is not in the environment: outside the repo, readable by the user only. */
export const DEFAULT_KEY_FILE = join(homedir(), ".config", "yggdrasil", "ollama-cloud.key");

export type KeyLookup = { key?: string; source?: "env" | "file"; warning?: string };

/**
 * EVAL_OLLAMA_API_KEY, then OLLAMA_API_KEY, then the key file (EVAL_OLLAMA_API_KEY_FILE, or the default path).
 * An explicitly named key file that cannot be read is an error; a missing default file just means "no key".
 */
export function findApiKey(env: NodeJS.ProcessEnv = process.env, defaultFile = DEFAULT_KEY_FILE): KeyLookup {
  const fromEnv = env.EVAL_OLLAMA_API_KEY?.trim() || env.OLLAMA_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };

  const explicit = env.EVAL_OLLAMA_API_KEY_FILE?.trim();
  const path = explicit || defaultFile;
  try {
    const mode = statSync(path).mode;
    const key = readFileSync(path, "utf8").trim();
    if (!key) return {};
    // Group/other bits set means someone else on the machine can read it.
    const warning = mode & 0o077 ? `${path} is readable by other users; run: chmod 600 ${path}` : undefined;
    return { key, source: "file", warning };
  } catch (err) {
    if (explicit) throw new Error(`EVAL_OLLAMA_API_KEY_FILE=${explicit} cannot be read: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}
