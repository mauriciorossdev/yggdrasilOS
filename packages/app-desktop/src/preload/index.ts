import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import { release } from "node:os";
import type {
  AgentFlow,
  AgentFlowAutoCapturePayload,
  AgentFlowCommunicationPayload,
  AgentTeam,
  AutomationSettings,
  BrowserTabBounds,
  BrowserDownload,
  BrowserTabState,
  CustomFlowTemplate,
  CustomRole,
  DesktopPermissions,
  DetectedCli,
  DetectedIde,
  DocumentTabsLayout,
  IdeCatalogEntry,
  IdeSettings,
  OllamaStatus,
  OnboardingSettings,
  OnboardingState,
  MyShareSummary,
  PickedElement,
  PullResult,
  PushResult,
  ResourceRef,
  ResourceStatus,
  ShareMember,
  SkillInfo,
  SharedResourceRole,
  CreatePaneSpec,
  ImportFilesResult,
  OpenIdeResult,
  PaneSummary,
  PermissionKind,
  PluginRecord,
  PluginScope,
  PluginStatus,
  ScaffoldPluginSpec,
  PluginTabsLayout,
  ProjectRecord,
  RateLimitsPayload,
  SttCloudSettings,
  SttSettings,
  SyncSettings,
  TerminalLayout,
  TtsSettings,
  WhisperBackend,
  WhisperModelName,
  WhisperSettings,
  PhoneLinkInfo,
} from "../renderer/src/types.js";

