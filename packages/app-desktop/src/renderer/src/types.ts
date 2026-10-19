// Ad hoc RPC/event payload types for whatever this renderer calls, mirroring
// web-console's convention (no shared, type-safe RPC registry — see
// @yggdrasil/client-web's README). Subset ported from app-tui's
// src/client/types.ts, the fullest existing description of these shapes.

export type ChatSendParams = {
  message: string;
  channelId?: string;
  accountId?: string;
  senderId?: string;
  sessionKey?: string;
  agentId?: string;
};

export type ChatSendResult = {
  sessionKey: string;
  reply: string;
  harnessId: string;
};

export type ChatDeltaPayload = {
  sessionKey: string;
  text: string;
};

export type ChatFinalPayload = {
  sessionKey: string;
  text: string;
  harnessId: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type TurnStartPayload = {
  sessionKey: string;
  agentId: string;
  harnessId: string;
};

export type TurnEndPayload = {
  sessionKey: string;
  classification: "ok" | "error" | "retry" | "fallback";
  durationMs: number;
};

export type ToolExecutePayload = {
  sessionKey: string;
  toolName: string;
  status: "running" | "ok" | "error";
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  image?: { base64: string; mimeType: string; path?: string };
};

export type ToolApprovalRequestedPayload = {
  requestId: string;
  sessionKey: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: "destructive" | "moderate" | "safe";
  /** The requesting connection's registered device id, when known — see gateway's requireFsApproval. Lets ApprovalBar offer "trust this device" instead of just "approve this one call". */
  deviceId?: string;
};

/** Claude Code's own session (5h) / weekly (7d) rate-limit usage — see statuslineBridge.ts and paneControlServer.ts's /statusline route. */
export type RateLimitWindow = { usedPercentage: number; resetsAt: number };
export type RateLimitsPayload = { fiveHour?: RateLimitWindow; sevenDay?: RateLimitWindow };

export type ToolApprovalResolvedPayload = {
  requestId: string;
  sessionKey: string;
  toolName: string;
  approved: boolean;
};

export type ApprovalMode = "auto" | "plan" | "restrict" | "yolo";

export type ApprovalModeChangedPayload = {
  sessionKey: string;
  mode: ApprovalMode;
};

export type AgentInfo = {
  id: string;
  label?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  scope?: "local" | "global";
};

export type CreateAgentParams = {
  id: string;
  label?: string;
  systemPrompt?: string;
  provider?: string;
  model?: string;
  scope: "local" | "global";
};

export type CreateAgentResult = {
  ok: true;
  agent: AgentInfo;
};

export type UpdateAgentParams = {
  id: string;
  label?: string;
  systemPrompt?: string;
  provider?: string;
  model?: string;
  scope: "local" | "global";
};

export type GetAgentParams = { id: string; scope: "local" | "global" };

export type GetAgentResult = { agent: AgentInfo };

export type ProviderModelInfo = {
  id: string;
  label: string;
  provider: string;
  contextWindow?: number;
  supportsTools?: boolean;
};

export type ProviderInfo = {
  id: string;
  label: string;
  models: ProviderModelInfo[];
  error?: string;
};

export type SessionInfo = {
  sessionKey: string;
  title?: string;
  messageCount: number;
  updatedAt: number;
};

export type SessionRecord = {
  sessionKey: string;
  title?: string;
  messages: Array<{ role: string; content: string; timestamp?: number }>;
};

export type ConfigAgent = { id: string; label?: string; provider?: string; model?: string };

export type HarnessInfo = { id: string; label: string };

export type ConfigProvider = { baseUrl?: string; apiKey?: string; defaultModel?: string };

// env/headers are intentionally absent here — sanitizeConfigForClient strips
// them from every config.get response (see packages/config/src/sanitize.ts),
// so this shape only ever carries the non-secret fields. Secrets are edited
// write-only via McpSection's mcpSecretEdits, mirroring apiKeyEdits.
export type ConfigMcpServer =
  | { transport: "stdio"; command?: string; args?: string[] }
  | { transport: "http"; url?: string };

export type ConfigShape = {
  agents?: ConfigAgent[];
  defaultAgent?: string;
  language?: string;
  harness?: { policy?: string; pinnedId?: string };
  channels?: Record<string, { enabled?: boolean }>;
  providers?: Record<string, ConfigProvider>;
  mcpServers?: Record<string, ConfigMcpServer>;
};

export type McpServerStatus = {
  id: string;
  connected: boolean;
  toolCount: number;
  tools: string[];
  error?: string;
};

export type ConfigGetResult = {
  config: ConfigShape;
  workspaceRoot: string | null;
  configPath: string | null;
};

export type ConfigPatchResult = {
  ok: true;
  path: string;
  requiresRestart: boolean;
  config: ConfigShape;
};

export type FsEntry = { name: string; type: "directory" | "file" | "other" };

export type FsListResult = { path: string; entries: FsEntry[]; truncated?: boolean };

export type FsReadResult = { path: string; content: string; truncated: boolean; totalLength?: number };

/** LLM-context-appropriate plain text (PDF text-extracted, everything else same as fs.read) — see ChatView.tsx's resolveAttachments. */
export type FsReadDocumentTextResult = { path: string; content: string; truncated: boolean; totalLength?: number };

export type FsReadBinaryResult = { path: string; base64: string; truncated: boolean; totalBytes: number };

export type FsSearchEntry = { relativePath: string; type: "file" | "directory" };

export type FsSearchResult = { entries: FsSearchEntry[] };

export type FsWriteParams = { relativePath: string; content: string };

export type FsMkdirParams = { relativePath: string };

export type FsRenameParams = { fromRelativePath: string; toRelativePath: string };

export type FsDeleteParams = { relativePath: string };

export type FsMutationResult = { ok: true; path: string };

// Mirrors gateway/src/methods.ts's git.status/git.diff result shapes.
export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "unmerged";
export type GitFileEntry = { path: string; status: GitFileStatus };
export type GitStatusResult = { isRepo: boolean; branch?: string; files: GitFileEntry[] };
export type GitDiffResult = { diff: string };

// Main-process whisper concepts (packages/app-desktop/src/main/whisper.ts,
// whisperSettings.ts) — mirrored here structurally, same convention as
// ProjectRecord/PaneNode above (main and renderer keep separate copies
// rather than importing across the Electron process boundary).
export type WhisperModelName = "tiny.en" | "tiny" | "base.en" | "base" | "small.en" | "small" | "medium.en" | "medium";

export type WhisperBackend = "cpu" | "gpu";

export type WhisperSettings = {
  binaryPath: string;
  modelsDir: string;
  model: string;
  language: string;
  backend: WhisperBackend;
};

// Mirrors main/whisperSettings.ts's STT cloud dispatcher.
export type SttCloudProvider = "openai" | "custom";

export type SttCloudSettings = {
  provider: SttCloudProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type SttSource = "local" | "cloud";

export type SttSettings = {
  source: SttSource;
  cloud: SttCloudSettings;
};

// Mirrors main/ttsSettings.ts — same "main and renderer keep separate
// copies" convention as WhisperSettings/SttSettings above.
export type TtsSettings = {
  enabled: boolean;
  voiceId: string;
  apiToken: string;
};

// Mirrors main/roles.ts's CustomRole — same "main and renderer keep separate
// copies" convention as WhisperSettings/SttSettings above.
export type CustomRole = {
  id: string;
  label: string;
  summary?: string;
  systemPrompt: string;
};

// Mirrors main/flowTemplates.ts's CustomFlowTemplate — same shape as
// CustomRole above by coincidence, different audience (AgentTemplatePicker's
// team-node initial prompt, not AgentManager's standalone systemPrompt);
// kept as a separate type/store, never merged with CustomRole.
export type CustomFlowTemplate = {
  id: string;
  label: string;
  summary?: string;
  prompt: string;
};

// Mirrors main/ideSettings.ts — same "main and renderer keep separate
// copies" convention as WhisperSettings/SttSettings above.
export type IdeCatalogEntry = { id: string; label: string };

// Mirrors main/skills.ts.
export type SkillInfo = {
  name: string;
  description: string;
  scope: "project" | "user" | "plugin";
  /** Plugin id (`name@marketplace`) for scope "plugin". */
  plugin?: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
};

export type DetectedIde = {
  id: string;
  label: string;
  installed: boolean;
  launchKind?: "cli" | "app";
  launchPath?: string;
};

export type IdeSettings = {
  configuredId: string | null;
  customLabel?: string;
  customPath?: string;
  blenderPath?: string;
};

export type OpenIdeResult = { opened: boolean; error?: string };

// Mirrors main/automation/types.ts / main/automationSettings.ts — same
// "main and renderer keep separate copies" convention as above.
export type PermissionState = "granted" | "denied" | "not-determined" | "restricted" | "unsupported";
export type DesktopPermissions = { screen: PermissionState; accessibility: PermissionState };
export type PermissionKind = "screen" | "accessibility";
export type AutomationSettings = { paused: boolean };

// Mirrors main/syncSettings.ts / main/sharedResources.ts / main/syncEngine.ts
// — same "main and renderer keep separate copies" convention as above.
export type SyncSettings = { serverUrl?: string; ownerApiKey?: string; ownerName?: string };

export type SharedResourceType = "plugin-storage-key" | "notes-file";
export type SharedResourceRole = "edit" | "view";

export type ResourceRef =
  | { resourceType: "notes-file"; projectId: string; relativePath: string }
  | { resourceType: "plugin-storage-key"; projectId: string; scope: PluginScope; pluginId: string; storageKey: string };

export type ResourceStatus =
  | { shared: false }
  | { shared: true; shareId: string; role: SharedResourceRole; localVersion: number; conflict: boolean; isOwner: boolean };

/** One person with access to a share — `kind: "web"` is a browser link (gated by `email`), `"app"` redeemed an invite code in the desktop app. */
export type ShareMember = {
  keyHash: string;
  name: string;
  email: string | null;
  role: SharedResourceRole;
  kind: "app" | "web";
  invitedAt: number;
};

export type PushResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; currentVersion: number }
  | { ok: false; error: string };

export type PullResult = { ok: true } | { ok: false; error: string };

export type MyShareSummary = {
  id: string;
  resourceType: SharedResourceType;
  resourceKey: string;
  role: SharedResourceRole;
  version: number;
  memberCount: number;
};

// Mirrors context-memory-db's IndexProgress — payload of the
// "project_index.progress" gateway event (see gateway/src/server.ts),
// consumed by SessionSidebar.tsx's "Indx" button progress bar.
export type IndexProgress = { processed: number; total: number };

export type Attachment = { relativePath: string; type: "file" | "directory" };

// Electron main-process concept (packages/app-desktop/src/main/projects.ts),
// not a gateway RPC shape — mirrored here for the renderer/preload side.
export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastOpenedAt: number;
  color: string | null;
};

