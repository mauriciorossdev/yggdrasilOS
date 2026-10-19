import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PLUGIN_API_DOCS } from "./pluginApiDocs.js";

type McpServersFile = { mcpServers?: Record<string, unknown>; [key: string]: unknown };

async function readExisting(path: string): Promise<McpServersFile> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as McpServersFile;
  } catch {
    return {};
  }
}

/**
 * Upserts a "panes" entry into the project's `.mcp.json` so every `claude`
 * CLI session launched with this project as cwd (any pane — see
 * buildLaunchCommand.ts / TerminalPane.tsx — auto-loads project `.mcp.json`)
 * picks up the create/write/read-pane tools without any per-node
 * configuration. Merges rather than overwrites, same caution as
 * gateway.ts's seedWorkspaceConfig — a hand-authored `.mcp.json` with other
 * servers must survive this.
 */
export async function writePaneControlMcpConfig(
  projectPath: string,
  shimPath: string,
  controlUrl: string,
  controlToken: string,
): Promise<void> {
  const path = join(projectPath, ".mcp.json");
  const existing = await readExisting(path);
  const merged: McpServersFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      // "node" (not process.execPath) deliberately — the shim is spawned by
      // the claude CLI's own MCP client via plain child_process.spawn (which
      // does its own PATH lookup), not node-pty, so none of
      // resolveYggdrasilTuiCommand's ConPTY-specific PATH-resolution
      // workarounds in terminals.ts apply here. Using Electron's own
      // process.execPath here would instead need ELECTRON_RUN_AS_NODE and
      // still risks Electron-runtime-init quirks a plain system Node avoids.
      panes: {
        command: "node",
        args: [shimPath],
        env: { PANE_CONTROL_URL: controlUrl, PANE_CONTROL_TOKEN: controlToken },
      },
    },
  };
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
}

/**
 * Upserts a "documents" entry into the project's `.mcp.json` — same
 * merge-not-overwrite caution as writePaneControlMcpConfig. Unlike panes,
 * there's no token/URL to hand the shim (documentsControlMcpShim.ts does
 * plain filesystem work, no HTTP bridge into a live Electron process) — just
 * the project root, so it can scope every call to <project>/notes.
 */
export async function writeDocumentsMcpConfig(projectPath: string, shimPath: string): Promise<void> {
  const path = join(projectPath, ".mcp.json");
  const existing = await readExisting(path);
  const merged: McpServersFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      documents: {
        command: "node",
        args: [shimPath],
        env: { YGGDRASIL_PROJECT_ROOT: projectPath },
      },
    },
  };
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
}

/**
 * Upserts a "plugins" entry into the project's `.mcp.json` — same merge and
 * env-var shape as writePaneControlMcpConfig (this shim also proxies to
 * paneControlServer.ts's loopback HTTP server, just a different set of
 * routes — see pluginsControlMcpShim.ts).
 */
export async function writePluginsMcpConfig(
  projectPath: string,
  shimPath: string,
  controlUrl: string,
  controlToken: string,
): Promise<void> {
  const path = join(projectPath, ".mcp.json");
  const existing = await readExisting(path);
  const merged: McpServersFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      plugins: {
        command: "node",
        args: [shimPath],
        env: { PANE_CONTROL_URL: controlUrl, PANE_CONTROL_TOKEN: controlToken },
      },
    },
  };
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
}

/**
 * Upserts a "memory" entry into the project's `.mcp.json` — same merge
 * caution as the others. Unlike documents/panes/plugins (spawned via plain
 * `"node"`, see writePaneControlMcpConfig's comment on why), this shim
 * (memoryControlMcpShim.ts) transitively depends on better-sqlite3
 * (@yggdrasil/context-memory-db) — a native addon whose ABI this app's own
 * `electron-builder install-app-deps` postinstall rebuilds for Electron's
 * bundled Node, not the system one (see docs/known-issues.md). Spawning it
 * via `process.execPath` + `ELECTRON_RUN_AS_NODE` (same trick
 * gateway.ts's spawnGatewaySubprocess already uses for the exact same
 * dependency) runs it under the ABI the installed binary actually matches,
 * instead of hitting that doc's NODE_MODULE_VERSION mismatch on launch.
 */
