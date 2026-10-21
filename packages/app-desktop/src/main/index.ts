import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { ensureGateway, type GatewayHandle } from "./gateway.js";
import {
  getProject,
  listProjects,
  registryPath,
  renameProject,
  setProjectColor,
  touchProject,
  upsertProject,
  type ProjectRecord,
} from "./projects.js";
import { disposeAllTerminalsAndWait, disposeTerminalsForProject, registerTerminalIpc } from "./terminals.js";
import { openGatewaysPath, registerOpenGateway, resetOpenGateways, unregisterOpenGateway } from "./openGateways.js";
import { gatewayAuthForNewProject, notifyPhoneLinkChanged, registerPhoneLinkIpc, startPhoneLink, stopPhoneLink } from "./phoneLink.js";
import { readAgentFlow, writeAgentFlow, type AgentFlow } from "./agentFlow.js";
import { readAgentTeams, saveAgentTeam, deleteAgentTeam, renameAgentTeam, type AgentTeam } from "./agentTeams.js";
import { readDocumentTabs, writeDocumentTabs, type DocumentTabsLayout } from "./documentTabs.js";
import { importExternalPaths } from "./fileImport.js";
import { readClipboardFilePaths } from "./clipboardFiles.js";
import { startPaneControlServer, type CreatePaneSpec, type PaneControlHandle } from "./paneControlServer.js";
import {
  createWorkspaceBroker,
  WorkspaceError,
  type AskAnswer,
  type AskRequest,
  type WorkspaceBroker,
} from "./workspace.js";
import { getDesktopAutomationAdapter, type PermissionKind } from "./automation/index.js";
import {
  desktopSettingsFilePath,
  loadAutomationSettings,
  saveAutomationSettings,
  workflowStateDir,
  type AutomationSettings,
} from "./automationSettings.js";
import {
  seedDocumentsGuidance,
  seedMemoryGuidance,
  seedPaneControlGuidance,
  seedPluginsGuidance,
  seedWorkflowsGuidance,
  trustDocumentsMcpServer,
  trustMemoryMcpServer,
  trustPaneControlMcpServer,
  trustPluginsMcpServer,
  trustWorkflowsMcpServer,
  writeDocumentsMcpConfig,
  writeMemoryMcpConfig,
  writePaneControlMcpConfig,
  writePluginsMcpConfig,
  writeWorkflowsMcpConfig,
} from "./mcpConfig.js";
import { indexPluginStorageOnWrite, reindexAllPluginStorage } from "./pluginStorageIndex.js";
import { closeMemoryDb } from "@yggdrasil/context-memory-db";
import { writeStatuslineConfig } from "./statuslineConfig.js";
import { runScriptInSystemTerminal } from "./scriptRunner.js";
import {
  deleteModel,
  downloadModel,
  fileExists,
  findBundledBinary as findBundledWhisperBinary,
  isModelDownloaded,
  listDownloadedModels,
  WHISPER_MODELS,
} from "./whisper.js";
import { ensureWhisperServer, stopWhisperServer, transcribeViaServer } from "./whisperServer.js";
import {
  loadWhisperSettings,
  saveWhisperSettings,
  loadSttSettings,
  saveSttSettings,
  type WhisperSettings,
  type SttSettings,
} from "./whisperSettings.js";
import { transcribeCloud } from "./sttCloud.js";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";
import { buildExportMarkdown, deepMerge, parseImportMarkdown } from "./settingsTransfer.js";
import { loadTtsSettings, saveTtsSettings, type TtsSettings } from "./ttsSettings.js";
import { deleteCustomRole, loadCustomRoles, saveCustomRole, type CustomRole } from "./roles.js";
import {
  deleteCustomFlowTemplate,
  loadCustomFlowTemplates,
  saveCustomFlowTemplate,
  type CustomFlowTemplate,
} from "./flowTemplates.js";
import {
  IDE_CATALOG,
  detectInstalledIdes,
  loadIdeSettings,
  openProjectInIde,
  saveIdeSettings,
  type DetectedIde,
  type IdeSettings,
} from "./ideSettings.js";
import { defaultThemeSettings, loadThemeSettings, saveThemeSettings, type ThemeSettings } from "./themeSettings.js";
import { loadSyncSettings, saveSyncSettings, type SyncSettings } from "./syncSettings.js";
import { resourceKeyFor, type ResourceRef } from "./sharedResources.js";
import {
  createInviteForResource,
  createShareForResource,
  createWebLinkForResource,
  getResourceStatus,
  listMembersForResource,
  listMyShares as listMySyncShares,
  pullResource,
  pushResource,
  pushResourceInBackground,
  redeemInviteAndAttach,
  refreshWebBundle,
  resolveConflict as resolveSyncConflict,
  revokeMemberForResource,
} from "./syncEngine.js";
import { notesAbsoluteDir, watchNotesDir } from "./notesWatcher.js";
import { createBrowserTabView, type BrowserTabBounds, type BrowserTabHandle } from "./browserTabView.js";
import {
  deletePlugin,
  ensurePluginDirs,
  globalPluginsDir,
  projectPluginsDir,
  scaffoldPlugin,
  scanPlugins,
  setPluginStatus,
  watchPluginsDir,
  type PluginScope,
  type PluginStatus,
  type ScaffoldPluginSpec,
} from "./plugins.js";
import { registerPluginProtocol } from "./pluginProtocol.js";
import { registerFileProtocol } from "./fileProtocol.js";
import { locateBlender, openInBlender } from "./blender.js";
import { createProjectSkill, listSkills, SkillCreateError } from "./skills.js";
import { pluginStorageDelete, pluginStorageGet, pluginStorageKeys, pluginStorageSet } from "./pluginStorage.js";
import { readPluginTabs, writePluginTabs, type PluginTabsLayout } from "./pluginTabs.js";
import { PLUGIN_API_DOCS } from "./pluginApiDocs.js";
import { installCrashLogging, logCaughtError, logPath } from "./crashLogging.js";
import { resolveShellPath } from "./resolveShellPath.js";
import { installAboutMenu } from "./aboutPanel.js";
import { installAutoUpdater } from "./autoUpdate.js";

// Loads packages/app-desktop/.env (gitignored, `.env*` in the root
// .gitignore) into process.env before anything else runs — this is where
// GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET (tool-google/src/oauth.ts)
// live for a dev checkout. Every gateway subprocess spawn spreads
// `...process.env` (gateway.ts's spawnGatewaySubprocess), so anything set
// here reaches it automatically. Silently no-ops if the file doesn't exist
// (a packaged build, or a machine that sets these as real env vars instead)
// — Node's loadEnvFile throws ENOENT otherwise, which would crash startup
// for everyone who doesn't use this file.
try {
  process.loadEnvFile(join(app.getAppPath(), ".env"));
} catch {
  // no .env present — fine, credentials can also come from the real environment.
}

// Also loads the monorepo root .env (ANTHROPIC_API_KEY for the `claude` CLI
// terminals spawn, GROQ_API_KEY for the cloud STT preset, etc). Dev-checkout
// only — app.getAppPath() points inside the packaged app.asar/Resources in a
// build, where this path never exists. loadEnvFile never overrides a key
// already set above or in the real environment.
try {
  process.loadEnvFile(join(app.getAppPath(), "..", "..", ".env"));
} catch {
  // no repo-root .env present — fine.
}