// Electron main-process concept (packages/app-desktop/src/main/terminalLayout.ts),
// mirrored here structurally (not imported — main/renderer types are kept as
// separate copies throughout this app, see ProjectRecord above). Layout only:
// which panes exist, their split-tree shape/sizes, title, and creation-time
// cwd — never a live pty handle.
export type PaneNode =
  | {
      type: "leaf";
      id: string;
      title: string;
      cwd: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      yggdrasilAgentId?: string;
      flowNodeId?: string;
      /** yggdrasilAgentId only — join this exact session instead of a fresh TUI one (Agent Flow "Run Flow"). */
      sessionKey?: string;
      /** yggdrasilAgentId only — the autonomous run owns this session; the pane is view-only. */
      readOnly?: boolean;
      /** Set for a pane an agent spawned via the create_pane MCP tool (paneControlServer.ts) — its pty is already live, so TerminalPane must attach to it instead of calling terminals.create(). */
      attach?: boolean;
      /**
       * "Type this and press enter" for the *next* real spawn only — never
       * baked into `args` (see buildLaunchCommand.ts) so that paneTree.ts's
       * HYDRATE case can strip it on a plain app-restart respawn without
       * also losing `args`' other (persistent) flags like
       * --append-system-prompt.
       */
      initialPrompt?: string;
      /** How to pass initialPrompt to this harness's CLI — undefined means a bare positional, e.g. "-i" for antigravity. See buildLaunchCommand.ts. */
      initialPromptFlag?: string;
      /** Free-form position for Terminal Canvas mode (TerminalNavbar's "Canvas" toggle) — undefined until dragged at least once; TerminalCanvasView computes a cascade default when absent. */
      canvasPosition?: { x: number; y: number };
    }
  | { type: "split"; id: string; direction: "row" | "column"; sizes: number[]; children: PaneNode[] };