export async function writeMemoryMcpConfig(projectPath: string, shimPath: string): Promise<void> {
  const path = join(projectPath, ".mcp.json");
  const existing = await readExisting(path);
  const merged: McpServersFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      memory: {
        command: process.execPath,
        args: [shimPath],
        env: { ELECTRON_RUN_AS_NODE: "1", YGGDRASIL_PROJECT_ROOT: projectPath },
      },
    },
  };
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
}

/**
 * Upserts a "workflows" entry into the project's `.mcp.json` — same merge
 * caution as the others. Unlike panes/plugins (HTTP bridge into Electron
 * main) or documents/memory (plain filesystem), this shim
 * (workflowsMcpShim.ts) is a WS client of THIS project's own gateway
 * subprocess, so what it needs is that gateway's own loopback URL (the same
 * `ws://127.0.0.1:<port>` the renderer itself connects to — see
 * gateway.ts's `ensureGateway`), not a token: the gateway doesn't require
 * auth for a local connection by default (see packages/gateway/src/auth.ts's
 * `isWsAuthenticatedByDefault`).
 */
export async function writeWorkflowsMcpConfig(projectPath: string, shimPath: string, gatewayUrl: string): Promise<void> {
  const path = join(projectPath, ".mcp.json");
  const existing = await readExisting(path);
  const merged: McpServersFile = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      workflows: {
        command: "node",
        args: [shimPath],
        env: { WORKFLOWS_GATEWAY_URL: gatewayUrl },
      },
    },
  };
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
}

/**
 * Claude Code requires one-time human approval per project before it'll
 * actually connect to a server listed in that project's `.mcp.json` — until
 * then, create_pane/write_pane/etc. are silently unavailable to any
 * `claude` session running there (it just doesn't have the tools), which
 * looks to the user like the agent is ignoring them rather than lacking
 * the tool entirely. The "panes" server is entirely this app's own,
 * project-managed config (never user-authored, never something a human
 * would knowingly reject), so pre-approving it removes that one-time
 * friction — the user already trusts this app to spawn these processes;
 * this just tells Claude Code the same thing on their behalf.
 *
 * Mutates `~/.claude.json` directly — Claude Code's own undocumented state
 * file (also holds conversation history and a lot else), so this is
 * deliberately narrow: read, touch only this one project's
 * enabled/disabledMcpjsonServers, write the rest back untouched. Silently
 * does nothing if the file doesn't exist yet, or if Claude Code hasn't
 * created an entry for this project yet (its own first run there will —
 * this function runs again on every subsequent project open in this app,
 * so it self-heals from that point on).
 */
export async function trustPaneControlMcpServer(projectPath: string): Promise<void> {
  await trustMcpServer(projectPath, "panes");
}

/** Same trust-bypass as trustPaneControlMcpServer, for the "documents" server (documentsControlMcpShim.ts). */
export async function trustDocumentsMcpServer(projectPath: string): Promise<void> {
  await trustMcpServer(projectPath, "documents");
}

/** Same trust-bypass as trustPaneControlMcpServer, for the "plugins" server (pluginsControlMcpShim.ts). */
export async function trustPluginsMcpServer(projectPath: string): Promise<void> {
  await trustMcpServer(projectPath, "plugins");
}

/** Same trust-bypass as trustPaneControlMcpServer, for the "memory" server (memoryControlMcpShim.ts). */
export async function trustMemoryMcpServer(projectPath: string): Promise<void> {
  await trustMcpServer(projectPath, "memory");
}

/** Same trust-bypass as trustPaneControlMcpServer, for the "workflows" server (workflowsMcpShim.ts). */
export async function trustWorkflowsMcpServer(projectPath: string): Promise<void> {
  await trustMcpServer(projectPath, "workflows");
}

async function trustMcpServer(projectPath: string, serverId: string): Promise<void> {
  // Newer Claude Code keeps per-project approvals in <project>/.claude/
  // settings.local.json; older versions in ~/.claude.json. Writing both covers
  // either, and the local-settings one works even before Claude has created
  // this project's entry in ~/.claude.json (a brand-new project).
  await trustInLocalSettings(projectPath, serverId);
  await trustInClaudeJson(projectPath, serverId);
}

