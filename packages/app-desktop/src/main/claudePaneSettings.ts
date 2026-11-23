import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

/**
 * Settings → Agent CLIs → Claude Code: how every `claude` pane the app opens
 * starts (see notes/features/claude-pane-settings.md). Every option defaults
 * to "inherit" — the app passes nothing for it and the pane starts exactly
 * as `~/.claude/settings.json` says. Nothing here ever writes to that file:
 * options go to the pane as `--settings <file>` and environment variables.
 */

export const CAVEMAN_MODES = ["inherit", "full", "lite", "ultra", "off"] as const;
export type CavemanMode = (typeof CAVEMAN_MODES)[number];

/**
 * Which user-scope MCP servers (~/.claude.json "mcpServers") a pane loads —
 * notes/features/claude-pane-mcp.md. "all" passes nothing; "none" and "pick"
 * deny the rest through `deniedMcpServers` in `--settings` (verified: only the
 * named servers are dropped — project/local MCPs, claude.ai connectors and
 * plugins stay; `--strict-mcp-config` was rejected because it drops those too).
 * `allowed` is a list of names to load, so a user MCP added later starts
 * unchecked under "pick".
 */
export type UserMcpChoice = {
  mode: "all" | "none" | "pick";
  allowed: string[];
  /** User servers that existed when this was saved — anything else is shown as "new" (and isn't loaded under "pick"). */
  known?: string[];
};

export type ClaudePaneSettings = {
  /** Read by the caveman plugin's SessionStart hook (CAVEMAN_DEFAULT_MODE). */
  caveman: CavemanMode;
  /** "off" passes advisorModel "" (verified: shows "No advisor"; null is rejected as invalid settings). */
  advisor: "inherit" | "off" | "model";
  /** Model alias or full id, used when advisor is "model". */
  advisorModel: string;
  promptSuggestions: "inherit" | "on" | "off";
  /** Any other Claude Code settings, as the JSON object text the user typed ("" = none). */
  extraSettings: string;
  /** Global default; an Agent Flow node can override it (harness.userMcp). */
  userMcp: UserMcpChoice;
  /** Attention states (waiting / done) — notes/features/attention-inbox.md. */
  attention: AttentionSettings;
};

export type AttentionSettings = {
  /** Off: no hooks are injected and panes show no states. */
  enabled: boolean;
  notifyWaiting: boolean;
  notifyDone: boolean;
  /** Messages for a busy agent wait in the pane's queue until its turn ends (paneQueueHost.ts). */
  holdMessages: boolean;
};

export function defaultClaudePaneSettings(): ClaudePaneSettings {
  return {
    caveman: "inherit",
    advisor: "inherit",
    advisorModel: "",
    promptSuggestions: "inherit",
    extraSettings: "",
    userMcp: { mode: "all", allowed: [] },
    attention: { enabled: true, notifyWaiting: true, notifyDone: true, holdMessages: true },
  };
}

/** A user-MCP choice from the renderer, a node or an old file; undefined when it isn't one. */
export function sanitizeUserMcpChoice(raw: unknown): UserMcpChoice | undefined {
  const input = (raw ?? {}) as { mode?: unknown; allowed?: unknown; known?: unknown };
  if (input.mode !== "all" && input.mode !== "none" && input.mode !== "pick") return undefined;
  const names = (list: unknown) =>
    Array.isArray(list) ? [...new Set(list.filter((n): n is string => typeof n === "string" && n.length > 0 && n.length <= 200))] : [];
  const choice: UserMcpChoice = { mode: input.mode, allowed: names(input.allowed) };
  if (Array.isArray(input.known)) choice.known = names(input.known);
  return choice;
}

/** The user-scope servers to deny for a choice, given the user-scope servers that exist right now. */
export function deniedUserMcp(choice: UserMcpChoice, userServers: string[]): string[] {
  if (choice.mode === "all") return [];
  if (choice.mode === "none") return [...userServers];
  return userServers.filter((name) => !choice.allowed.includes(name));
}

/** The parsed extra settings, or an error message when the text isn't a JSON object. "" parses to {}. */
export function parseExtraSettings(text: string): { value: Record<string, unknown> } | { error: string } {
  if (text.trim() === "") return { value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "must be a JSON object, e.g. {\"key\": value}" };
  }
  return { value: parsed as Record<string, unknown> };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Whatever the renderer or an old settings file hands us, reduced to safe settings. Invalid extra JSON is dropped. */