installCrashLogging();

// Google OAuth (and any future browser-based consent flow) redirects here —
// same custom scheme mobile already registers an intent-filter for
// (packages/tool-google/src/oauth.ts's DEFAULT_REDIRECT_URI). Desktop had no
// handler for it at all until now: the browser opened by
// connectors.google.authUrl had nowhere to hand the resulting `code` back
// to. Must be requested before app.whenReady — Electron ignores it later.
const YGG_PROTOCOL = "yggdrasil";

// Complementos ("plugins", plugins.ts) — a served scheme, unlike the
// deep-link-only yggdrasil:// above (which serves no content of its own).
// Privilege registration must happen at module load, before app.whenReady —
// Electron silently ignores it once the app is ready. The actual content
// handler (pluginProtocol.ts's registerPluginProtocol) is registered inside
// whenReady instead, since protocol.handle needs a ready default session.
protocol.registerSchemesAsPrivileged([
  { scheme: "ygg-plugin", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
  // Project files for the 3D/audio viewers (fileProtocol.ts). `stream` is what
  // lets <audio> use Range requests; corsEnabled lets the renderer fetch() it.
  { scheme: "ygg-file", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function extractDeepLinkUrl(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${YGG_PROTOCOL}://`));
}

// Broadcast to every open project window rather than tracking "which window
// started this auth flow" — each window's own gateway process holds its own
// in-memory pending-state map (tool-google's consumePendingState), so only
// the one that actually issued this `state` will succeed; every other
// window's completeAuth call harmlessly errors with "unknown or expired
// state" and its UI just ignores that (it wasn't waiting on this callback).
function broadcastOAuthCallback(url: URL): void {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("connectors:oauthCallback", { code, state });
  }
}

/** Opens the project named by `?id=`, or the default workspace if absent/unknown — the
 * target of a `yggdrasil://open-project` deep link (see openDesktopProjectTool in
 * tool-system, used by app-avatar to jump here by voice/text). */
async function openProjectDeepLink(url: URL): Promise<void> {
  const id = url.searchParams.get("id");
  const target = (id && (await getProject(id))) || (defaultProjectId && (await getProject(defaultProjectId)));
  if (target) await openProject(target);
}

function handleDeepLink(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== `${YGG_PROTOCOL}:`) return;
  if (parsed.hostname === "oauth") broadcastOAuthCallback(parsed);
  else if (parsed.hostname === "open-project") void openProjectDeepLink(parsed);
}

// Only one Electron process ever runs for this app (createProjectBrowserWindow
// opens N BrowserWindows within it, not N app instances) — without this
// lock, clicking a yggdrasil:// link while the app is already running would
// spawn a second, window-less Electron process that immediately quits below
// without ever delivering the link to the instance that's actually showing
// the "Connect Google" button.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = extractDeepLinkUrl(argv);
    if (url) handleDeepLink(url);
    const [firstWindow] = BrowserWindow.getAllWindows();
    if (firstWindow) {
      if (firstWindow.isMinimized()) firstWindow.restore();
      firstWindow.focus();
    }
  });
}

app.setAsDefaultProtocolClient(YGG_PROTOCOL);

// macOS delivers the link this way instead of a second launch/argv.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

type OpenProjectWindow = {
  window: BrowserWindow;
  gateway: GatewayHandle;
  paneControl: PaneControlHandle;
  /** Lazily created on first use (browser_open, or the user switching to the Browser tab) — most projects never touch it. */
  browserTab?: BrowserTabHandle;
  /** Watches this project's own .yggdrasil/plugins/ dir — see plugins.ts's watchPluginsDir. Closed alongside the window. */
  pluginWatcher?: { close(): void };
  /** Watches this project's notes/ dir for shared-file changes — see notesWatcher.ts. Closed alongside the window. */
  notesWatcher?: { close(): void };
};

/** One dedicated gateway process + window per open project, keyed by project id. */
const projectWindows = new Map<string, OpenProjectWindow>();

/**
 * In-flight plugin tool calls (a `claude`/`agy` terminal session, via
 * paneControlServer.ts's POST /plugins/:scope/:id/call-tool) waiting on a
 * reply from this project's own renderer, which owns the actual headless
 * iframe execution (PluginToolRuntime.tsx). Electron's `ipcMain.handle` only
 * goes renderer→main, so the other direction (main asking the renderer to do
 * something and awaiting a real answer) needs this explicit request/response
 * pairing: `webContents.send("plugins:toolCallRequest", ...)` pushes the
 * request, and the "plugins:toolCallResult" IPC handler below resolves/rejects
 * the matching entry here by callId.
 */
const pendingPluginToolCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/**
 * Cross-project workspace (notes/features/cross-project-workspace.md). The broker
 * is the only code that reaches from one project's panes into another's; an
 * agent's request pauses here until the human answers the prompt shown in the
 * *caller's* window (`workspace:ask` -> `workspace:answer`), or the timeout
 * counts as a denial.
 */
let workspaceBroker: WorkspaceBroker | undefined;
const pendingWorkspaceAsks = new Map<string, (answer: AskAnswer) => void>();
const WORKSPACE_ASK_TIMEOUT_MS = 120_000;

function requireWorkspaceBroker(): WorkspaceBroker {
  if (!workspaceBroker) throw new WorkspaceError("workspace is not ready yet", 409);
  return workspaceBroker;
}

function askWorkspace(request: AskRequest): Promise<AskAnswer> {
  const win = projectWindows.get(request.fromProject.id)?.window;
  if (!win || win.isDestroyed()) return Promise.resolve({ allow: false, trust: false });
  const id = randomUUID();
  return new Promise((resolve) => {
    const finish = (answer: AskAnswer) => {
      clearTimeout(timer);
      pendingWorkspaceAsks.delete(id);
      resolve(answer);
    };
    const timer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send("workspace:askClosed", { id });
      finish({ allow: false, trust: false });
    }, WORKSPACE_ASK_TIMEOUT_MS);
    pendingWorkspaceAsks.set(id, finish);
    // The human may be looking at another window: make this one hard to miss.
    win.flashFrame(true);
    win.webContents.send("workspace:ask", {
      id,
      fromName: request.fromProject.name,
      toName: request.toProject.name,
      action: request.action,
      paneTitle: request.paneTitle,
      excerpt: request.excerpt,
    });
  });
}

/**
 * The "Default Workspace" project (see `defaultWorkspaceRoot`) is the only
 * window that shows the Projects section in its sidebar — it's the hub you
 * open other projects from. Any other project's window is scoped to just
 * that project (Sessions/Agents only), set once at startup.
 */
let defaultProjectId: string | undefined;
// Loaded once at startup and kept in sync by theme:set; new windows get it as an
// argument so they paint with the user's colors from the first frame.
let currentTheme: ThemeSettings = defaultThemeSettings();

function pluginSearchDir(): string {
  // See gateway.ts's seedWorkspaceConfig for why this needs to be explicit.
  return join(app.getAppPath(), "node_modules/@yggdrasil");
}

/**
 * Standalone desktop app, not tied to any dev workspace — the app's own
 * OS-standard per-app data directory. This is registered as an ordinary
 * project (named "Default Workspace") so the app boots straight into a
 * working window exactly like before Projects existed, while still being a
 * normal entry in the Projects list/registry.
 */