export type TerminalLayout = {
  root: PaneNode | null;
  activePaneId: string | null;
  /** "grid" (default) or "canvas" — persisted so reopening a project remembers which view the Terminal tab was left in. Absent means "grid". */
  viewMode?: "grid" | "canvas";
};

// Electron main-process concept (packages/app-desktop/src/main/documentTabs.ts),
// mirrored here structurally, same convention as TerminalLayout above. Which
// notes/ files are open as tabs in the Documents view, and which is active —
// content itself is never persisted here, always re-read via fs.read.
export type DocumentTabsLayout = { openPaths: string[]; activePath: string | null };

// Electron main-process concept (packages/app-desktop/src/main/plugins.ts) —
// a "complemento": a folder with manifest.json + HTML/JS/CSS, loaded in a
// sandboxed iframe via the ygg-plugin:// protocol (see PluginFrame.tsx).
// Mirrored here structurally, same convention as ProjectRecord/PaneNode above.
export type PluginView = "tab" | "panel" | "mobile";
export type PluginPermission = "fs" | "fs:write" | "panes" | string;
/** Absent = "published" — see main/plugins.ts's PluginStatus doc comment. */
export type PluginStatus = "draft" | "published";
/** A named, described, JSON-Schema-typed function the plugin registers a handler for (ygg.tools.register) — callable from a claude/agy terminal session, see main/pluginsControlMcpShim.ts. */
export type PluginToolDef = { name: string; description: string; inputSchema?: Record<string, unknown> };
export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  icon?: string;
  entry?: string;
  views: PluginView[];
  defaultView?: PluginView;
  permissions?: PluginPermission[];
  minHeight?: number;
  status?: PluginStatus;
  tools?: PluginToolDef[];
};
export type PluginScope = "global" | "project";
export type PluginRecord = {
  key: string;
  scope: PluginScope;
  manifest: PluginManifest;
  dir: string;
  url: string;
  error?: string;
};

