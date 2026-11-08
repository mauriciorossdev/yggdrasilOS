/**
 * Secrets the eval was given (an Ollama Cloud API key). They must never end up in a report: the model can
 * print an environment variable or a config file, and reports quote tool results and replies verbatim.
 * Everything written to disk goes through redact()/redactDeep().
 */
const secrets = new Set<string>();
const MASK = "[redacted]";

export function registerSecret(value: string | undefined): void {
  const trimmed = value?.trim();
  // Very short values would mangle ordinary text when masked.
  if (trimmed && trimmed.length >= 8) secrets.add(trimmed);
}

export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(MASK);
  return out;
}

/** Redacts every string inside a JSON-like value (keys are left alone). */
export function redactDeep<T>(value: T): T {
  if (secrets.size === 0) return value;
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}

export function clearSecretsForTest(): void {
  secrets.clear();
}