function defaultWorkspaceRoot(): string {
  return app.getPath("userData");
}

function loadRenderer(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
}

async function resolveInitialWhisperBinaryPath(current: string, backend: WhisperSettings["backend"]): Promise<string> {
  if (current) return current;
  return (await findBundledWhisperBinary(resourcesDir(), backend)) ?? "";
}

function paneControlShimPath(): string {
  // Built as its own bundle alongside index.js — see electron.vite.config.ts.
  return join(__dirname, "paneControlMcpShim.js");
}

function documentsControlShimPath(): string {
  // Built as its own bundle alongside index.js — see electron.vite.config.ts.
  return join(__dirname, "documentsControlMcpShim.js");
}

function memoryControlShimPath(): string {
  // Built as its own bundle alongside index.js — see electron.vite.config.ts.
  return join(__dirname, "memoryControlMcpShim.js");
}

function pluginsControlShimPath(): string {
  // Built as its own bundle alongside index.js — see electron.vite.config.ts.
  return join(__dirname, "pluginsControlMcpShim.js");
}

function workflowsMcpShimPath(): string {
  // Built as its own bundle alongside index.js — see electron.vite.config.ts.
  return join(__dirname, "workflowsMcpShim.js");
}

function statuslineBridgePath(): string {
  // Built as its own bundle alongside index.js — see electron.vite.config.ts.
  return join(__dirname, "statuslineBridge.js");
}

function createProjectBrowserWindow(project: ProjectRecord, gatewayUrl: string, gatewayLanUrl: string): BrowserWindow {
  const additionalArguments = [
    `--ygg-project-id=${project.id}`,
    `--ygg-project-name=${project.name}`,
    `--ygg-project-color=${project.color ?? ""}`,
    `--ygg-gateway-url=${gatewayUrl}`,
    `--ygg-gateway-lan-url=${gatewayLanUrl}`,
    `--ygg-theme=${JSON.stringify(currentTheme)}`,
  ];
  if (project.id === defaultProjectId) additionalArguments.push("--ygg-is-default=1");

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    // No native chrome anywhere (not just titleBarStyle:"hidden", which on
    // mac keeps the native traffic lights) — TitleBar.tsx draws its own
    // black bar with its own close/minimize/maximize buttons on every
    // platform, so the OS frame would otherwise just double up on that.
    frame: false,
    title: `Yggdrasil - ${project.name} - ${gatewayLanUrl}`,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: false,
      additionalArguments,
      // Off by default in Electron — needed for the <embed type="application/pdf">
      // in FileViewer.tsx to actually render via Chromium's built-in PDFium
      // viewer instead of showing a broken-plugin icon.
      plugins: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // The renderer's static <title> would otherwise clobber our project-scoped
  // title as soon as the page loads. (Frameless, so nothing shows this
  // title visually — it still matters for the OS taskbar/Alt-Tab/Dock.)
  win.on("page-title-updated", (event) => event.preventDefault());
  // Frameless window has no visible menu bar, so the View > Toggle Developer
  // Tools accelerator isn't reliably reachable on Windows/Linux — wire F12 and
  // Ctrl/Cmd+Shift+I directly.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const isF12 = input.key === "F12";
    const isCtrlShiftI = (input.control || input.meta) && input.shift && input.key.toLowerCase() === "i";
    if (isF12 || isCtrlShiftI) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  // TitleBar.tsx's maximize button needs to reflect real OS state (e.g. a
  // double-click on the frameless bar, or the OS's own maximize/snap
  // gesture) — not just what the button itself last did.
  win.on("maximize", () => win.webContents.send("window:maximizedChange", true));
  win.on("unmaximize", () => win.webContents.send("window:maximizedChange", false));
  // macOS: the Maximize button means native full screen (own Space), so mirror that state too.
  win.on("enter-full-screen", () => win.webContents.send("window:maximizedChange", true));
  win.on("leave-full-screen", () => win.webContents.send("window:maximizedChange", false));
  // Markdown-rendered chat content can contain links (model output, file
  // content). Never let them navigate the app window itself — open in the
  // OS default browser instead, same as any well-behaved Electron app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.on("closed", () => {
    const entry = projectWindows.get(project.id);
    if (entry?.window === win) {
      entry.gateway.shutdown();
      entry.paneControl.shutdown();
      entry.browserTab?.destroy();
      entry.pluginWatcher?.close();
      entry.notesWatcher?.close();
      disposeTerminalsForProject(project.id);
      projectWindows.delete(project.id);
      void unregisterOpenGateway(project.id).then(notifyPhoneLinkChanged);
      // getMemoryDb caches one open sqlite handle per project path (see
      // db.ts) — without this, a long-running Electron session that opens
      // many projects over time would leak one fd/handle per project ever
      // visited instead of just the currently-open ones.
      closeMemoryDb(project.path);
    }
  });
  loadRenderer(win);
  return win;
}

/** Lazily creates this project's Browser-tab WebContentsView on first use (navigate, or switching to the tab) — undefined only if the project's window is already gone. */
function resolveBrowserTab(projectId: string): BrowserTabHandle | undefined {
  const entry = projectWindows.get(projectId);
  if (!entry || entry.window.isDestroyed()) return undefined;
  if (!entry.browserTab) entry.browserTab = createBrowserTabView(entry.window);
  return entry.browserTab;
}

const execFileAsync = promisify(execFile);

/** Root folder for projects created remotely (phone → projects.create). */
function remoteProjectsRoot(): string {
  return join(homedir(), "Yggdrasil");
}

/** Validates a project name from the phone: one plain folder name, no path tricks. */
function validateProjectName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("El nombre del proyecto es obligatorio");
  if (name.length > 80) throw new Error("El nombre es demasiado largo (máx. 80)");
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) || name.startsWith(".") || name.endsWith(".")) {
    throw new Error("El nombre tiene caracteres no permitidos");
  }
  return name;
}

/** Creates ~/Yggdrasil/<name> (git init), registers it and opens it so its gateway is reachable from the phone. */
async function createProjectFromPhone(rawName: string): Promise<{ id: string; name: string; path: string; port: number | null }> {
  const name = validateProjectName(rawName);
  const folderPath = join(remoteProjectsRoot(), name);
  const known = (await listProjects()).some((p) => p.path === folderPath);
  if (known) throw new Error(`Ya existe un proyecto "${name}"`);
  let existing: string[] = [];
  try {
    existing = await readdir(folderPath);
  } catch {
    // Doesn't exist yet — the normal case.
  }
  if (existing.length > 0) throw new Error(`La carpeta ${folderPath} ya existe y no está vacía`);
  await mkdir(folderPath, { recursive: true });
  try {
    await execFileAsync("git", ["init"], { cwd: folderPath });
  } catch {
    // git missing/failed — the project still works without a repo.
  }
  const project = await upsertProject({ path: folderPath, name });
  await openProject(project);
  return { id: project.id, name: project.name, path: project.path, port: projectWindows.get(project.id)?.gateway.port ?? null };
}

async function openProject(project: ProjectRecord): Promise<void> {
  try {
    await openProjectUnsafe(project);
  } catch (err) {
    console.error(`[openProject] failed for ${project.path}:`, err);
    dialog.showErrorBox("Could not open project", err instanceof Error ? (err.stack ?? err.message) : String(err));
    throw err;
  }
}

