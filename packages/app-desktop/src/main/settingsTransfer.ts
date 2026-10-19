/**
 * Export/import of this app's configuration as a single Markdown file, so a
 * setup (provider URLs/keys, STT/TTS, IDE, automation…) can be moved to
 * another computer. Two stores feed it:
 *   - desktop-settings.json (userData): whisper, stt, tts, ide, automation, sync, phoneLink…
 *   - the project gateway's yggdrasil.config.json: providers, agents, MCP servers, channels…
 * Each lives in a fenced ```json block under its own heading; the import side
 * only trusts those two blocks, so the rest of the file is free-form notes.
 */

export const DESKTOP_HEADING = "## Desktop settings";
export const GATEWAY_HEADING = "## Gateway config";

/** Gateway keys config.patch accepts (config/src/patch.ts) minus "sessions" (machine paths). Others (gateway, plugins, sessions, connectors) are machine/OAuth-bound and never exported. */
const GATEWAY_EXPORT_KEYS = [
  "agents",
  "defaultAgent",
  "language",
  "harness",
  "auth",
  "channels",
  "pluginConfig",
  "context",
  "providers",
  "mcpServers",
] as const;

/** Leaf field names whose string value is a credential. */
const SECRET_FIELD = /(key|token|secret|password)$/i;
/** Open-ended maps that hold credentials as arbitrary key/value pairs (MCP env / headers). */
const SECRET_MAPS = new Set(["env", "headers"]);

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep copy with every credential blanked ("" for secret fields, dropped for env/headers maps). */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v)) as T;
  if (!isPlainObject(value)) return value;
  const out: Json = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_MAPS.has(k) && isPlainObject(v)) continue;
    if (typeof v === "string" && SECRET_FIELD.test(k)) out[k] = "";
    else out[k] = stripSecrets(v);
  }
  return out as T;
}

/** Deep copy without blank credential fields, so importing an export made without secrets never wipes keys already set here. */
export function dropEmptySecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => dropEmptySecrets(v)) as T;
  if (!isPlainObject(value)) return value;
  const out: Json = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === "" && SECRET_FIELD.test(k)) continue;
    out[k] = dropEmptySecrets(v);
  }
  return out as T;
}

export function pickGatewayExport(config: Json): Json {
  const out: Json = {};
  for (const k of GATEWAY_EXPORT_KEYS) if (config[k] !== undefined) out[k] = config[k];
  return out;
}

/** Deep-merge plain objects; arrays and scalars from `incoming` replace. */
export function deepMerge(existing: Json, incoming: Json): Json {
  const out: Json = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out;
}

export type ExportInput = {
  desktop: Json;
  /** Raw gateway config (unmasked) or null when no project is open. */
  gateway: Json | null;
  includeSecrets: boolean;
  exportedAt: Date;
};

export function buildExportMarkdown({ desktop, gateway, includeSecrets, exportedAt }: ExportInput): string {
  const d = includeSecrets ? desktop : stripSecrets(desktop);
  const g = gateway ? pickGatewayExport(includeSecrets ? gateway : stripSecrets(gateway)) : null;
  const lines = [
    "# Yggdrasil — exported settings",
    "",
    `Exported: ${exportedAt.toISOString()}`,
    `Secrets: ${includeSecrets ? "**included in plain text — treat this file as a credential**" : "not included (fields left blank; fill them in on the new machine)"}`,
    "",
    "Import from Settings → Exportar / Importar. Only the two JSON blocks below are read; edit values freely.",
    "Machine-specific values (local paths such as the Whisper models dir, phone-link/paired-device state, sync owner key) are exported as-is and may need adjusting.",
    "",
    DESKTOP_HEADING,
    "",
    "```json",
    JSON.stringify(d, null, 2),
    "```",
    "",
  ];
  if (g) {
    lines.push(
      GATEWAY_HEADING,
      "",
      "Providers, agents, MCP servers, channels and related keys of the project that was open. Connectors (OAuth) and gateway/sessions/plugins paths are never exported.",
      "",
      "```json",
      JSON.stringify(g, null, 2),
      "```",
      "",
    );
  }
  return lines.join("\n");
}

export type ParsedImport = { desktop: Json | null; gateway: Json | null; warnings: string[] };

function extractBlock(md: string, heading: string, warnings: string[]): Json | null {
  const start = md.indexOf(`\n${heading}`);
  const from = start === -1 ? (md.startsWith(heading) ? 0 : -1) : start + 1;
  if (from === -1) return null;
  const rest = md.slice(from + heading.length);
  const next = rest.search(/\n## /);
  const section = next === -1 ? rest : rest.slice(0, next);
  const m = /```json\s*\n([\s\S]*?)\n```/.exec(section);
  if (!m) {
    warnings.push(`"${heading.slice(3)}": no \`\`\`json block found, skipped`);
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(m[1]!);
    if (!isPlainObject(parsed)) throw new Error("not an object");
    return parsed;
  } catch (e) {
    warnings.push(`"${heading.slice(3)}": invalid JSON (${e instanceof Error ? e.message : String(e)}), skipped`);
    return null;
  }
}

export function parseImportMarkdown(md: string): ParsedImport {
  const warnings: string[] = [];
  const desktop = extractBlock(md, DESKTOP_HEADING, warnings);
  const gatewayRaw = extractBlock(md, GATEWAY_HEADING, warnings);
  let gateway: Json | null = null;
  if (gatewayRaw) {
    const known = new Set<string>(GATEWAY_EXPORT_KEYS);
    gateway = {};
    for (const [k, v] of Object.entries(gatewayRaw)) {
      if (known.has(k)) gateway[k] = dropEmptySecrets(v);
      else warnings.push(`Gateway key "${k}" is not importable, ignored`);
    }
  }
  if (!desktop && !gatewayRaw && warnings.length === 0) {
    warnings.push("No settings sections found — is this an exported Yggdrasil settings file?");
  }
  return { desktop: desktop ? dropEmptySecrets(desktop) : null, gateway, warnings };
}