export function sanitizeClaudePaneSettings(raw: unknown): ClaudePaneSettings {
  const input = (raw ?? {}) as Partial<Record<keyof ClaudePaneSettings, unknown>>;
  const d = defaultClaudePaneSettings();
  const advisorModel = typeof input.advisorModel === "string" ? input.advisorModel.trim() : d.advisorModel;
  let advisor = oneOf(input.advisor, ["inherit", "off", "model"] as const, d.advisor);
  if (advisor === "model" && advisorModel === "") advisor = "inherit";
  const extraSettings = typeof input.extraSettings === "string" ? input.extraSettings : d.extraSettings;
  return {
    caveman: oneOf(input.caveman, CAVEMAN_MODES, d.caveman),
    advisor,
    advisorModel,
    promptSuggestions: oneOf(input.promptSuggestions, ["inherit", "on", "off"] as const, d.promptSuggestions),
    extraSettings: "value" in parseExtraSettings(extraSettings) ? extraSettings : "",
    userMcp: sanitizeUserMcpChoice(input.userMcp) ?? d.userMcp,
    attention: sanitizeAttention(input.attention, d.attention),
  };
}

function sanitizeAttention(raw: unknown, d: AttentionSettings): AttentionSettings {
  const input = (raw ?? {}) as Partial<Record<keyof AttentionSettings, unknown>>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    enabled: bool(input.enabled, d.enabled),
    notifyWaiting: bool(input.notifyWaiting, d.notifyWaiting),
    notifyDone: bool(input.notifyDone, d.notifyDone),
    holdMessages: bool(input.holdMessages, d.holdMessages),
  };
}

/**
 * The Claude Code hooks that report a pane's attention state, each running
 * `<bridgeCommand> <event>` (attentionBridge.ts). AskUserQuestion is the only
 * PreToolUse matched: a hook on every tool call would add a process spawn to
 * each one. Merged with the user's own hooks by Claude Code (verified: hooks
 * from --settings run alongside ~/.claude/settings.json's).
 */
export function attentionHooks(bridgeCommand: string): Record<string, unknown[]> {
  const run = (event: string) => [{ type: "command", command: `${bridgeCommand} ${event}`, timeout: 5 }];
  return {
    UserPromptSubmit: [{ hooks: run("prompt") }],
    PreToolUse: [{ matcher: "AskUserQuestion", hooks: run("ask") }],
    Notification: [{ hooks: run("notification") }],
    Stop: [{ hooks: run("stop") }],
    SessionEnd: [{ hooks: run("end") }],
  };
}

/** `extra` hooks first, then ours, per event — the user's extra JSON may define hooks of its own. */
function mergeHooks(extra: unknown, ours: Record<string, unknown[]>): Record<string, unknown[]> {
  const merged: Record<string, unknown[]> = {};
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    for (const [event, list] of Object.entries(extra as Record<string, unknown>)) {
      if (Array.isArray(list)) merged[event] = [...list];
    }
  }
  for (const [event, list] of Object.entries(ours)) merged[event] = [...(merged[event] ?? []), ...list];
  return merged;
}

export type ClaudeLaunchOverrides = {
  /** Claude Code settings for `--settings`; null when there's nothing to pass. */
  settings: Record<string, unknown> | null;
  env: Record<string, string>;
};

/**
 * What a new `claude` pane gets from these settings. The explicit options win
 * over the same keys in the extra JSON, except `deniedMcpServers`, whose
 * entries are merged. `denyMcp` = user-scope servers this pane must not load.
 */
export function claudeLaunchOverrides(
  s: ClaudePaneSettings,
  denyMcp: string[] = [],
  /** attentionBridge.ts's command line; hooks are added only with it and attention enabled. */
  attentionBridgeCommand?: string,
): ClaudeLaunchOverrides {
  const extra = parseExtraSettings(s.extraSettings);
  const settings: Record<string, unknown> = "value" in extra ? { ...extra.value } : {};
  if (s.advisor === "off") settings.advisorModel = "";
  if (s.advisor === "model" && s.advisorModel) settings.advisorModel = s.advisorModel;
  if (s.promptSuggestions !== "inherit") settings.promptSuggestionEnabled = s.promptSuggestions === "on";
  if (denyMcp.length > 0) {
    const fromExtra = Array.isArray(settings.deniedMcpServers) ? (settings.deniedMcpServers as unknown[]) : [];
    const named = new Set(
      fromExtra.map((e) => (e as { serverName?: unknown })?.serverName).filter((n): n is string => typeof n === "string"),
    );
    settings.deniedMcpServers = [...fromExtra, ...denyMcp.filter((n) => !named.has(n)).map((serverName) => ({ serverName }))];
  }
  if (s.attention.enabled && attentionBridgeCommand) {
    settings.hooks = mergeHooks(settings.hooks, attentionHooks(attentionBridgeCommand));
  }
  const env: Record<string, string> = {};
  if (s.caveman !== "inherit") env.CAVEMAN_DEFAULT_MODE = s.caveman;
  return { settings: Object.keys(settings).length > 0 ? settings : null, env };
}

function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(os.homedir(), ".claude");
}

/** Caveman is set up either by its hook installer (~/.claude/hooks) or as the caveman@caveman plugin. */
export function isCavemanInstalled(): boolean {
  const dir = claudeConfigDir();
  if (existsSync(join(dir, "hooks", "caveman-activate.js"))) return true;
  try {
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as { enabledPlugins?: Record<string, unknown> };
    return settings.enabledPlugins?.["caveman@caveman"] === true;
  } catch {
    return false;
  }
}