async function openProjectUnsafe(project: ProjectRecord): Promise<void> {
  const existing = projectWindows.get(project.id);
  if (existing && !existing.window.isDestroyed()) {
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.focus();
    return;
  }

  await mkdir(project.path, { recursive: true });
  await ensurePluginDirs(project.path);
  // Pane control starts first (it only depends on getWindow, resolved
  // lazily) so its URL+token can be handed to the gateway subprocess at
  // spawn time — terminals.list (gateway.ts) needs it to bridge into this
  // project's live pane registry, which lives in this process, not the
  // spawned gateway.
  const paneControl = await startPaneControlServer(
    project.id,
    project.path,
    () => projectWindows.get(project.id)?.window,
    {
      navigate: (url) => resolveBrowserTab(project.id)?.navigate(url) ?? Promise.resolve(),
      startPick: (timeoutMs) => resolveBrowserTab(project.id)?.startPick(timeoutMs) ?? Promise.resolve(null),
    },
    {
      list: () => scanPlugins(project.id, project.path),
      scaffold: (spec) => scaffoldPlugin(spec, project.id, project.path),
      reload: (scope, id) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send("plugins:changed", scope ? { scope, pluginId: id } : { scope: "all" });
        }
      },
      open: (scope, id, view) => {
        const win = projectWindows.get(project.id)?.window;
        if (win && !win.isDestroyed()) win.webContents.send("plugins:openRequest", { key: `${scope}:${id}`, view });
      },
      apiDocs: () => PLUGIN_API_DOCS,
      callTool: (scope, id, tool, params) => {
        const win = projectWindows.get(project.id)?.window;
        if (!win || win.isDestroyed()) return Promise.reject(new Error("project window not open"));
        const callId = randomUUID();
        return new Promise((resolve, reject) => {
          // Longer than PluginFrame.tsx's own 30s per-call timeout, so that
          // more specific error ("tool X superó el tiempo de espera") is
          // what actually reaches the caller instead of this generic one.
          const timer = setTimeout(() => {
            pendingPluginToolCalls.delete(callId);
            reject(new Error("tool call timed out (no response from renderer)"));
          }, 35_000);
          pendingPluginToolCalls.set(callId, {
            resolve: (v) => {
              clearTimeout(timer);
              resolve(v);
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          });
          win.webContents.send("plugins:toolCallRequest", { callId, scope, id, tool, params });
        });
      },
    },
    { create: createProjectFromPhone },
    {
      projects: () => requireWorkspaceBroker().projectsFor(project.id),
      panes: (target) => requireWorkspaceBroker().listPanes(project.id, target),
      read: (target, pane, maxChars) => requireWorkspaceBroker().readPane(project.id, target, pane, maxChars),
      write: (target, pane, text, fromPaneTitle) =>
        requireWorkspaceBroker().writePane(project.id, target, pane, text, fromPaneTitle),
    },
  );
  const gateway = await ensureGateway(
    project.path,
    pluginSearchDir(),
    registryPath(),
    paneControl.url,
    paneControl.token,
    openGatewaysPath(),
    workflowStateDir(project.id),
    desktopSettingsFilePath(),
    await gatewayAuthForNewProject(),
  );
  await registerOpenGateway(project.id, gateway.port);
  notifyPhoneLinkChanged();
  await writePaneControlMcpConfig(project.path, paneControlShimPath(), paneControl.url, paneControl.token);
  await trustPaneControlMcpServer(project.path);
  await seedPaneControlGuidance(project.path);
  await writeDocumentsMcpConfig(project.path, documentsControlShimPath());
  await trustDocumentsMcpServer(project.path);
  await seedDocumentsGuidance(project.path);
  await writePluginsMcpConfig(project.path, pluginsControlShimPath(), paneControl.url, paneControl.token);
  await trustPluginsMcpServer(project.path);
  await seedPluginsGuidance(project.path);
  await writeMemoryMcpConfig(project.path, memoryControlShimPath());
  await trustMemoryMcpServer(project.path);
  await seedMemoryGuidance(project.path);
  await writeWorkflowsMcpConfig(project.path, workflowsMcpShimPath(), gateway.url);
  await trustWorkflowsMcpServer(project.path);
  await seedWorkflowsGuidance(project.path);
  await writeStatuslineConfig(project.path, statuslineBridgePath(), paneControl.url, paneControl.token);
  // Fire-and-forget — pre-existing plugin data (installed before this
  // integration shipped, or from a plugin the user hasn't touched since
  // opening this project) becomes searchable without waiting on its next
  // write. Small JSON files, cheap even on a slow disk.
  void reindexAllPluginStorage(project.path, project.id).catch((err) => {
    console.error(`[pluginStorageIndex] initial reindex failed for ${project.id}:`, err);
  });
  const win = createProjectBrowserWindow(project, gateway.url, gateway.lanUrl);
  const pluginWatcher = watchPluginsDir(projectPluginsDir(project.path), (pluginId) => {
    if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "project", pluginId });
  });
  const notesWatcher = watchNotesDir(notesAbsoluteDir(project.path), project.id);
  projectWindows.set(project.id, { window: win, gateway, paneControl, pluginWatcher, notesWatcher });
}