/** Upserts serverId into <project>/.claude/settings.local.json's enabledMcpjsonServers, leaving every other key untouched. */
async function trustInLocalSettings(projectPath: string, serverId: string): Promise<void> {
  const path = join(projectPath, ".claude", "settings.local.json");
  let root: Record<string, unknown> = {};
  try {
    root = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (err) {
    // Missing file is the normal first-run case; an unparseable one is the
    // user's own hand-edited config — don't clobber it.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return;
  }

  const enabled = Array.isArray(root.enabledMcpjsonServers) ? (root.enabledMcpjsonServers as string[]) : [];
  const disabled = Array.isArray(root.disabledMcpjsonServers) ? (root.disabledMcpjsonServers as string[]) : [];
  const nextDisabled = disabled.filter((s) => s !== serverId);
  if (enabled.includes(serverId) && nextDisabled.length === disabled.length) return;

  root.enabledMcpjsonServers = enabled.includes(serverId) ? enabled : [...enabled, serverId];
  if (disabled.length > 0) root.disabledMcpjsonServers = nextDisabled;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(root, null, 2), "utf8");
}

async function trustInClaudeJson(projectPath: string, serverId: string): Promise<void> {
  const claudeJsonPath = join(homedir(), ".claude.json");

  let root: Record<string, unknown>;
  try {
    root = JSON.parse(await readFile(claudeJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }

  const projects = root.projects as Record<string, Record<string, unknown>> | undefined;
  const project = projects?.[projectPath];
  if (!project) return;

  const enabled = new Set(
    Array.isArray(project.enabledMcpjsonServers) ? (project.enabledMcpjsonServers as string[]) : [],
  );
  const disabled = Array.isArray(project.disabledMcpjsonServers) ? (project.disabledMcpjsonServers as string[]) : [];
  const nextDisabled = disabled.filter((s) => s !== serverId);

  if (enabled.has(serverId) && nextDisabled.length === disabled.length) return;

  enabled.add(serverId);
  project.enabledMcpjsonServers = [...enabled];
  project.disabledMcpjsonServers = nextDisabled;

  await writeFile(claudeJsonPath, JSON.stringify(root, null, 2), "utf8");
}

// v1 of this feature appended the full guidance block straight into
// CLAUDE.md — kept here only so seedPaneControlGuidance can find and strip
// it out of any project that already has it, migrating to the v2 layout.
const OLD_PANES_GUIDANCE_MARKER = "<!-- yggdrasil:panes-guidance -->";
const PANES_GUIDANCE_MARKER = "<!-- yggdrasil:panes-guidance:v2 -->";
const PANES_GUIDE_RELATIVE_PATH = ".claude/yggdrasil-panes-guide.md";

const PANES_GUIDE_CONTENT = `# Spawning other agents

This project has a \`panes\` MCP tool (\`create_pane\`/\`write_pane\`/\`read_pane\`/\`list_panes\`) for spawning
real, visible terminal panes running \`claude\`. Prefer \`create_pane\` over the Task tool when the user's
request implies a persistent, ongoing helper they'll keep giving work to (a "terminal"/"agent"/"worker"
they can see, resume, and — with \`purpose\` set — gets saved as a reusable Team) rather than a one-shot
background lookup.

**A newly created pane must stay idle until you actually hand it work.** Creating a pane (even with
\`purpose\` set) never starts any work by itself — \`purpose\` only becomes that pane's system-prompt
context (its role), not a submitted prompt. Do not call \`write_pane\` immediately after \`create_pane\`
just to "get it going" — that's exactly the auto-start behavior this exists to avoid. Only call
\`write_pane\` once you have an actual, specific instruction ready for that pane, the same way a human
wouldn't type into a terminal the instant they open it.

## Handing off work by reference

Don't paste a long request into \`write_pane\` — every retelling loses detail and leaves no record. For any
non-trivial task, write a **feature doc** to \`notes/features/<slug>.md\` first (format: see
\`.claude/yggdrasil-documents-guide.md\`, "Feature docs"), then call \`write_pane\` with \`specPath\`:
\`{ id, specPath: "notes/features/<slug>.md", text: "Do task T2" }\`. The app types the instruction for you —
"read the feature doc at <absolute path> in full", followed by your \`text\` (or, if you omit it, "do the open tasks
assigned to you, tick a box only with observed proof, append to ## Log, reply with a 2-line summary") — and it
refuses, typing nothing, if the file doesn't exist yet or is outside \`notes/\`. Put the role plus the doc path in
\`purpose\` so the saved Team remembers it. To check progress, re-read the doc instead of scraping \`read_pane\`.

Delegate only when you can name the reason: exploration too long to do inline, two or more independent pieces
of work touching different files, or an independent verifier for a risky change. If the work fits in your own
context, do it yourself — a new pane has to re-read everything before it writes a line.

The same \`panes\` MCP tool also has \`browser_open\` — opens a URL in the desktop app's own Browser tab (a
real embedded page, not a screenshot) and switches the user to it. Use it to show the user a website or
pull up a page you both want to look at together, e.g. a staging deploy or docs page relevant to the task.

It also has \`browser_pick_element\` — arms a click-to-select overlay on whatever page is currently loaded
in that Browser tab and waits for the user to click something there. Use it instead of guessing from a
screenshot when you need to know exactly which element the user means — it resolves with that element's
tag, id, classes, a CSS selector, its text, and a trimmed outerHTML.
`;

const PANES_GUIDANCE_REFERENCE = `
${PANES_GUIDANCE_MARKER}
See \`${PANES_GUIDE_RELATIVE_PATH}\` for guidance on spawning other agents via the \`panes\` MCP tool.
@${PANES_GUIDE_RELATIVE_PATH}
`;

/**
 * A tool's own JSON-schema description competes with every other tool's for
 * attention and isn't enough on its own to shift this choice reliably (seen
 * twice this session: a plain pane asked to "create an agent in a new
 * terminal" still reached for the Task tool). `CLAUDE.md` is always-in-context
 * for every session in this project, no approval gate (unlike `.mcp.json`
 * servers) — the same mechanism an Agent Flow node's hand-set "System prompt
 * (appended)" already proved works for this exact instruction, just applied
 * automatically instead of requiring per-node configuration.
 *
 * The actual guidance text lives in its own app-owned file
 * (`.claude/yggdrasil-panes-guide.md`, rewritten in full every call — no
 * merge logic needed since nothing else should ever write there) rather
 * than directly inside CLAUDE.md: the user's own CLAUDE.md can be deleted,
 * hand-edited, or wholesale-regenerated (e.g. by `/init`) without any of
 * that being *this app's* problem to defend against — only a one-line
 * `@import` reference needs restoring, and that already happens on every
 * project open the same as before.
 */
export async function seedPaneControlGuidance(projectRoot: string): Promise<void> {
  const guidePath = join(projectRoot, PANES_GUIDE_RELATIVE_PATH);
  await mkdir(dirname(guidePath), { recursive: true });
  await writeFile(guidePath, PANES_GUIDE_CONTENT, "utf8");

  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  let existing = "";
  try {
    existing = await readFile(claudeMdPath, "utf8");
  } catch {
    // No CLAUDE.md yet — starts fresh with just the reference section.
  }

  if (existing.includes(PANES_GUIDANCE_MARKER)) return;

  // Migrate a v1 project: strip the old inline block before appending the
  // new reference-only section, rather than leaving both around.
  if (existing.includes(OLD_PANES_GUIDANCE_MARKER)) {
    existing = existing.slice(0, existing.indexOf(OLD_PANES_GUIDANCE_MARKER)).replace(/\s+$/, "");
  }

  const next =
    existing.length > 0
      ? `${existing}\n${PANES_GUIDANCE_REFERENCE}`
      : PANES_GUIDANCE_REFERENCE.trimStart();
  await writeFile(claudeMdPath, next, "utf8");
}

const DOCUMENTS_GUIDANCE_MARKER = "<!-- yggdrasil:documents-guidance:v1 -->";
const DOCUMENTS_GUIDE_RELATIVE_PATH = ".claude/yggdrasil-documents-guide.md";

const DOCUMENTS_GUIDE_CONTENT = `# Documents folder

This project's \`notes/\` folder is the app's "Documents" feature (see the Documents tab in the app UI) — it
is not a code/build directory. This project also has a \`documents\` MCP tool
(\`list_documents\`/\`read_document\`/\`write_document\`/\`delete_document\`/\`rename_document\`), hard-scoped to
\`notes/\` (paths outside it are rejected) and PDF-aware (\`read_document\` extracts text from \`.pdf\` files
instead of returning raw bytes). Prefer these over your own Read/Write/Edit/Glob when the user asks you to
review, read, create, or edit documents/notes (e.g. "revisa los documentos de X", "crea un documento sobre
esto en X carpeta de documents") — your own tools still work on \`notes/...\` paths too, but the \`documents\`
tools are the ones actually meant for this and match what the in-app Chat tab uses for the same feature.

## Feature docs

A feature doc is the shared brief for work split across agents: \`notes/features/<slug>.md\`, handed to workers
by path (see the panes guide, "Handing off work by reference"). **Path convention:** the \`documents\` tools take
paths relative to \`notes/\`, so create it with \`write_document\` using \`features/<slug>.md\` (writing
\`notes/features/<slug>.md\` there would create \`notes/notes/features/\`); your own Read/Write/Edit tools and
\`write_pane\`'s \`specPath\` use the project-relative \`notes/features/<slug>.md\`. Use this layout:

\`\`\`
# <title>
Status: working | checking | ready | needs-decision

## Specs
S1 — the user's own words, quoted verbatim, plus the acceptance criterion.

## Tasks
- [ ] T1 (S1) what to do — owner: <pane title>

## Log
L1 — the user's original request, verbatim. Later entries are only ever appended.
\`\`\`

Rules: read the whole doc before editing anything. Tick a task only with observed proof (a passing test, a
command's output) and note that proof in the Log. When a requirement changes, rewrite only the affected spec and
reopen only its tasks. Never paraphrase the user's request into a spec — quote it.
`;

const DOCUMENTS_GUIDANCE_REFERENCE = `
${DOCUMENTS_GUIDANCE_MARKER}
See \`${DOCUMENTS_GUIDE_RELATIVE_PATH}\` for guidance on this project's Documents folder (\`notes/\`).
@${DOCUMENTS_GUIDE_RELATIVE_PATH}
`;

/**
 * Same reasoning and layout as seedPaneControlGuidance above (own app-owned
 * guide file, short marked @import reference in CLAUDE.md) — points the
 * model at the "documents" MCP server (see writeDocumentsMcpConfig /
 * documentsControlMcpShim.ts) and explains `notes/` is the app's Documents
 * feature, same "a tool's own description alone isn't reliably enough"
 * discoverability nudge already proven necessary for create_pane vs. the
 * Task tool.
 */
export async function seedDocumentsGuidance(projectRoot: string): Promise<void> {
  const guidePath = join(projectRoot, DOCUMENTS_GUIDE_RELATIVE_PATH);
  await mkdir(dirname(guidePath), { recursive: true });
  await writeFile(guidePath, DOCUMENTS_GUIDE_CONTENT, "utf8");

  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  let existing = "";
  try {
    existing = await readFile(claudeMdPath, "utf8");
  } catch {
    // No CLAUDE.md yet — starts fresh with just the reference section.
  }

  if (existing.includes(DOCUMENTS_GUIDANCE_MARKER)) return;

  const next =
    existing.length > 0
      ? `${existing}\n${DOCUMENTS_GUIDANCE_REFERENCE}`
      : DOCUMENTS_GUIDANCE_REFERENCE.trimStart();
  await writeFile(claudeMdPath, next, "utf8");
}

const PLUGINS_GUIDANCE_MARKER = "<!-- yggdrasil:plugins-guidance:v1 -->";
const PLUGINS_GUIDE_RELATIVE_PATH = ".claude/yggdrasil-plugins-guide.md";

const PLUGINS_GUIDE_CONTENT = `# Complementos (plugins)

This project has a \`plugins\` MCP tool (\`scaffold_plugin\`/\`list_plugins\`/\`reload_plugin\`/\`open_plugin\`/
\`read_plugin_api_docs\`) for building small custom UIs ("complementos") that show up right inside the desktop
app — in its left sidebar, and as a main tab and/or an aside panel, exactly like Chat/Terminal/Documents do.
Every published complemento's own declared \`tools\` ALSO show up dynamically in this very tool list, one MCP
tool per complemento tool (named \`<scope>-<id>__<tool>\`, e.g. \`project-kanban__crear_tarea\`) — call
\`list_plugins\` (or just look at this session's own tool list) to see what's currently available; a fresh
complemento always ships with at least a callable \`ping\` example.

Reach for this whenever the user asks for a mini app, a tool, a dashboard, an extension, or anything phrased
like "build me a UI to manage X" / "create a complemento para..." — a complemento IS a real feature of the
app, not a throwaway script. Use \`scaffold_plugin\` to create the folder + manifest + starter files, then
edit those files (plain HTML/JS/CSS, no build step) with your normal file tools, then \`open_plugin\` so the
user sees it. \`read_plugin_api_docs\` (or the scaffolded folder's own README.md) has the full manifest schema
and the \`window.ygg\` API (storage, fs, panes, gateway.call, app.\*) available inside a complemento's page —
read it before writing one, its permission model (\`fs\`/\`fs:write\`/\`panes\`/\`gateway:<method>\`) is not
guessable from the tool schema alone.

Scope: \`scope: "project"\` (default) makes it visible only in this project; \`scope: "global"\` makes it
available from every project window instead — pick "global" only when the user explicitly wants that (a
generic utility, not something tied to this project's own content).

${PLUGIN_API_DOCS}
`;

const PLUGINS_GUIDANCE_REFERENCE = `
${PLUGINS_GUIDANCE_MARKER}
See \`${PLUGINS_GUIDE_RELATIVE_PATH}\` for guidance on building complementos via the \`plugins\` MCP tool.
@${PLUGINS_GUIDE_RELATIVE_PATH}
`;

/** Same reasoning and layout as seedPaneControlGuidance/seedDocumentsGuidance above. */
export async function seedPluginsGuidance(projectRoot: string): Promise<void> {
  const guidePath = join(projectRoot, PLUGINS_GUIDE_RELATIVE_PATH);
  await mkdir(dirname(guidePath), { recursive: true });
  await writeFile(guidePath, PLUGINS_GUIDE_CONTENT, "utf8");

  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  let existing = "";
  try {
    existing = await readFile(claudeMdPath, "utf8");
  } catch {
    // No CLAUDE.md yet — starts fresh with just the reference section.
  }

  if (existing.includes(PLUGINS_GUIDANCE_MARKER)) return;

  const next =
    existing.length > 0 ? `${existing}\n${PLUGINS_GUIDANCE_REFERENCE}` : PLUGINS_GUIDANCE_REFERENCE.trimStart();
  await writeFile(claudeMdPath, next, "utf8");
}

const MEMORY_GUIDANCE_MARKER = "<!-- yggdrasil:memory-guidance:v1 -->";
const MEMORY_GUIDE_RELATIVE_PATH = ".claude/yggdrasil-memory-guide.md";

const MEMORY_GUIDE_CONTENT = `# Búsqueda de datos de plugins y memoria persistente

This project has a \`memory\` MCP tool. Its \`plugin_data_search\` tool full-text-searches every installed
plugin's stored data for this project (e.g. a kanban board's card titles/descriptions/checklists) — this data
lives outside the project folder (in the app's own userData dir) and is otherwise invisible to your normal
Read/Grep/Glob tools. Use it whenever the user asks about something that might be tracked in a plugin rather
than in a file — "¿qué tareas quedan pendientes en el kanban?", "¿qué dice el tablero sobre X?" — instead of
assuming that information doesn't exist just because it's not in the repo.

It does **not** search project source files or \`notes/\` — those are already fully readable with your own
Read/Grep/Glob tools, no separate search needed.

The same server also has \`memory_add\`/\`memory_list\`/\`memory_search\`/\`memory_update\`/\`memory_remove\` — a
small persistent note store, separate from plugin data, for jotting down a fact you (the agent) want to
recall in a future session on this project (not for things the user asked you to write down as a document —
use the \`documents\` tool / \`notes/\` for that instead).
`;

const MEMORY_GUIDANCE_REFERENCE = `
${MEMORY_GUIDANCE_MARKER}
See \`${MEMORY_GUIDE_RELATIVE_PATH}\` for guidance on the \`memory\` MCP tool (plugin data search + persistent notes).
@${MEMORY_GUIDE_RELATIVE_PATH}
`;

/** Same reasoning and layout as seedPaneControlGuidance/seedDocumentsGuidance above. */
export async function seedMemoryGuidance(projectRoot: string): Promise<void> {
  const guidePath = join(projectRoot, MEMORY_GUIDE_RELATIVE_PATH);
  await mkdir(dirname(guidePath), { recursive: true });
  await writeFile(guidePath, MEMORY_GUIDE_CONTENT, "utf8");

  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  let existing = "";
  try {
    existing = await readFile(claudeMdPath, "utf8");
  } catch {
    // No CLAUDE.md yet — starts fresh with just the reference section.
  }

  if (existing.includes(MEMORY_GUIDANCE_MARKER)) return;

  const next =
    existing.length > 0 ? `${existing}\n${MEMORY_GUIDANCE_REFERENCE}` : MEMORY_GUIDANCE_REFERENCE.trimStart();
  await writeFile(claudeMdPath, next, "utf8");
}

const WORKFLOWS_GUIDANCE_MARKER = "<!-- yggdrasil:workflows-guidance:v1 -->";
const WORKFLOWS_GUIDE_RELATIVE_PATH = ".claude/yggdrasil-workflows-guide.md";

const WORKFLOWS_GUIDE_CONTENT = `# Automatizaciones (workflows)

This project has a \`workflows\` MCP tool (\`workflows_list\`/\`workflows_get\`/\`workflows_validate\`/
\`workflows_save\`/\`workflows_run\`/\`workflows_runs\`) for reading, authoring, and running this project's
n8n-style automation workflows (stored in \`.yggdrasil/workflows/\`, visible in the desktop app's own
Workflows tab) — not a chat feature, a real scheduled/triggered automation that keeps running (schedule,
webhook, mobile trigger) independent of this conversation.

Reach for this when the user asks to see, build, fix, or run a workflow/automation — "qué workflows hay
acá", "armame una automatización que...", "corré el workflow X". Use \`workflows_validate\` on a draft
before \`workflows_save\`; node types and their params aren't discoverable from this tool alone — read
\`notes/automation/workflows-design.md\` §3 (data model) and §4 (node catalog) first, or \`workflows_get\` an
existing workflow in this project as a concrete example to follow.

**This tool can save a workflow but can never grant it.** Any node that isn't risk-\`safe\` (most non-logic
nodes: \`http.request\` beyond GET, \`agent.ask\`, \`phone.tool\`, any desktop action) needs a human to grant
it from the desktop app's Workflows tab before \`workflows_run\` will actually run it — granting is
desktop-only by design, not something a Claude session can do on the user's behalf. If \`workflows_run\`
comes back with \`{run: null, skipped: true, reason: "grant_required"}\`, tell the user to grant it there;
don't try to work around it.
`;

const WORKFLOWS_GUIDANCE_REFERENCE = `
${WORKFLOWS_GUIDANCE_MARKER}
See \`${WORKFLOWS_GUIDE_RELATIVE_PATH}\` for guidance on this project's automation workflows via the \`workflows\` MCP tool.
@${WORKFLOWS_GUIDE_RELATIVE_PATH}
`;

/** Same reasoning and layout as seedPaneControlGuidance/seedDocumentsGuidance above. */
export async function seedWorkflowsGuidance(projectRoot: string): Promise<void> {
  const guidePath = join(projectRoot, WORKFLOWS_GUIDE_RELATIVE_PATH);
  await mkdir(dirname(guidePath), { recursive: true });
  await writeFile(guidePath, WORKFLOWS_GUIDE_CONTENT, "utf8");

  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  let existing = "";
  try {
    existing = await readFile(claudeMdPath, "utf8");
  } catch {
    // No CLAUDE.md yet — starts fresh with just the reference section.
  }

  if (existing.includes(WORKFLOWS_GUIDANCE_MARKER)) return;

  const next =
    existing.length > 0 ? `${existing}\n${WORKFLOWS_GUIDANCE_REFERENCE}` : WORKFLOWS_GUIDANCE_REFERENCE.trimStart();
  await writeFile(claudeMdPath, next, "utf8");
}