export type UserMcpServer = { name: string; kind: "local" | "remote" };

/** The user-scope MCP servers in a parsed ~/.claude.json: "local" spawns a process per pane (command), "remote" doesn't (url). */
export function userMcpServersFrom(claudeJson: unknown): UserMcpServer[] {
  const servers = (claudeJson as { mcpServers?: Record<string, unknown> } | null)?.mcpServers;
  if (!servers || typeof servers !== "object") return [];
  return Object.entries(servers).map(([name, entry]) => ({
    name,
    kind: typeof (entry as { command?: unknown })?.command === "string" ? "local" : "remote",
  }));
}

let userServersCache: { path: string; mtimeMs: number; servers: UserMcpServer[] } | null = null;

/** ~/.claude.json's user-scope MCP servers, re-parsed only when the file changed (it can be hundreds of KB). */
export function readUserMcpServers(): UserMcpServer[] {
  const path = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(os.homedir(), ".claude.json");
  try {
    const { mtimeMs } = statSync(path);
    if (userServersCache && userServersCache.path === path && userServersCache.mtimeMs === mtimeMs) return userServersCache.servers;
    const servers = userMcpServersFrom(JSON.parse(readFileSync(path, "utf8")));
    userServersCache = { path, mtimeMs, servers };
    return servers;
  } catch {
    return [];
  }
}

// --- Live state used at pane spawn (createTerminal is synchronous) ---------

let current: { userDataDir: string; settings: ClaudePaneSettings } | null = null;
let attentionBridgeCommand: string | undefined;

/** Set once at startup by main/index.ts: how a hook runs attentionBridge.js. */
export function setAttentionBridgeCommand(command: string): void {
  attentionBridgeCommand = command;
}

/** Whether new claude panes get the attention hooks (and so the env they need). */
export function attentionEnabled(): boolean {
  return Boolean(current?.settings.attention.enabled && attentionBridgeCommand);
}

/** The live attention settings (defaults until settings have loaded). */
export function currentAttentionSettings(): AttentionSettings {
  return current?.settings.attention ?? defaultClaudePaneSettings().attention;
}

function applyLive(userDataDir: string, settings: ClaudePaneSettings): void {
  current = { userDataDir, settings };
}

/**
 * The file `--settings` points at, named by its content so panes with
 * different per-node MCP choices each get theirs and identical ones share it.
 * A file rather than inline JSON: no quoting trouble passing JSON through
 * node-pty on Windows (where `claude` may be a .cmd shim).
 */
function settingsFileFor(userDataDir: string, settings: Record<string, unknown>): string {
  const text = JSON.stringify(settings, null, 2);
  const dir = join(userDataDir, "claude-pane-settings");
  const file = join(dir, `${createHash("sha256").update(text).digest("hex").slice(0, 16)}.json`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  return file;
}

/**
 * Extra args/env for a new `claude` pane — empty until settings have loaded,
 * or when everything is "inherit"/"all". `nodeUserMcp` is an Agent Flow
 * node's own MCP choice, which replaces the global one for that pane.
 */
export function claudePaneLaunchExtras(nodeUserMcp?: UserMcpChoice): { args: string[]; env: Record<string, string> } {
  if (!current) return { args: [], env: {} };
  const choice = nodeUserMcp ?? current.settings.userMcp;
  const deny = choice.mode === "all" ? [] : deniedUserMcp(choice, readUserMcpServers().map((s) => s.name));
  const overrides = claudeLaunchOverrides(current.settings, deny, attentionBridgeCommand);
  return {
    args: overrides.settings ? ["--settings", settingsFileFor(current.userDataDir, overrides.settings)] : [],
    env: overrides.env,
  };
}

/** Stored in desktop-settings.json under "cliAgents.claude". */
export async function loadClaudePaneSettings(userDataDir: string): Promise<ClaudePaneSettings> {
  const raw = (await readSettingsFile(userDataDir)) as { cliAgents?: { claude?: unknown } };
  const settings = sanitizeClaudePaneSettings(raw.cliAgents?.claude);
  applyLive(userDataDir, settings);
  return settings;
}

/** Throws (message shown in Settings) when the extra settings aren't a JSON object — nothing is saved then. */
export async function saveClaudePaneSettings(userDataDir: string, settings: ClaudePaneSettings): Promise<ClaudePaneSettings> {
  const extra = parseExtraSettings(typeof settings?.extraSettings === "string" ? settings.extraSettings : "");
  if ("error" in extra) throw new Error(`Extra settings: ${extra.error}`);
  const clean = sanitizeClaudePaneSettings(settings);
  await updateSettingsFile(userDataDir, (existing) => {
    const cliAgents = (existing.cliAgents ?? {}) as Record<string, unknown>;
    return { ...existing, cliAgents: { ...cliAgents, claude: clean } };
  });
  applyLive(userDataDir, clean);
  return clean;
}