function registerIpc(): void {
  // TitleBar.tsx (frameless window, every platform) — each handler acts on
  // whichever window actually sent the request, not some tracked "current"
  // window, since several project windows can be open at once.
  ipcMain.handle("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle("window:toggleMaximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    // macOS: native full screen (new Space) instead of just zooming the frame.
    if (process.platform === "darwin") win.setFullScreen(!win.isFullScreen());
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("window:isMaximized", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    return process.platform === "darwin" ? win.isFullScreen() : win.isMaximized();
  });

  // Browser tab (BrowserTabView.tsx) — a WebContentsView is a native layer
  // Electron composites into the window, not a DOM node, so the renderer
  // can only ever ask for it to navigate/reposition/show/hide, never render
  // it directly. `navigate`/`show` lazily create the view (most projects
  // never touch this tab); `hide`/`getUrl` read the existing entry directly
  // instead, since there'd be nothing useful to lazily create just to hide.
  ipcMain.handle("browserTab:navigate", async (_event, projectId: string, url: string) => {
    await resolveBrowserTab(projectId)?.navigate(url);
  });
  ipcMain.handle("browserTab:setBounds", (_event, projectId: string, bounds: BrowserTabBounds) => {
    resolveBrowserTab(projectId)?.setBounds(bounds);
  });
  ipcMain.handle("browserTab:show", (_event, projectId: string) => {
    resolveBrowserTab(projectId)?.show();
  });
  ipcMain.handle("browserTab:hide", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.hide();
  });
  ipcMain.handle("browserTab:getUrl", (_event, projectId: string) => projectWindows.get(projectId)?.browserTab?.getUrl() ?? "");
  // Blocks until the user clicks something in the loaded page (or Escape /
  // timeout) — see browserTabView.ts's startPick and
  // browserTabPickerPreload.ts's overlay. Same method backs both the
  // renderer's own "Pick element" button and paneControlServer.ts's
  // agent-callable /browser/pick.
  ipcMain.handle("browserTab:startPick", async (_event, projectId: string, timeoutMs?: number) => {
    return (await resolveBrowserTab(projectId)?.startPick(timeoutMs)) ?? null;
  });

  ipcMain.handle("projects:list", () => listProjects());

  ipcMain.handle("projects:openExisting", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = result.filePaths[0]!;
    const project = await upsertProject({ path: folderPath, name: basename(folderPath) });
    await openProject(project);
    return project;
  });

  ipcMain.handle("projects:createNew", async () => {
    const result = await dialog.showSaveDialog({
      title: "Create New Project",
      buttonLabel: "Create Project",
    });
    if (result.canceled || !result.filePath) return null;
    const folderPath = result.filePath;
    await mkdir(folderPath, { recursive: true });
    const project = await upsertProject({ path: folderPath, name: basename(folderPath) });
    await openProject(project);
    return project;
  });

  ipcMain.handle("projects:open", async (_event, id: string) => {
    const project = await getProject(id);
    if (!project) return false;
    await touchProject(project.id);
    await openProject(project);
    return true;
  });

  // The Home button in a project window's title bar: focus the main (default
  // workspace) window, or reopen it if it was closed. Deliberately no
  // touchProject — going home must not reorder "most recently opened".
  ipcMain.handle("projects:openHome", async () => {
    const home = defaultProjectId ? await getProject(defaultProjectId) : undefined;
    if (!home) return false;
    await openProject(home);
    return true;
  });

  ipcMain.handle("projects:rename", async (_event, id: string, name: string) => {
    const project = await renameProject(id, name);
    const entry = projectWindows.get(id);
    if (project && entry) entry.window.setTitle(`Yggdrasil - ${project.name} - ${entry.gateway.lanUrl}`);
    return project;
  });

  ipcMain.handle("projects:setColor", async (_event, id: string, color: string | null) => {
    const project = await setProjectColor(id, color);
    // Broadcast to every window, not just this project's own — the Default
    // Workspace window's Projects sidebar list needs to update its dot live
    // too, without waiting on a manual refresh.
    if (project) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("project:colorChange", { id, color: project.color });
      }
    }
    return project;
  });

  ipcMain.handle("statusline:get", (_event, projectId: string) => projectWindows.get(projectId)?.paneControl.getRateLimits());

  ipcMain.handle(
    "scripts:runInTerminal",
    (_event, params: { cwd: string; packageManager: string; scriptName: string }) =>
      runScriptInSystemTerminal(params.cwd, params.packageManager, params.scriptName),
  );

  ipcMain.handle("agentFlow:get", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return null;
    return readAgentFlow(project.path);
  });

  ipcMain.handle("agentFlow:save", async (_event, projectId: string, flow: AgentFlow) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    await writeAgentFlow(project.path, flow);
  });

  ipcMain.handle("agentTeams:list", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return [];
    return readAgentTeams(project.path);
  });

  ipcMain.handle("agentTeams:save", async (_event, projectId: string, team: AgentTeam) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return saveAgentTeam(project.path, team);
  });

  ipcMain.handle("agentTeams:delete", async (_event, projectId: string, id: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return deleteAgentTeam(project.path, id);
  });

  ipcMain.handle("agentTeams:rename", async (_event, projectId: string, id: string, name: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return renameAgentTeam(project.path, id, name);
  });

  ipcMain.handle("documents:getLayout", (_event, projectId: string) => readDocumentTabs(projectId));

  ipcMain.handle("documents:saveLayout", (_event, projectId: string, layout: DocumentTabsLayout) =>
    writeDocumentTabs(projectId, layout),
  );

  ipcMain.handle("plugins:list", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return [];
    return scanPlugins(projectId, project.path);
  });

  // Manual "Recargar" — rescans immediately (a plugins:changed watcher event
  // already does this on its own; this is for when the user doesn't want to
  // wait out the debounce, or the fs.watch backend missed something).
  ipcMain.handle("plugins:reload", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    const records = project ? await scanPlugins(projectId, project.path) : [];
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
    }
    return records;
  });

  ipcMain.handle("plugins:storageGet", (_event, projectId: string, scope: PluginScope, id: string, key: string) =>
    pluginStorageGet(scope, id, projectId, key),
  );

  ipcMain.handle(
    "plugins:storageSet",
    async (_event, projectId: string, scope: PluginScope, id: string, key: string, value: unknown) => {
      await pluginStorageSet(scope, id, projectId, key, value);
      // A no-op if this key isn't shared (pushResource just returns "Not
      // shared" and pushResourceInBackground swallows it) — see
      // syncEngine.ts. Fire-and-forget so a save never waits on the network.
      pushResourceInBackground(resourceKeyFor({ resourceType: "plugin-storage-key", projectId, scope, pluginId: id, storageKey: key }));
      // Same fire-and-forget posture — keeps plugin_data_search fresh
      // without making a plugin's own save wait on a sqlite write.
      const project = await getProject(projectId);
      if (project) indexPluginStorageOnWrite(project.path, scope, id, key, value);
    },
  );

  ipcMain.handle(
    "plugins:storageDelete",
    async (_event, projectId: string, scope: PluginScope, id: string, key: string) => {
      await pluginStorageDelete(scope, id, projectId, key);
      const project = await getProject(projectId);
      if (project) indexPluginStorageOnWrite(project.path, scope, id, key, undefined);
    },
  );

  ipcMain.handle("plugins:storageKeys", (_event, projectId: string, scope: PluginScope, id: string) =>
    pluginStorageKeys(scope, id, projectId),
  );

  // ygg.fs.write/mkdir (a "fs:write"-permission plugin) — deliberately its
  // own IPC instead of proxying through the gateway's fs.write/fs.mkdir RPC:
  // those always pop the ApprovalBar, even from this app's own loopback
  // connection (see ChatView.tsx's floating approval-bar-overlay comment),
  // which would mean an approval prompt on every single plugin save. Same
  // resolve/relative root-confinement guard as files:openExternal above.
  // The gateway's own fs.watch still sees the write and emits fs.changed
  // (FileTree, DocumentsView, and a "fs" plugin's own listener all pick it
  // up the normal way) — this only bypasses the RPC's approval gate, not the
  // workspace root confinement or the change notification.
  ipcMain.handle("plugins:fsWrite", async (_event, projectId: string, relativePath: string, content: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const resolvedRoot = resolve(project.path);
    const target = resolve(resolvedRoot, relativePath);
    const rel = relative(resolvedRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("relativePath escapes the project root");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  });

  ipcMain.handle("plugins:fsMkdir", async (_event, projectId: string, relativePath: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const resolvedRoot = resolve(project.path);
    const target = resolve(resolvedRoot, relativePath);
    const rel = relative(resolvedRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("relativePath escapes the project root");
    await mkdir(target, { recursive: true });
  });

  ipcMain.handle("panes:list", async (_event, projectId: string) => {
    const paneControl = projectWindows.get(projectId)?.paneControl;
    return paneControl ? (await paneControl.listPanes()).panes : [];
  });

  ipcMain.handle("panes:create", async (_event, projectId: string, spec: CreatePaneSpec) => {
    const paneControl = projectWindows.get(projectId)?.paneControl;
    if (!paneControl) throw new Error("Project window not open");
    return paneControl.createPane(spec);
  });

  ipcMain.handle(
    "panes:write",
    async (_event, projectId: string, id: string, text: string, pressEnter?: boolean) => {
      const paneControl = projectWindows.get(projectId)?.paneControl;
      if (!paneControl) throw new Error("Project window not open");
      await paneControl.writePane(id, text, pressEnter ?? true);
    },
  );

  ipcMain.handle("plugins:getLayout", (_event, projectId: string) => readPluginTabs(projectId));

  ipcMain.handle("plugins:saveLayout", (_event, projectId: string, layout: PluginTabsLayout) =>
    writePluginTabs(projectId, layout),
  );

  // PluginsSection's "Mostrar carpeta" — `dir` always comes from a
  // PluginRecord this same process handed the renderer via plugins:list, so
  // there's no untrusted-path concern here (unlike files:openExternal above,
  // whose relativePath is confined against the project root because it's
  // reachable from arbitrary chat/tool input).
  ipcMain.handle("plugins:reveal", (_event, dir: string) => {
    shell.showItemInFolder(dir);
  });

  // Reply half of the callTool request/response pair built in openProject()
  // above — PluginToolRuntime.tsx (renderer) calls this once it has (or
  // fails to get) a result from the plugin's own headless iframe.
  ipcMain.handle("plugins:toolCallResult", (_event, callId: string, ok: boolean, resultOrError: unknown) => {
    const pending = pendingPluginToolCalls.get(callId);
    if (!pending) return; // late or duplicate reply — nothing waiting on it anymore
    pendingPluginToolCalls.delete(callId);
    if (ok) pending.resolve(resultOrError);
    else pending.reject(new Error(typeof resultOrError === "string" ? resultOrError : "tool call failed"));
  });

  // Studio's own scaffold entry point — direct, no HTTP/MCP hop (unlike the
  // scaffold_plugin MCP tool, only reachable from a claude CLI pane). status
  // defaults to "draft" HERE, not inside scaffoldPlugin itself, so the
  // existing MCP tool's own default (undefined/published) stays untouched.
  ipcMain.handle("plugins:scaffold", async (_event, projectId: string, spec: ScaffoldPluginSpec) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const record = await scaffoldPlugin({ ...spec, status: spec.status ?? "draft" }, projectId, project.path);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
    }
    return record;
  });

  ipcMain.handle(
    "plugins:setStatus",
    async (_event, projectId: string, scope: PluginScope, id: string, status: PluginStatus) => {
      const project = await getProject(projectId);
      if (!project) throw new Error("Unknown project");
      const record = await setPluginStatus(scope, id, projectId, project.path, status);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
      }
      return record;
    },
  );

  ipcMain.handle("plugins:delete", async (_event, projectId: string, scope: PluginScope, id: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    await deletePlugin(scope, id, project.path);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
    }
  });

  ipcMain.handle(
    "files:importExternal",
    async (_event, projectId: string, destRelativePath: string, sourcePaths: string[]) => {
      const project = await getProject(projectId);
      if (!project) throw new Error("Unknown project");
      return importExternalPaths(project.path, destRelativePath, sourcePaths);
    },
  );

  ipcMain.handle("clipboard:readFilePaths", () => readClipboardFilePaths());

  // The reliable way to import files: a real OS picker always hands back
  // genuine absolute paths, no matter what quirks a given file has on the
  // clipboard (see clipboardFiles.ts's file-ID-URL doc comment) or whether
  // it's convenient to drag right now.
  ipcMain.handle("files:pickToImport", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "openDirectory", "multiSelections", "treatPackageAsDirectory"],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // For a file type FileViewer.tsx can't render inline (a .docx, a video,
  // etc.) — hands off to the OS's own default app instead of just failing.
  ipcMain.handle("files:openExternal", async (_event, projectId: string, relativePath: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const resolvedRoot = resolve(project.path);
    const target = resolve(resolvedRoot, relativePath);
    const rel = relative(resolvedRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("relativePath escapes the project root");
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
  });

  ipcMain.handle("whisper:getSettings", async (): Promise<WhisperSettings> => {
    const settings = await loadWhisperSettings(app.getPath("userData"));
    settings.binaryPath = await resolveInitialWhisperBinaryPath(settings.binaryPath, settings.backend);
    return settings;
  });

  // Used by the Settings CPU/GPU toggle to look up the matching bundled
  // build's path (if present) without saving — the renderer decides whether
  // to adopt it into binaryPath.
  ipcMain.handle("whisper:findBundledBinary", async (_event, backend: WhisperSettings["backend"]) =>
    findBundledWhisperBinary(resourcesDir(), backend),
  );

  ipcMain.handle("whisper:saveSettings", async (_event, settings: WhisperSettings) => {
    await saveWhisperSettings(app.getPath("userData"), settings);
  });

  ipcMain.handle("whisper:pickBinary", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select whisper-server binary",
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  });

  ipcMain.handle("whisper:listModels", () => WHISPER_MODELS);

  ipcMain.handle("whisper:listDownloaded", async (_event, modelsDir: string) => listDownloadedModels(modelsDir));

  ipcMain.handle("whisper:isDownloaded", async (_event, modelsDir: string, name: string) =>
    isModelDownloaded(modelsDir, name),
  );

  ipcMain.handle("whisper:download", async (event, modelsDir: string, name: string) => {
    await downloadModel(modelsDir, name, (fraction) => {
      event.sender.send("whisper:downloadProgress", { name, fraction });
    });
  });

  ipcMain.handle("whisper:deleteModel", async (_event, modelsDir: string, name: string) => {
    await deleteModel(modelsDir, name);
  });

  ipcMain.handle(
    "whisper:transcribe",
    async (_event, audioBytes: ArrayBuffer, settings: WhisperSettings): Promise<string> => {
      if (!(await fileExists(settings.binaryPath))) {
        throw new Error(`whisper-server binary not found at "${settings.binaryPath}". Set it in Settings → STT.`);
      }
      const modelPath = join(settings.modelsDir, `ggml-${settings.model}.bin`);
      if (!(await fileExists(modelPath))) {
        throw new Error(`Whisper model not found at "${modelPath}". Download it in Settings → STT.`);
      }

      const tempDir = join(tmpdir(), "yggdrasil-desktop");
      await mkdir(tempDir, { recursive: true });
      const wavPath = join(tempDir, `${randomUUID()}.wav`);
      await writeFile(wavPath, Buffer.from(audioBytes));
      try {
        const server = await ensureWhisperServer(settings.binaryPath, modelPath);
        return await transcribeViaServer(server.port, wavPath, settings.language);
      } finally {
        void unlink(wavPath).catch(() => {});
      }
    },
  );

  ipcMain.handle("stt:getSettings", async (): Promise<SttSettings> => loadSttSettings(app.getPath("userData")));

  ipcMain.handle("stt:saveSettings", async (_event, settings: SttSettings) => {
    await saveSttSettings(app.getPath("userData"), settings);
  });

  ipcMain.handle(
    "stt:transcribeCloud",
    async (_event, audioBytes: ArrayBuffer, settings: SttSettings["cloud"]): Promise<string> =>
      transcribeCloud(Buffer.from(audioBytes), settings),
  );

  ipcMain.handle("tts:getSettings", async (): Promise<TtsSettings> => loadTtsSettings(app.getPath("userData")));

  ipcMain.handle("tts:saveSettings", async (_event, settings: TtsSettings) => {
    await saveTtsSettings(app.getPath("userData"), settings);
  });

  ipcMain.handle(
    "settings:export",
    async (_event, workspaceRoot: string | null, includeSecrets: boolean): Promise<{ path: string } | null> => {
      const result = await dialog.showSaveDialog({
        title: "Export settings",
        defaultPath: "yggdrasil-settings.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePath) return null;
      const desktop = await readSettingsFile(app.getPath("userData"));
      let gateway: Record<string, unknown> | null = null;
      if (workspaceRoot) {
        try {
          gateway = JSON.parse(await readFile(join(workspaceRoot, "yggdrasil.config.json"), "utf8")) as Record<string, unknown>;
        } catch {
          gateway = null;
        }
      }
      await writeFile(
        result.filePath,
        buildExportMarkdown({ desktop, gateway, includeSecrets: Boolean(includeSecrets), exportedAt: new Date() }),
        { encoding: "utf8", mode: 0o600 },
      );
      return { path: result.filePath };
    },
  );

  // Desktop settings are merged here; the gateway part is returned for the
  // renderer to apply through config.patch (hot reload, per-id merge).
  ipcMain.handle(
    "settings:import",
    async (): Promise<{
      path: string;
      desktopKeys: string[];
      gateway: Record<string, unknown> | null;
      warnings: string[];
    } | null> => {
      const result = await dialog.showOpenDialog({
        title: "Import settings",
        properties: ["openFile"],
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const path = result.filePaths[0];
      const parsed = parseImportMarkdown(await readFile(path, "utf8"));
      const incoming = parsed.desktop;
      if (incoming) await updateSettingsFile(app.getPath("userData"), (existing) => deepMerge(existing, incoming));
      return { path, desktopKeys: incoming ? Object.keys(incoming) : [], gateway: parsed.gateway, warnings: parsed.warnings };
    },
  );

  ipcMain.handle("roles:listCustom", async (): Promise<CustomRole[]> => loadCustomRoles(app.getPath("userData")));

  ipcMain.handle(
    "roles:saveCustom",
    async (_event, role: { label: string; summary?: string; systemPrompt: string }): Promise<CustomRole[]> =>
      saveCustomRole(app.getPath("userData"), role),
  );

  ipcMain.handle(
    "roles:deleteCustom",
    async (_event, id: string): Promise<CustomRole[]> => deleteCustomRole(app.getPath("userData"), id),
  );

  ipcMain.handle(
    "flowTemplates:listCustom",
    async (): Promise<CustomFlowTemplate[]> => loadCustomFlowTemplates(app.getPath("userData")),
  );

  ipcMain.handle(
    "flowTemplates:saveCustom",
    async (
      _event,
      template: { label: string; summary?: string; prompt: string },
    ): Promise<CustomFlowTemplate[]> => saveCustomFlowTemplate(app.getPath("userData"), template),
  );

  ipcMain.handle(
    "flowTemplates:deleteCustom",
    async (_event, id: string): Promise<CustomFlowTemplate[]> => deleteCustomFlowTemplate(app.getPath("userData"), id),
  );

  ipcMain.handle("ide:listCatalog", () => IDE_CATALOG.map(({ id, label }) => ({ id, label })));

  ipcMain.handle("ide:detectInstalled", async (): Promise<DetectedIde[]> => detectInstalledIdes());

  // Theme: persisted in desktop-settings.json and broadcast to every window,
  // same shape as projects:setColor.
  ipcMain.handle("theme:get", () => currentTheme);

  const applyTheme = async (next: ThemeSettings): Promise<ThemeSettings> => {
    currentTheme = await saveThemeSettings(app.getPath("userData"), next);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("theme:changed", currentTheme);
    }
    return currentTheme;
  };
  ipcMain.handle("theme:set", (_event, settings: ThemeSettings) => applyTheme(settings));
  ipcMain.handle("theme:reset", () => applyTheme(defaultThemeSettings()));

  // Cross-project workspace: Settings -> Workspace reads/edits links and trust,
  // and the permission prompt answers come back through workspace:answer.
  ipcMain.handle("workspace:view", (_event, projectId: string) => requireWorkspaceBroker().view(projectId));
  ipcMain.handle("workspace:setLink", (_event, projectId: string, targetId: string, linked: boolean) =>
    requireWorkspaceBroker().setLink(projectId, targetId, linked === true),
  );
  ipcMain.handle("workspace:revokeTrust", (_event, key: string) => requireWorkspaceBroker().revokeTrust(String(key)));
  ipcMain.handle("workspace:answer", (_event, id: string, answer: { allow?: boolean; trust?: boolean }) => {
    const finish = pendingWorkspaceAsks.get(id);
    if (!finish) return;
    const allow = answer?.allow === true;
    finish({ allow, trust: allow && answer?.trust === true });
  });

  ipcMain.handle("ide:getSettings", async (): Promise<IdeSettings> => loadIdeSettings(app.getPath("userData")));

  ipcMain.handle("ide:saveSettings", async (_event, settings: IdeSettings) => {
    await saveIdeSettings(app.getPath("userData"), settings);
  });

  // Package bundles (.app on macOS) are directories but should still be
  // pickable as a single "file" here — showOpenDialog's default (not
  // treating them as navigable directories) already does the right thing.
  ipcMain.handle("ide:pickCustomPath", async () => {
    const result = await dialog.showOpenDialog({ title: "Select IDE executable or app", properties: ["openFile"] });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!;
  });

  ipcMain.handle("ide:openProject", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const settings = await loadIdeSettings(app.getPath("userData"));
    return openProjectInIde(project.path, settings);
  });

  ipcMain.handle("ide:openPath", async (_event, projectId: string, relativePath: string) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const settings = await loadIdeSettings(app.getPath("userData"));
    return openProjectInIde(join(project.path, relativePath), settings);
  });

  // "Show in file explorer": folders open themselves, files open their
  // containing folder with the file pre-selected. Confined to the project root.
  ipcMain.handle("ide:revealPath", async (_event, projectId: string, relativePath: string, isDir: boolean) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const root = resolve(project.path);
    const target = resolve(root, relativePath);
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) return { opened: false, error: "Path is outside the project." };
    if (isDir) {
      const err = await shell.openPath(target);
      return err ? { opened: false, error: err } : { opened: true };
    }
    shell.showItemInFolder(target);
    return { opened: true };
  });

  ipcMain.handle("ide:openInBlender", async (_event, projectId: string, relativePath: string) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const root = resolve(project.path);
    const target = resolve(root, relativePath);
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) return { opened: false, error: "Path is outside the project." };
    const settings = await loadIdeSettings(app.getPath("userData"));
    return openInBlender(target, settings);
  });

  ipcMain.handle("ide:detectBlender", async () => {
    const settings = await loadIdeSettings(app.getPath("userData"));
    return locateBlender(settings);
  });

  // Skills registry (Settings → Skills). open/reveal only act on a path that
  // listSkills itself returns, so the renderer can't point them at arbitrary files.
  ipcMain.handle("skills:list", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return [];
    return listSkills(project.path, homedir());
  });

  ipcMain.handle("skills:open", async (_event, projectId: string, skillPath: string, reveal: boolean) => {
    const project = await getProject(projectId);
    if (!project) return { opened: false, error: "Project not found." };
    const known = (await listSkills(project.path, homedir())).some((s) => s.path === skillPath);
    if (!known) return { opened: false, error: "Unknown skill." };
    if (reveal) {
      shell.showItemInFolder(skillPath);
      return { opened: true };
    }
    const err = await shell.openPath(skillPath);
    return err ? { opened: false, error: err } : { opened: true };
  });

  ipcMain.handle("skills:create", async (_event, projectId: string, name: string, description: string) => {
    const project = await getProject(projectId);
    if (!project) return { ok: false as const, error: "Project not found." };
    try {
      const { path } = await createProjectSkill(project.path, String(name ?? "").trim(), String(description ?? ""));
      return { ok: true as const, path };
    } catch (err) {
      if (err instanceof SkillCreateError) return { ok: false as const, error: err.message };
      throw err;
    }
  });

  // Automation settings (workflows-design.md §6.4/§8.2) — permission status
  // reads straight from the same adapter paneControlServer's /desktop/*
  // routes use (getDesktopAutomationAdapter is a stateless singleton), no
  // loopback HTTP hop needed since this IS the Electron main process.
  ipcMain.handle("automation:getPermissions", async () => getDesktopAutomationAdapter().getPermissions());
  ipcMain.handle("automation:requestPermission", async (_event, kind: PermissionKind) => {
    await getDesktopAutomationAdapter().requestPermission(kind);
  });
  ipcMain.handle("automation:getSettings", async (): Promise<AutomationSettings> => loadAutomationSettings(app.getPath("userData")));
  ipcMain.handle("automation:saveSettings", async (_event, settings: AutomationSettings) => {
    await saveAutomationSettings(app.getPath("userData"), settings);
  });

  ipcMain.handle("sync:getSettings", async (): Promise<SyncSettings> => loadSyncSettings(app.getPath("userData")));

  ipcMain.handle("sync:saveSettings", async (_event, settings: SyncSettings) => {
    await saveSyncSettings(app.getPath("userData"), settings);
  });

  ipcMain.handle("sync:createShare", (_event, ref: ResourceRef) => {
    const { resourceType, ...local } = ref;
    return createShareForResource(resourceType, resourceKeyFor(ref), local);
  });

  ipcMain.handle(
    "sync:createInvite",
    (_event, ref: ResourceRef, role: "edit" | "view", expiresInHours?: number) =>
      createInviteForResource(resourceKeyFor(ref), role, expiresInHours),
  );

  ipcMain.handle("sync:redeemInvite", (_event, code: string, memberName: string, ref: ResourceRef) => {
    const { resourceType: _resourceType, ...local } = ref;
    return redeemInviteAndAttach(code, memberName, local);
  });

  ipcMain.handle("sync:listMyShares", () => listMySyncShares());

  ipcMain.handle("sync:getResourceStatus", (_event, ref: ResourceRef) => getResourceStatus(resourceKeyFor(ref)));

  ipcMain.handle("sync:push", (_event, ref: ResourceRef) => pushResource(resourceKeyFor(ref)));

  ipcMain.handle("sync:pull", (_event, ref: ResourceRef) => pullResource(resourceKeyFor(ref)));

  ipcMain.handle(
    "sync:resolveConflict",
    (_event, ref: ResourceRef, choice: "keep-mine" | "take-theirs") => resolveSyncConflict(resourceKeyFor(ref), choice),
  );

  ipcMain.handle("sync:createWebLink", (_event, ref: ResourceRef, email: string, role: "edit" | "view") =>
    createWebLinkForResource(resourceKeyFor(ref), email, role),
  );

  ipcMain.handle("sync:listMembers", (_event, ref: ResourceRef) => listMembersForResource(resourceKeyFor(ref)));

  ipcMain.handle("sync:revokeMember", (_event, ref: ResourceRef, memberKeyHash: string) =>
    revokeMemberForResource(resourceKeyFor(ref), memberKeyHash),
  );

  ipcMain.handle("sync:refreshWebBundle", (_event, ref: ResourceRef) => refreshWebBundle(resourceKeyFor(ref)));
}
  ipcMain.handle("dialog:openDirectory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

app.whenReady().then(async () => {
  // Must land before any project opens — Agent Flow/terminal spawns
  // (terminals.ts) exec CLIs directly with no shell in between, so they only
  // see whatever PATH this process has at spawn time.
  process.env.PATH = resolveShellPath();
  installAboutMenu();
  installAutoUpdater();
  registerIpc();
  registerTerminalIpc(
    (projectId) => projectWindows.get(projectId)?.window,
    (projectId) => projectWindows.get(projectId)?.gateway.url,
  );
  registerPluginProtocol((id) => getProject(id));
  registerFileProtocol((id) => getProject(id));
  await ensurePluginDirs();
  // Never closed — lives for the app's whole lifetime, same as the process
  // itself; nothing meaningful to clean up on quit.
  watchPluginsDir(globalPluginsDir(), (pluginId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "global", pluginId });
    }
  });

  currentTheme = await loadThemeSettings(app.getPath("userData"));
  workspaceBroker = await createWorkspaceBroker({
    userDataDir: app.getPath("userData"),
    listProjects: async () => (await listProjects()).map((p) => ({ id: p.id, name: p.name })),
    paneApi: (id) => {
      const entry = projectWindows.get(id);
      if (!entry || entry.window.isDestroyed()) return undefined;
      return {
        listPanes: entry.paneControl.listPanes,
        readPane: entry.paneControl.readPane,
        writePane: (paneId, text, pressEnter) => entry.paneControl.writePane(paneId, text, pressEnter),
      };
    },
    ask: askWorkspace,
    notify: (projectId, notice) => {
      const win = projectWindows.get(projectId)?.window;
      if (win && !win.isDestroyed()) win.webContents.send("workspace:notice", notice);
    },
  });
  await resetOpenGateways();
  registerPhoneLinkIpc();
  startPhoneLink();
  const defaultProject = await upsertProject({ path: defaultWorkspaceRoot(), name: "Default Workspace" });
  defaultProjectId = defaultProject.id;
  try {
    await openProject(defaultProject);
  } catch (error) {
    // Without this, a rejection here (e.g. the gateway subprocess never
    // becoming ready) leaves the app running with zero windows and no
    // taskbar/dock presence — indistinguishable from a silent crash, with
    // the actual reason visible only in main-crashes.log (see
    // crashLogging.ts) or a terminal the user may not have open.
    console.error("[main] failed to open default project", error);
    logCaughtError("openProject(default)", error);
    dialog.showErrorBox(
      "Yggdrasil failed to start",
      `${error instanceof Error ? error.message : String(error)}\n\nSee ${logPath()} for details.`,
    );
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void openProject(defaultProject);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitDrained = false;
app.on("before-quit", (event) => {
  if (quitDrained) return;
  // Hold the quit until every pty has really exited — see
  // disposeAllTerminalsAndWait (node-pty aborts if an exit lands mid-teardown).
  event.preventDefault();
  quitDrained = true;
  void stopPhoneLink(); // best effort: mark this desktop offline in the hub right away
  for (const { gateway, paneControl } of projectWindows.values()) {
    gateway.shutdown();
    paneControl.shutdown();
  }
  stopWhisperServer();
  void disposeAllTerminalsAndWait().finally(() => app.quit());
});