// Electron main-process concept (packages/app-desktop/src/main/plugins.ts's
// scaffoldPlugin) — mirrored here structurally so Studio's create form can
// build one to pass to window.yggdrasil.plugins.scaffold.
export type ScaffoldPluginSpec = {
  id: string;
  name: string;
  icon?: string;
  scope?: PluginScope;
  views?: PluginView[];
  defaultView?: PluginView;
  permissions?: PluginPermission[];
  description?: string;
  status?: PluginStatus;
};

// Electron main-process concept (packages/app-desktop/src/main/paneControlServer.ts)
// — mirrored here structurally, same convention as ProjectRecord/PaneNode
// above. Exposed to a "panes"-permission plugin via ygg.panes.* (pluginHost.ts).
export type PaneSummary = { id: string; title: string; cwd: string; createdAt: number; sessionKey?: string; command?: string };
export type CreatePaneSpec = {
  cwd?: string;
  title?: string;
  command?: string;
  args?: string[];
  purpose?: string;
  sourcePaneId?: string;
};

// Electron main-process concept (packages/app-desktop/src/main/pluginTabs.ts),
// mirrored here structurally, same convention as DocumentTabsLayout above.
// Which complemento pestañas (PluginRecord.key values) were open, per project.
export type PluginTabsLayout = { openKeys: string[] };

// Electron main-process concept (packages/app-desktop/src/main/fileImport.ts),
// mirrored here structurally.
export type ImportFilesResult = { imported: string[]; errors: string[] };

// Electron main-process concept (packages/app-desktop/src/main/agentFlow.ts),
// mirrored here structurally, same convention as ProjectRecord/PaneNode above.
export type AgentFlowHarness =
  | { type: "yggdrasil"; agentId: string }
  | {
      type: "claude";
      systemPromptAppend?: string;
      model?: string;
      effort?: "low" | "medium" | "high" | "xhigh" | "max";
      addDirs?: string[];
      initialPrompt?: string;
      cloud?: boolean;
    }
  | {
      type: "antigravity";
      initialPrompt?: string;
      model?: string;
      effort?: "low" | "medium" | "high";
      mode?: "accept-edits" | "plan";
      addDirs?: string[];
    }
  | {
      type: "omp";
      systemPromptAppend?: string;
      model?: string;
      thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "auto";
      approvalMode?: "always-ask" | "write" | "yolo";
      addDirs?: string[];
      initialPrompt?: string;
    }
  | {
      type: "copilot";
      model?: string;
      addDirs?: string[];
      allowAllTools?: boolean;
      initialPrompt?: string;
    };