function readArg(flag: string): string | null {
  const prefix = `${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

/**
 * Windows build number (e.g. 19045), used to tell xterm.js which ConPTY
 * quirks to work around (see TerminalPane.tsx's windowsPty option) — without
 * it, ConPTY's line-wrap padding makes redrawing TUIs (Ink-based CLIs like
 * `claude`) drop/misplace characters, spaces included. Undefined off Windows.
 */
function windowsBuildNumber(): number | undefined {
  if (process.platform !== "win32") return undefined;
  const parts = release().split(".");
  const build = parts.length === 3 ? parseInt(parts[2]!, 10) : NaN;
  return Number.isNaN(build) ? undefined : build;
}

type ThemeSettings = {
  presetId: string;
  overrides: Partial<Record<"bg" | "surface" | "text" | "accent", string>>;
};

function readThemeArg(): ThemeSettings {
  try {
    const raw = readArg("--ygg-theme");
    if (raw) return JSON.parse(raw) as ThemeSettings;
  } catch {
    // fall through to the default
  }
  return { presetId: "warm-dark", overrides: {} };
}

const api = {
  /** Set only for project windows (via additionalArguments at window creation). Null in the launcher window. */
  projectId: readArg("--ygg-project-id"),
  platform: process.platform,
  windowsBuildNumber: windowsBuildNumber(),
  /** This window's dedicated gateway WebSocket URL. Null in the launcher window (which has no gateway). */
  gatewayUrl: readArg("--ygg-gateway-url"),
  /** Same gateway, but with this machine's LAN address instead of loopback — for showing the human what to type into a phone (SettingsView). Never use this for the renderer's own connection. */
  gatewayLanUrl: readArg("--ygg-gateway-lan-url"),
  /** Set only for project windows — TitleBar.tsx's display label. */
  projectName: readArg("--ygg-project-name"),
  /** Set only for project windows — TitleBar.tsx's border color, empty string means unset. */
  projectColor: readArg("--ygg-project-color") || null,
  /** True only for the "Default Workspace" window — the hub with a Projects section. Other project windows are scoped to just that project. */
  isDefaultProject: readArg("--ygg-is-default") === "1",
  /** The "Default Workspace" project's id (empty string = unknown) — lets any window's project list know which entry can't be removed/purged. */
  defaultProjectId: readArg("--ygg-default-project-id") || null,
  theme: {
    /** The user's theme as of this window's creation (main passes it as an argument so the first paint is already themed). */
    initial: readThemeArg(),
    get: (): Promise<ThemeSettings> => ipcRenderer.invoke("theme:get"),
    set: (settings: ThemeSettings): Promise<ThemeSettings> => ipcRenderer.invoke("theme:set", settings),
    reset: (): Promise<ThemeSettings> => ipcRenderer.invoke("theme:reset"),
    /** Fires in every window when any window changes the theme. */
    onChange: (handler: (settings: ThemeSettings) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: ThemeSettings) => handler(payload);
      ipcRenderer.on("theme:changed", listener);
      return () => ipcRenderer.removeListener("theme:changed", listener);
    },
  },
  workspace: {
    view: (): Promise<unknown> => ipcRenderer.invoke("workspace:view", readArg("--ygg-project-id")),
    setLink: (targetId: string, linked: boolean): Promise<void> =>
      ipcRenderer.invoke("workspace:setLink", readArg("--ygg-project-id"), targetId, linked),
    revokeTrust: (key: string): Promise<void> => ipcRenderer.invoke("workspace:revokeTrust", key),
    answer: (id: string, answer: { allow: boolean; trust: boolean }): Promise<void> =>
      ipcRenderer.invoke("workspace:answer", id, answer),
    /** An agent in this project wants to read/write another project's pane and needs the human's OK. */
    onAsk: (handler: (ask: unknown) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) => handler(payload);
      ipcRenderer.on("workspace:ask", listener);
      return () => ipcRenderer.removeListener("workspace:ask", listener);
    },
    /** The prompt timed out in main — drop it from the screen. */
    onAskClosed: (handler: (payload: { id: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { id: string }) => handler(payload);
      ipcRenderer.on("workspace:askClosed", listener);
      return () => ipcRenderer.removeListener("workspace:askClosed", listener);
    },
    /** Something from another project reached a pane here without a prompt (a remembered trust). */
    onNotice: (handler: (notice: unknown) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: unknown) => handler(payload);
      ipcRenderer.on("workspace:notice", listener);
      return () => ipcRenderer.removeListener("workspace:notice", listener);
    },
  },
  projects: {
    list: (): Promise<ProjectRecord[]> => ipcRenderer.invoke("projects:list"),
    openExisting: (): Promise<ProjectRecord | null> => ipcRenderer.invoke("projects:openExisting"),
    createNew: (): Promise<ProjectRecord | null> => ipcRenderer.invoke("projects:createNew"),
    open: (id: string): Promise<boolean> => ipcRenderer.invoke("projects:open", id),
    openHome: (): Promise<boolean> => ipcRenderer.invoke("projects:openHome"),
    rename: (id: string, name: string): Promise<ProjectRecord | undefined> =>
      ipcRenderer.invoke("projects:rename", id, name),
    setColor: (id: string, color: string | null): Promise<ProjectRecord | undefined> =>
      ipcRenderer.invoke("projects:setColor", id, color),
    /** Opens the project's folder in the OS file explorer (Explorer/Finder). */
    reveal: (id: string): Promise<OpenIdeResult> => ipcRenderer.invoke("projects:reveal", id),
    /** Same `opened: false` fallback semantics as ide.openProject, but for any listed project. */
    openInIde: (id: string): Promise<OpenIdeResult> => ipcRenderer.invoke("projects:openInIde", id),
    /** Duplicates the project folder to a user-picked location and opens the copy. null = dialog cancelled. */
    clone: (id: string): Promise<ProjectRecord | null> => ipcRenderer.invoke("projects:clone", id),
    /** Removes from the list only; the folder stays on disk. */
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke("projects:remove", id),
    /** Removes from the list AND deletes the folder from disk. */
    purge: (id: string): Promise<boolean> => ipcRenderer.invoke("projects:purge", id),
    /** Fires for every project in every window (main/index.ts broadcasts to all
     * BrowserWindows) — the Default Workspace sidebar list and each project's
     * own TitleBar both need this live, not just the window that made the change. */
    onColorChange: (handler: (id: string, color: string | null) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { id: string; color: string | null }) =>
        handler(payload.id, payload.color);
      ipcRenderer.on("project:colorChange", listener);
      return () => ipcRenderer.removeListener("project:colorChange", listener);
    },
  },
  terminals: {
    create: (params: {
      id: string;
      cwd: string;
      cols: number;
      rows: number;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      yggdrasilAgentId?: string;
      sessionKey?: string;
      readOnly?: boolean;
      flowNodeId?: string;
      initialPrompt?: string;
      initialPromptFlag?: string;
    }): Promise<void> => ipcRenderer.invoke("terminal:create", { ...params, projectId: readArg("--ygg-project-id") }),
    write: (id: string, data: string): Promise<void> => ipcRenderer.invoke("terminal:write", id, data),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke("terminal:resize", id, cols, rows),
    dispose: (id: string): Promise<void> => ipcRenderer.invoke("terminal:dispose", id),
    read: (id: string, maxChars?: number): Promise<string | undefined> =>
      ipcRenderer.invoke("terminal:read", id, maxChars),
    getLayout: (): Promise<TerminalLayout> => ipcRenderer.invoke("terminal:getLayout", readArg("--ygg-project-id")),
    saveLayout: (layout: TerminalLayout): Promise<void> =>
      ipcRenderer.invoke("terminal:saveLayout", readArg("--ygg-project-id"), layout),
    onData: (handler: (id: string, chunk: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { id: string; chunk: string }) =>
        handler(payload.id, payload.chunk);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (handler: (id: string, exitCode: number | null) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { id: string; exitCode: number | null }) =>
        handler(payload.id, payload.exitCode);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
    /** write_pane handed a pane a feature doc (specPath) — project-relative path, e.g. notes/features/x.md. */
    onSpec: (handler: (paneId: string, specPath: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { paneId: string; specPath: string }) =>
        handler(payload.paneId, payload.specPath);
      ipcRenderer.on("pane:spec", listener);
      return () => ipcRenderer.removeListener("pane:spec", listener);
    },
    /** An agent pane (paneControlServer.ts's create_pane MCP tool) spawned a pty and wants it drawn in this window's grid. */
    onPaneCreated: (
      handler: (pane: {
        id: string;
        title: string;
        cwd: string;
        command?: string;
        args?: string[];
        sourcePaneId?: string;
      }) => void,
    ): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { id: string; title: string; cwd: string; command?: string; args?: string[]; sourcePaneId?: string },
      ) => handler(payload);
      ipcRenderer.on("pane:created", listener);
      return () => ipcRenderer.removeListener("pane:created", listener);
    },
    /** An agent asked (show_pane) for a live pane to be drawn or brought to front. */
    onPaneShow: (handler: (pane: { id: string; title: string; cwd: string; command?: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { id: string; title: string; cwd: string; command?: string }) =>
        handler(payload);
      ipcRenderer.on("pane:show", listener);
      return () => ipcRenderer.removeListener("pane:show", listener);
    },
    /** A mobile client just expanded (active: true) or gave up (active: false) this pane's real pty width — see main/paneControlServer.ts's POST /panes/:id/expand|restore. */
    onMobileFocus: (handler: (id: string, active: boolean) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { id: string; active: boolean }) =>
        handler(payload.id, payload.active);
      ipcRenderer.on("pane:mobileFocus", listener);
      return () => ipcRenderer.removeListener("pane:mobileFocus", listener);
    },
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke("window:toggleMaximize"),
    close: (): Promise<void> => ipcRenderer.invoke("window:close"),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
    onMaximizedChange: (handler: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, maximized: boolean) => handler(maximized);
      ipcRenderer.on("window:maximizedChange", listener);
      return () => ipcRenderer.removeListener("window:maximizedChange", listener);
    },
  },
  connectors: {
    /** The yggdrasil://oauth/... redirect landed (main/index.ts's open-url/second-instance handling) — forward {code, state} to whichever gateway RPC (connectors.google.completeAuth) is actually waiting on it. */
    onOAuthCallback: (handler: (payload: { code: string; state: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { code: string; state: string }) => handler(payload);
      ipcRenderer.on("connectors:oauthCallback", listener);
      return () => ipcRenderer.removeListener("connectors:oauthCallback", listener);
    },
  },
  statusline: {
    /** Last rate-limit sample this project's paneControlServer has seen so far, if any — see main/index.ts's "statusline:get" handler. */
    get: (): Promise<RateLimitsPayload | undefined> =>
      ipcRenderer.invoke("statusline:get", readArg("--ygg-project-id")),
    onUpdate: (handler: (payload: RateLimitsPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: RateLimitsPayload) => handler(payload);
      ipcRenderer.on("statusline:update", listener);
      return () => ipcRenderer.removeListener("statusline:update", listener);
    },
  },
  scripts: {
    /** Opens a new native OS terminal window running `<packageManager> run <scriptName>` in `cwd` — see main/scriptRunner.ts. */
    runInTerminal: (params: { cwd: string; packageManager: string; scriptName: string }): Promise<void> =>
      ipcRenderer.invoke("scripts:runInTerminal", params),
  },
  agentFlow: {
    get: (): Promise<AgentFlow | null> => ipcRenderer.invoke("agentFlow:get", readArg("--ygg-project-id")),
    save: (flow: AgentFlow): Promise<void> =>
      ipcRenderer.invoke("agentFlow:save", readArg("--ygg-project-id"), flow),
    /** create_pane spawned a new agent with a stated role/purpose — see paneControlServer.ts. */
    onAutoCapture: (handler: (payload: AgentFlowAutoCapturePayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: AgentFlowAutoCapturePayload) => handler(payload);
      ipcRenderer.on("agentFlow:autoCapture", listener);
      return () => ipcRenderer.removeListener("agentFlow:autoCapture", listener);
    },
    /** write_pane fired between two panes with resolved node ids — see paneControlServer.ts. */
    onCommunication: (handler: (payload: AgentFlowCommunicationPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: AgentFlowCommunicationPayload) => handler(payload);
      ipcRenderer.on("agentFlow:communication", listener);
      return () => ipcRenderer.removeListener("agentFlow:communication", listener);
    },
  },
  browserTab: {
    navigate: (url: string): Promise<void> => ipcRenderer.invoke("browserTab:navigate", readArg("--ygg-project-id"), url),
    /** Address-bar navigation: a URL/host navigates, anything else becomes a web search. */
    go: (input: string): Promise<void> => ipcRenderer.invoke("browserTab:go", readArg("--ygg-project-id"), input),
    /** Opens a new browser tab (and navigates it when `input` is given). Resolves with its id. */
    newTab: (input?: string): Promise<string | null> =>
      ipcRenderer.invoke("browserTab:newTab", readArg("--ygg-project-id"), input),
    closeTab: (id: string): Promise<void> => ipcRenderer.invoke("browserTab:closeTab", readArg("--ygg-project-id"), id),
    activateTab: (id: string): Promise<void> =>
      ipcRenderer.invoke("browserTab:activateTab", readArg("--ygg-project-id"), id),
    toggleDevTools: (): Promise<void> => ipcRenderer.invoke("browserTab:toggleDevTools", readArg("--ygg-project-id")),
    zoom: (direction: "in" | "out" | "reset"): Promise<void> =>
      ipcRenderer.invoke("browserTab:zoom", readArg("--ygg-project-id"), direction),
    showDownload: (path: string): Promise<void> =>
      ipcRenderer.invoke("browserTab:showDownload", readArg("--ygg-project-id"), path),
    /** Common dev-server ports currently listening on this machine. */
    scanPorts: (): Promise<number[]> => ipcRenderer.invoke("browserTab:scanPorts"),
    /** Ctrl+L / Ctrl+T: main wants the address bar focused. */
    onFocusAddress: (handler: () => void): (() => void) => {
      const listener = () => handler();
      ipcRenderer.on("browserTab:focusAddress", listener);
      return () => ipcRenderer.removeListener("browserTab:focusAddress", listener);
    },
    onDownload: (handler: (download: BrowserDownload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, download: BrowserDownload) => handler(download);
      ipcRenderer.on("browserTab:download", listener);
      return () => ipcRenderer.removeListener("browserTab:download", listener);
    },
    back: (): Promise<void> => ipcRenderer.invoke("browserTab:back", readArg("--ygg-project-id")),
    forward: (): Promise<void> => ipcRenderer.invoke("browserTab:forward", readArg("--ygg-project-id")),
    reload: (): Promise<void> => ipcRenderer.invoke("browserTab:reload", readArg("--ygg-project-id")),
    stop: (): Promise<void> => ipcRenderer.invoke("browserTab:stop", readArg("--ygg-project-id")),
    getState: (): Promise<BrowserTabState | null> =>
      ipcRenderer.invoke("browserTab:getState", readArg("--ygg-project-id")),
    onState: (handler: (state: BrowserTabState) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, state: BrowserTabState) => handler(state);
      ipcRenderer.on("browserTab:state", listener);
      return () => ipcRenderer.removeListener("browserTab:state", listener);
    },
    setBounds: (bounds: BrowserTabBounds): Promise<void> =>
      ipcRenderer.invoke("browserTab:setBounds", readArg("--ygg-project-id"), bounds),
    show: (): Promise<void> => ipcRenderer.invoke("browserTab:show", readArg("--ygg-project-id")),
    hide: (): Promise<void> => ipcRenderer.invoke("browserTab:hide", readArg("--ygg-project-id")),
    getUrl: (): Promise<string> => ipcRenderer.invoke("browserTab:getUrl", readArg("--ygg-project-id")),
    startPick: (timeoutMs?: number): Promise<PickedElement | null> =>
      ipcRenderer.invoke("browserTab:startPick", readArg("--ygg-project-id"), timeoutMs),
    /** browser_open (an agent) navigated and wants the user looking at it too — see paneControlServer.ts. */
    onRequestShow: (handler: () => void): (() => void) => {
      const listener = () => handler();
      ipcRenderer.on("browserTab:requestShow", listener);
      return () => ipcRenderer.removeListener("browserTab:requestShow", listener);
    },
  },
  agentTeams: {
    list: (): Promise<AgentTeam[]> => ipcRenderer.invoke("agentTeams:list", readArg("--ygg-project-id")),
    save: (team: AgentTeam): Promise<AgentTeam[]> =>
      ipcRenderer.invoke("agentTeams:save", readArg("--ygg-project-id"), team),
    delete: (id: string): Promise<AgentTeam[]> =>
      ipcRenderer.invoke("agentTeams:delete", readArg("--ygg-project-id"), id),
    rename: (id: string, name: string): Promise<AgentTeam[]> =>
      ipcRenderer.invoke("agentTeams:rename", readArg("--ygg-project-id"), id, name),
  },
  documents: {
    getLayout: (): Promise<DocumentTabsLayout> =>
      ipcRenderer.invoke("documents:getLayout", readArg("--ygg-project-id")),
    saveLayout: (layout: DocumentTabsLayout): Promise<void> =>
      ipcRenderer.invoke("documents:saveLayout", readArg("--ygg-project-id"), layout),
  },
  plugins: {
    list: (): Promise<PluginRecord[]> => ipcRenderer.invoke("plugins:list", readArg("--ygg-project-id")),
    reload: (): Promise<PluginRecord[]> => ipcRenderer.invoke("plugins:reload", readArg("--ygg-project-id")),
    storageGet: (scope: PluginScope, id: string, key: string): Promise<unknown> =>
      ipcRenderer.invoke("plugins:storageGet", readArg("--ygg-project-id"), scope, id, key),
    storageSet: (scope: PluginScope, id: string, key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke("plugins:storageSet", readArg("--ygg-project-id"), scope, id, key, value),
    storageDelete: (scope: PluginScope, id: string, key: string): Promise<void> =>
      ipcRenderer.invoke("plugins:storageDelete", readArg("--ygg-project-id"), scope, id, key),
    storageKeys: (scope: PluginScope, id: string): Promise<string[]> =>
      ipcRenderer.invoke("plugins:storageKeys", readArg("--ygg-project-id"), scope, id),
    /** ygg.fs.write/mkdir (a "fs:write"-permission plugin) — see main/index.ts's plugins:fsWrite handler for why this bypasses the gateway's own fs.write RPC (its approval-gate) rather than routing through it. */
    fsWrite: (relativePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke("plugins:fsWrite", readArg("--ygg-project-id"), relativePath, content),
    fsMkdir: (relativePath: string): Promise<void> =>
      ipcRenderer.invoke("plugins:fsMkdir", readArg("--ygg-project-id"), relativePath),
    /** A plugin was added/edited/removed (this window's own project dir, the shared global dir, or a manual "Recargar") — see plugins.ts's watchPluginsDir. */
    onChanged: (handler: (payload: { scope: PluginScope | "all"; pluginId?: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { scope: PluginScope | "all"; pluginId?: string }) =>
        handler(payload);
      ipcRenderer.on("plugins:changed", listener);
      return () => ipcRenderer.removeListener("plugins:changed", listener);
    },
    /** The plugins MCP tool's open_plugin call (paneControlServer.ts's POST /plugins/:scope/:id/open) — this window should open (and switch the user to) that complemento. */
    onOpenRequest: (handler: (payload: { key: string; view?: "tab" | "panel" }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { key: string; view?: "tab" | "panel" }) => handler(payload);
      ipcRenderer.on("plugins:openRequest", listener);
      return () => ipcRenderer.removeListener("plugins:openRequest", listener);
    },
    /** Which complemento pestañas were open last session — see main/pluginTabs.ts. */
    getLayout: (): Promise<PluginTabsLayout> => ipcRenderer.invoke("plugins:getLayout", readArg("--ygg-project-id")),
    saveLayout: (layout: PluginTabsLayout): Promise<void> =>
      ipcRenderer.invoke("plugins:saveLayout", readArg("--ygg-project-id"), layout),
    /** PluginsSection's "Mostrar carpeta" context menu action. */
    reveal: (dir: string): Promise<void> => ipcRenderer.invoke("plugins:reveal", dir),
    /** Studio's "+ Nuevo" — direct scaffold, no HTTP/MCP hop. Defaults to status:"draft" on the main side. */
    scaffold: (spec: ScaffoldPluginSpec): Promise<PluginRecord> =>
      ipcRenderer.invoke("plugins:scaffold", readArg("--ygg-project-id"), spec),
    setStatus: (scope: PluginScope, id: string, status: PluginStatus): Promise<PluginRecord> =>
      ipcRenderer.invoke("plugins:setStatus", readArg("--ygg-project-id"), scope, id, status),
    delete: (scope: PluginScope, id: string): Promise<void> =>
      ipcRenderer.invoke("plugins:delete", readArg("--ygg-project-id"), scope, id),
    /** A claude/agy terminal session called one of this plugin's declared tools (via the plugins MCP tool → paneControlServer.ts) — PluginToolRuntime.tsx answers by calling the matching headless PluginFrame's callTool() and replying with toolCallResult. */
    onToolCallRequest: (
      handler: (payload: { callId: string; scope: PluginScope; id: string; tool: string; params: unknown }) => void,
    ): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { callId: string; scope: PluginScope; id: string; tool: string; params: unknown },
      ) => handler(payload);
      ipcRenderer.on("plugins:toolCallRequest", listener);
      return () => ipcRenderer.removeListener("plugins:toolCallRequest", listener);
    },
    toolCallResult: (callId: string, ok: boolean, resultOrError: unknown): Promise<void> =>
      ipcRenderer.invoke("plugins:toolCallResult", callId, ok, resultOrError),
  },
  /** ygg.panes.* (a "panes"-permission plugin, pluginHost.ts) — same underlying create/write/list as the panes MCP tool (paneControlServer.ts), called directly instead of over its loopback HTTP server since this preload's own IPC already runs in the same process. */
  panes: {
    list: (): Promise<PaneSummary[]> => ipcRenderer.invoke("panes:list", readArg("--ygg-project-id")),
    create: (spec: CreatePaneSpec): Promise<{ id: string }> =>
      ipcRenderer.invoke("panes:create", readArg("--ygg-project-id"), spec),
    write: (id: string, text: string, pressEnter?: boolean): Promise<void> =>
      ipcRenderer.invoke("panes:write", readArg("--ygg-project-id"), id, text, pressEnter),
  },
  files: {
    /** Copies files/folders pasted from Finder/Explorer (absolute OS paths) into destRelativePath inside the project. */
    importExternal: (destRelativePath: string, sourcePaths: string[]): Promise<ImportFilesResult> =>
      ipcRenderer.invoke("files:importExternal", readArg("--ygg-project-id"), destRelativePath, sourcePaths),
    /** Electron 32+ removed File.path — this is the replacement, only callable from preload/main, not plain renderer JS. */
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    /** Native OS file/folder picker — always returns real absolute paths, unlike a clipboard paste (see main/clipboardFiles.ts). */
    pickToImport: (): Promise<string[]> => ipcRenderer.invoke("files:pickToImport"),
    /** Opens relativePath in the OS's default app for that file type — for file kinds FileViewer.tsx can't render inline. */
    /** ygg-file:// URL (fileProtocol.ts) for a project-relative path — streamed from disk, no size cap; siblings of the file resolve relative to it. */
    fileUrl: (relativePath: string): string =>
      `ygg-file://f/${encodeURIComponent(readArg("--ygg-project-id") ?? "")}/${relativePath
        .split(/[\\/]/)
        .map(encodeURIComponent)
        .join("/")}`,
    openExternal: (relativePath: string): Promise<void> =>
      ipcRenderer.invoke("files:openExternal", readArg("--ygg-project-id"), relativePath),
  },
  clipboard: {
    /** Reads file/folder paths off the OS clipboard after a Finder Copy (see main/clipboardFiles.ts) — macOS only for now. */
    readFilePaths: (): Promise<string[]> => ipcRenderer.invoke("clipboard:readFilePaths"),
  },
    dialog: {
      openDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:openDirectory"),
    },
  whisper: {
    getSettings: (): Promise<WhisperSettings> => ipcRenderer.invoke("whisper:getSettings"),
    saveSettings: (settings: WhisperSettings): Promise<void> => ipcRenderer.invoke("whisper:saveSettings", settings),
    pickBinary: (): Promise<string | null> => ipcRenderer.invoke("whisper:pickBinary"),
    findBundledBinary: (backend: WhisperBackend): Promise<string | null> =>
      ipcRenderer.invoke("whisper:findBundledBinary", backend),
    listModels: (): Promise<WhisperModelName[]> => ipcRenderer.invoke("whisper:listModels"),
    listDownloaded: (modelsDir: string): Promise<string[]> => ipcRenderer.invoke("whisper:listDownloaded", modelsDir),
    isDownloaded: (modelsDir: string, name: string): Promise<boolean> =>
      ipcRenderer.invoke("whisper:isDownloaded", modelsDir, name),
    download: (modelsDir: string, name: string): Promise<void> =>
      ipcRenderer.invoke("whisper:download", modelsDir, name),
    deleteModel: (modelsDir: string, name: string): Promise<void> =>
      ipcRenderer.invoke("whisper:deleteModel", modelsDir, name),
    transcribe: (audio: ArrayBuffer, settings: WhisperSettings): Promise<string> =>
      ipcRenderer.invoke("whisper:transcribe", audio, settings),
    onDownloadProgress: (handler: (payload: { name: string; fraction: number }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { name: string; fraction: number }) => handler(payload);
      ipcRenderer.on("whisper:downloadProgress", listener);
      return () => ipcRenderer.removeListener("whisper:downloadProgress", listener);
    },
  },
  stt: {
    getSettings: (): Promise<SttSettings> => ipcRenderer.invoke("stt:getSettings"),
    saveSettings: (settings: SttSettings): Promise<void> => ipcRenderer.invoke("stt:saveSettings", settings),
    transcribeCloud: (audio: ArrayBuffer, settings: SttCloudSettings): Promise<string> =>
      ipcRenderer.invoke("stt:transcribeCloud", audio, settings),
  },
  tts: {
    getSettings: (): Promise<TtsSettings> => ipcRenderer.invoke("tts:getSettings"),
    saveSettings: (settings: TtsSettings): Promise<void> => ipcRenderer.invoke("tts:saveSettings", settings),
  },
  settingsTransfer: {
    exportSettings: (workspaceRoot: string | null, includeSecrets: boolean): Promise<{ path: string } | null> =>
      ipcRenderer.invoke("settings:export", workspaceRoot, includeSecrets),
    importSettings: (): Promise<{
      path: string;
      desktopKeys: string[];
      gateway: Record<string, unknown> | null;
      warnings: string[];
    } | null> => ipcRenderer.invoke("settings:import"),
  },
  roles: {
    listCustom: (): Promise<CustomRole[]> => ipcRenderer.invoke("roles:listCustom"),
    saveCustom: (role: { label: string; summary?: string; systemPrompt: string }): Promise<CustomRole[]> =>
      ipcRenderer.invoke("roles:saveCustom", role),
    deleteCustom: (id: string): Promise<CustomRole[]> => ipcRenderer.invoke("roles:deleteCustom", id),
  },
  flowTemplates: {
    listCustom: (): Promise<CustomFlowTemplate[]> => ipcRenderer.invoke("flowTemplates:listCustom"),
    saveCustom: (template: { label: string; summary?: string; prompt: string }): Promise<CustomFlowTemplate[]> =>
      ipcRenderer.invoke("flowTemplates:saveCustom", template),
    deleteCustom: (id: string): Promise<CustomFlowTemplate[]> => ipcRenderer.invoke("flowTemplates:deleteCustom", id),
  },
  onboarding: {
    getState: (): Promise<OnboardingState> => ipcRenderer.invoke("onboarding:getState"),
    save: (settings: OnboardingSettings): Promise<OnboardingSettings> => ipcRenderer.invoke("onboarding:save", settings),
    detectClis: (): Promise<DetectedCli[]> => ipcRenderer.invoke("onboarding:detectClis"),
    detectOllama: (): Promise<OllamaStatus> => ipcRenderer.invoke("onboarding:detectOllama"),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("onboarding:openExternal", url),
  },
  ide: {
    listCatalog: (): Promise<IdeCatalogEntry[]> => ipcRenderer.invoke("ide:listCatalog"),
    detectInstalled: (): Promise<DetectedIde[]> => ipcRenderer.invoke("ide:detectInstalled"),
    getSettings: (): Promise<IdeSettings> => ipcRenderer.invoke("ide:getSettings"),
    saveSettings: (settings: IdeSettings): Promise<void> => ipcRenderer.invoke("ide:saveSettings", settings),
    pickCustomPath: (): Promise<string | null> => ipcRenderer.invoke("ide:pickCustomPath"),
    /** Opens the current project window's project in the configured IDE — see readArg("--ygg-project-id"). `opened: false` (unconfigured, or the configured IDE vanished) means the caller should fall back to Settings → IDE. */
    openProject: (): Promise<OpenIdeResult> => ipcRenderer.invoke("ide:openProject", readArg("--ygg-project-id")),
    /** Opens a project-relative path (typically a folder from the file tree) in the configured IDE. Same `opened: false` fallback semantics as openProject. */
    openPath: (relativePath: string): Promise<OpenIdeResult> =>
      ipcRenderer.invoke("ide:openPath", readArg("--ygg-project-id"), relativePath),
    /** Opens a project-relative file in Blender (configured or autodetected); `opened: false` carries an error telling the user where to set the path. */
    openInBlender: (relativePath: string): Promise<{ opened: boolean; error?: string }> =>
      ipcRenderer.invoke("ide:openInBlender", readArg("--ygg-project-id"), relativePath),
    /** The blender executable currently in effect (configured or autodetected), or null. */
    detectBlender: (): Promise<string | null> => ipcRenderer.invoke("ide:detectBlender"),
    /** Opens a project-relative folder in the OS file explorer, or (for a file) its containing folder with the file selected. */
    revealPath: (relativePath: string, isDir: boolean): Promise<{ opened: boolean; error?: string }> =>
      ipcRenderer.invoke("ide:revealPath", readArg("--ygg-project-id"), relativePath, isDir),
  },
  skills: {
    /** Project, user and installed-plugin skills Claude Code would see for this project window. */
    list: (): Promise<SkillInfo[]> => ipcRenderer.invoke("skills:list", readArg("--ygg-project-id")),
    /** Opens a listed SKILL.md in the default app, or (reveal) shows it in the file explorer. */
    open: (skillPath: string, reveal: boolean): Promise<{ opened: boolean; error?: string }> =>
      ipcRenderer.invoke("skills:open", readArg("--ygg-project-id"), skillPath, reveal),
    /** Creates .claude/skills/<name>/SKILL.md in this project from a starter template. */
    create: (name: string, description: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke("skills:create", readArg("--ygg-project-id"), name, description),
  },
  automation: {
    getPermissions: (): Promise<DesktopPermissions> => ipcRenderer.invoke("automation:getPermissions"),
    requestPermission: (kind: PermissionKind): Promise<void> => ipcRenderer.invoke("automation:requestPermission", kind),
    getSettings: (): Promise<AutomationSettings> => ipcRenderer.invoke("automation:getSettings"),
    saveSettings: (settings: AutomationSettings): Promise<void> => ipcRenderer.invoke("automation:saveSettings", settings),
  },
  sync: {
    getSettings: (): Promise<SyncSettings> => ipcRenderer.invoke("sync:getSettings"),
    saveSettings: (settings: SyncSettings): Promise<void> => ipcRenderer.invoke("sync:saveSettings", settings),
    createShare: (ref: ResourceRef): Promise<{ shareId: string }> => ipcRenderer.invoke("sync:createShare", ref),
    createInvite: (ref: ResourceRef, role: SharedResourceRole, expiresInHours?: number): Promise<{ code: string }> =>
      ipcRenderer.invoke("sync:createInvite", ref, role, expiresInHours),
    redeemInvite: (code: string, memberName: string, ref: ResourceRef): Promise<unknown> =>
      ipcRenderer.invoke("sync:redeemInvite", code, memberName, ref),
    listMyShares: (): Promise<MyShareSummary[]> => ipcRenderer.invoke("sync:listMyShares"),
    getResourceStatus: (ref: ResourceRef): Promise<ResourceStatus> => ipcRenderer.invoke("sync:getResourceStatus", ref),
    push: (ref: ResourceRef): Promise<PushResult> => ipcRenderer.invoke("sync:push", ref),
    pull: (ref: ResourceRef): Promise<PullResult> => ipcRenderer.invoke("sync:pull", ref),
    resolveConflict: (ref: ResourceRef, choice: "keep-mine" | "take-theirs"): Promise<PullResult> =>
      ipcRenderer.invoke("sync:resolveConflict", ref, choice),
    createWebLink: (ref: ResourceRef, email: string, role: SharedResourceRole): Promise<{ url: string; keyHash: string }> =>
      ipcRenderer.invoke("sync:createWebLink", ref, email, role),
    listMembers: (ref: ResourceRef): Promise<ShareMember[]> => ipcRenderer.invoke("sync:listMembers", ref),
    revokeMember: (ref: ResourceRef, memberKeyHash: string): Promise<void> =>
      ipcRenderer.invoke("sync:revokeMember", ref, memberKeyHash),
    refreshWebBundle: (ref: ResourceRef): Promise<void> => ipcRenderer.invoke("sync:refreshWebBundle", ref),
  },
  phoneLink: {
    get: (): Promise<PhoneLinkInfo> => ipcRenderer.invoke("phoneLink:get"),
    save: (input: { hubUrl?: string; hubKey?: string; publish?: boolean }): Promise<PhoneLinkInfo> =>
      ipcRenderer.invoke("phoneLink:save", input),
    publishNow: (): Promise<PhoneLinkInfo> => ipcRenderer.invoke("phoneLink:publishNow"),
    qr: (): Promise<string> => ipcRenderer.invoke("phoneLink:qr"),
  },
};

contextBridge.exposeInMainWorld("yggdrasil", api);

export type YggdrasilPreloadApi = typeof api;