export type AgentFlowNode = {
  id: string;
  name: string;
  position: { x: number; y: number };
  harness: AgentFlowHarness;
  communication?: string;
};

// Electron main-process concept (packages/app-desktop/src/main/agentTeams.ts),
// mirrored here structurally. A named, saved snapshot of AgentFlowNodes.
// `edges` is populated only for auto-captured orchestrator/worker
// relationships (create_pane's sourcePaneId) — a lighter shape than
// AgentFlowEdge (no id/label), not the canvas's supervisor concept.
export type AgentTeamEdge = { from: string; to: string };
export type AgentTeam = { id: string; name: string; nodes: AgentFlowNode[]; edges?: AgentTeamEdge[] };

export type AgentFlowEdge = { id: string; from: string; to: string; label?: string };

// Electron main-process concept (paneControlServer.ts's create_pane handler)
// — fired whenever an agent spawns another via create_pane with a stated
// `purpose`, so the AgentFlowView canvas (if mounted) can drop the new node
// + edge on live instead of only being visible after reopening the
// auto-captured Team it was also persisted into (agentTeams.ts).
export type AgentFlowAutoCapturePayload = {
  node: { id: string; name: string; initialPrompt: string };
  source?: { id: string; name: string };
};

// Electron main-process concept (paneControlServer.ts's write_pane handler)
// — fired on every write_pane call that carries a resolved sourcePaneId, so
// AgentFlowCanvas can briefly pulse the edge between the two nodes involved
// (if one exists) as a live "who's talking to whom" signal. `from`/`to` are
// already resolved to stable flowNodeIds, matching AgentFlowEdge.from/.to.
export type AgentFlowCommunicationPayload = { from: string; to: string };

// Electron main-process concept (main/browserTabView.ts) — mirrors that
// module's own BrowserTabBounds/BrowserTabHandle shape (same "main and
// renderer keep separate copies" convention as WhisperSettings etc.). A
// WebContentsView is a native layer Electron composites into the window,
// not a DOM node, so BrowserTabView.tsx's placeholder div reports its own
// real screen rect here instead of any CSS being able to size the actual
// content.
export type BrowserTabBounds = { x: number; y: number; width: number; height: number };

// Mirrors main/browserTabView.ts's own PickedElement — the shape a
// browserTab:startPick call resolves with (browserTabPickerPreload.ts is the
// one that actually builds it, inside the loaded page).
export type PickedElement = {
  tag: string;
  id?: string;
  classes?: string;
  selector: string;
  text: string;
  outerHtml: string;
  rect: { x: number; y: number; width: number; height: number };
  pageUrl: string;
  pageTitle: string;
};

export type AgentFlowSupervisor = {
  type: "human" | "yggdrasil" | "claude" | "antigravity" | "omp" | "copilot";
  agentId?: string;
  systemPromptAppend?: string;
  initialPrompt?: string;
  note?: string;
};

export type AgentFlow = {
  version: 1;
  name: string;
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
  supervisor: AgentFlowSupervisor;
  updatedAt: number;
};

/** Settings → Teléfono (main/phoneLink.ts): this desktop as published to the Railway hub. Never carries the hub key. */
export type PhoneLinkInfo = {
  hubUrl: string;
  hasHubKey: boolean;
  publish: boolean;
  desktopName: string;
  addresses: { lan?: string; tailscale?: string };
  status: { state: "disabled" | "ok" | "error" | "idle"; lastOkAt?: number; lastAttemptAt?: number; lastError?: string };
  tunnel: { state: "disabled" | "connecting" | "connected" | "error"; lastError?: string };
  /** Open projects left out of the hub because they were opened before publishing. */
  needsReopen: string[];
};
