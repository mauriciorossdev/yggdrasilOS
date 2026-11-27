import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { cp, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type WebContents } from "electron";
import { ensureGateway, type GatewayHandle } from "./gateway.js";
import {
  getProject,
  listProjects,
  registryPath,
  removeProject,
  renameProject,
  setProjectColor,
  touchProject,
  upsertProject,
  type ProjectRecord,
} from "./projects.js";
import {
  disposeAllTerminalsAndWait,
  disposeTerminalsForProject,
  registerTerminalIpc,
  setAttentionHooks,
  setSubmitGate,
  submitToTerminal,
} from "./terminals.js";
import { openGatewaysPath, registerOpenGateway, resetOpenGateways, unregisterOpenGateway } from "./openGateways.js";
import { gatewayAuthForNewProject, notifyPhoneLinkChanged, registerPhoneLinkIpc, startPhoneLink, stopPhoneLink } from "./phoneLink.js";
import { readAgentFlow, writeAgentFlow, type AgentFlow } from "./agentFlow.js";
import { readAgentTeams, saveAgentTeam, deleteAgentTeam, renameAgentTeam, type AgentTeam } from "./agentTeams.js";
import { readDocumentTabs, writeDocumentTabs, type DocumentTabsLayout } from "./documentTabs.js";
import { importExternalPaths } from "./fileImport.js";
import { resolveTerminalPath } from "./pathResolve.js";
import { readClipboardFilePaths, writeClipboardFilePaths } from "./clipboardFiles.js";
import { classifyPickedPaths } from "./pickedAttachments.js";
import { copyPathFor, createDeckFile, createDocFile, createSheetFile, loadDeck, loadDoc, loadSheetSnapshot, saveDeck, saveDoc, saveSheetSnapshot, setSheetBaseline } from "./officeFiles.js";
import { MAX_ASSET_BYTES, isImageName, sanitizeAssetName, uniqueAssetName } from "./noteAssets.js";
import { startPaneControlServer, type CreatePaneSpec, type PaneControlHandle } from "./paneControlServer.js";
import {
  createWorkspaceBroker,
  WorkspaceError,
  type AskAnswer,
  type AskRequest,
  type WorkspaceAction,
  type WorkspaceBroker,
  type WorkspaceZone,
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
  trustYggdrasilMcpServer,
  writeYggdrasilMcpConfig,
  seedMemoryGuidance,
  seedPaneControlGuidance,
  seedPluginsGuidance,
  seedWorkflowsGuidance,
} from "./mcpConfig.js";
import { indexPluginStorageOnWrite, reindexAllPluginStorage } from "./pluginStorageIndex.js";
import { closeMemoryDb } from "@yggdrasil/context-memory-db";
import { getGithubAccount } from "@yggdrasil/tool-github";
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
import { buildExportMarkdown, deepMerge, parseImportMarkdown, withGlobalProviders } from "./settingsTransfer.js";
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
import { loadEditorSettings, saveEditorSettings, type EditorSettings } from "./editorSettings.js";
import {
  isCavemanInstalled,
  readUserMcpServers,
  loadClaudePaneSettings,
  saveClaudePaneSettings,
  setAttentionBridgeCommand,
  attentionEnabled,
  currentAttentionSettings,
  type ClaudePaneSettings,
} from "./claudePaneSettings.js";
import {
  disposeAttention,
  installAttention,
  paneAttentionStatus,
  reportAttention,
  reportPaneInput,
  setQueueHooks,
} from "./attentionHost.js";
import {
  disposeQueues,
  dropPane as dropPaneQueue,
  gateSubmit,
  installPaneQueue,
  onInterrupt as queueInterrupt,
  onTurnEnd as queueTurnEnd,
} from "./paneQueueHost.js";
import { installLspIpc } from "./lsp/ipc.js";
import { installDashboardIpc } from "./dashboardIpc.js";
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
import { createBrowserTabView, scaleBrowserTabBounds, type BrowserTabBounds, type BrowserTabHandle } from "./browserTabView.js";
import { createBrowserCommentsHost, type CommentProvider } from "./browserCommentsHost.js";
import { writeCaptureBundle } from "./browserCaptureStore.js";
import { createCodeCommentsHost, type CodeCommentsHost } from "./codeCommentsHost.js";
import {
  addStoredCodeComment,
  clearDoneStoredCodeComments,
  dropStoredRepoCodeComments,
  listStoredCodeComments,
  removeStoredCodeComment,
  setStoredCodeCommentsStatus,
  updateStoredCodeComment,
} from "./codeCommentsStore.js";
import {
  addBrowserComment,
  listBrowserComments,
  removeBrowserComment,
  setBrowserCommentsStatus,
  updateBrowserComment,
} from "./browserCommentsStore.js";
import { scanLocalPorts } from "./localPorts.js";
import {
  deletePlugin,
  ensurePluginDirs,
  globalPluginsDir,
  lintPluginPermissions,
  listPluginFiles,
  projectPluginsDir,
  scaffoldPlugin,
  scanPlugins,
  setPluginStatus,
  updatePluginManifest,
  watchPluginsDir,
  type PluginManifestPatch,
  type PluginScope,
  type PluginStatus,
  type ScaffoldPluginSpec,
} from "./plugins.js";
import { forwardPluginFrameErrors, registerPluginProtocol } from "./pluginProtocol.js";
import { registerFileProtocol } from "./fileProtocol.js";
import { locateBlender, openInBlender } from "./blender.js";
import { createProjectSkill, listSkills, SkillCreateError } from "./skills.js";
import { pluginStorageDelete, pluginStorageGet, pluginStorageKeys, pluginStorageSet } from "./pluginStorage.js";
import { readPluginTabs, writePluginTabs, type PluginTabsLayout } from "./pluginTabs.js";
import { PLUGIN_API_DOCS } from "./pluginApiDocs.js";
import { installCrashLogging, logCaughtError, logPath } from "./crashLogging.js";
import { startSystemMonitor, stopSystemMonitor } from "./systemMonitor.js";
import { detectClis, CLI_CATALOG } from "./cliDetect.js";
import { detectOllama } from "./ollamaDetect.js";
import {
  hasExistingConfig,
  loadOnboardingSettings,
  saveOnboardingSettings,
  shouldAutoOpenOnboarding,
  type OnboardingSettings,
} from "./onboardingSettings.js";
import { advance, bootReady, failBoot, finishStage, initialBoot, openedSnapshot, resetForRetry, toWire, type BootSnapshot, type BootStageId } from "./bootState.js";
import { resolveShellPathAsync } from "./resolveShellPath.js";
import { installAboutMenu } from "./aboutPanel.js";
import { mt, resolveMainLanguage, setMainLanguage, type MainMessageKey } from "./i18n.js";
import { GitCloneError, cloneGitRepo, parseGitUrl, validateCloneFolderName, type GitCloneErrorCode } from "./gitClone.js";
import { installAutoUpdater } from "./autoUpdate.js";
import { installUpdateCheck } from "./updateCheck.js";

// Dev/testing escape hatch: run a second, isolated instance next to the installed app
// (userData also scopes the single-instance lock below). Not set in normal use.
if (process.env.YGG_USER_DATA_DIR) app.setPath("userData", process.env.YGG_USER_DATA_DIR);


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
// terminals spawn, etc). Dev-checkout
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
//
// On macOS the app outlives its last window (see window-all-closed), so the
// instance holding the lock may have no windows at all; a plain relaunch then
// reopens the default project (same as clicking the dock icon, see "activate")
// instead of silently doing nothing.
let reopenDefaultWindow: (() => void) | undefined; // set once startup has opened the default project
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
    } else if (!url) {
      // A deep link opens its own window (open-project) or needs none.
      reopenDefaultWindow?.();
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
  /** The project's folder. */
  root: string;
  gateway: GatewayHandle;
  paneControl: PaneControlHandle;
  /** Lazily created on first use (browser_open, or the user switching to the Browser tab) — most projects never touch it. */
  browserTab?: BrowserTabHandle;
  /** Watches this project's own .yggdrasil/plugins/ dir — see plugins.ts's watchPluginsDir. Closed alongside the window. */
  pluginWatcher?: { close(): void };
  /** Watches this project's notes/ dir for shared-file changes — see notesWatcher.ts. Closed alongside the window. */
  notesWatcher?: { close(): void };
  /** The finished boot progress, so a reload (boot:get) still shows it and reconnects. */
  boot?: BootSnapshot;
};

/**
 * A project window that exists but whose gateway isn't up yet (window-first
 * boot, see bootState.ts). Records each resource as it's created so a window
 * closed mid-boot, a failure, or a quit can release exactly what exists.
 */
type BootingProject = {
  project: ProjectRecord;
  window: BrowserWindow;
  snapshot: BootSnapshot;
  paneControl?: PaneControlHandle;
  gateway?: GatewayHandle;
  registered: boolean;
  /** Settles when this boot attempt finishes (resolves on success or a closed window, rejects on failure). */
  done: Promise<void>;
  /** App startup work to run first, as live stages (the launch window only); cleared once it has run. */
  prelude?: LaunchPrelude;
};
/** Startup work the first window shows as its own stages: call `stage(id)` as each part begins. */
type LaunchPrelude = (stage: (id: BootStageId) => void) => Promise<void>;
const bootingProjects = new Map<string, BootingProject>();

/**
 * Resolves when the launch prelude (shell PATH, plugins, workspace broker, open-gateways reset) has run.
 * Any other project opening (a yggdrasil:// deep link on a cold start, a second instance) waits on it, so its
 * gateway never starts with the bare LaunchServices PATH or gets its open-gateways entry wiped by the reset.
 */
let markStartupDone: () => void = () => {};
const startupDone = new Promise<void>((resolve) => {
  markStartupDone = resolve;
});

/** A boot failure the window is already showing (with Retry): callers log it instead of opening a dialog. */
class BootShownInWindow extends Error {}

/** One dedicated gateway process + window per open project, keyed by project id. */
const projectWindows = new Map<string, OpenProjectWindow>();

/** Set when IPC is installed; language servers per project window. */
let lspIpc: ReturnType<typeof installLspIpc> | undefined;

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

/** Same request/response pair for in-app editors (spreadsheets today): an office tool call → "editors:request" to the project's window → "editors:reply" back. */
const pendingEditorCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; webContentsId: number }>();

/**
 * Cross-project workspace (notes/features/cross-project-workspace.md). The broker
 * is the only code that reaches from one project's panes into another's; an
 * agent's request pauses here until the human answers the prompt shown in the
 * *caller's* window (`workspace:ask` -> `workspace:answer`), or the timeout
 * counts as a denial.
 */
let workspaceBroker: WorkspaceBroker | undefined;
/** Launch-prelude work that must run once even if a Retry reruns the prelude. */
let globalPluginsWatcher: { close(): void } | undefined;
let phoneLinkStarted = false;
const pendingWorkspaceAsks = new Map<string, (answer: AskAnswer) => void>();
const WORKSPACE_ASK_TIMEOUT_MS = 120_000;

/** Tells every window the cross-project workspace changed (links, trust, layout, audit, or which projects are open). */
function broadcastWorkspaceChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("workspace:changed");
  }
}

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

function yggdrasilShimPath(): string {
  // The single MCP server every claude session connects to — built as its own
  // bundle alongside index.js, see electron.vite.config.ts.
  return join(__dirname, "yggdrasilMcpShim.js");
}

function statuslineBridgePath(): string {
  // Built as its own bundle alongside index.js — see electron.vite.config.ts.
  return join(__dirname, "statuslineBridge.js");
}

function attentionBridgePath(): string {
  // Same: its own bundle, run by the attention hooks of every claude pane (claudePaneSettings.ts).
  return join(__dirname, "attentionBridge.js");
}

function pushBoot(b: BootingProject): void {
  if (!b.window.isDestroyed()) b.window.webContents.send("boot:update", toWire(b.snapshot));
}

function setBoot(b: BootingProject, f: (s: BootSnapshot) => BootSnapshot): void {
  b.snapshot = f(b.snapshot);
  pushBoot(b);
}

/** Releases whatever this boot attempt had started (gateway subprocess, pane-control server, open-gateways entry). */
function abortBoot(b: BootingProject): void {
  b.gateway?.shutdown();
  b.paneControl?.shutdown();
  if (b.registered) void unregisterOpenGateway(b.project.id).then(notifyPhoneLinkChanged);
  b.gateway = undefined;
  b.paneControl = undefined;
  b.registered = false;
}

/** The boot snapshot for whichever project window sent a request (booting, or already open after a reload). */
function bootSnapshotForSender(sender: WebContents): BootSnapshot | null {
  for (const b of bootingProjects.values()) if (!b.window.isDestroyed() && b.window.webContents === sender) return toWire(b.snapshot);
  for (const e of projectWindows.values()) {
    if (e.window.isDestroyed() || e.window.webContents !== sender) continue;
    const gateway = { url: e.gateway.url, lanUrl: e.gateway.lanUrl };
    return e.boot ? toWire({ ...e.boot, gateway }) : openedSnapshot(gateway);
  }
  return null;
}

function createProjectBrowserWindow(project: ProjectRecord): BrowserWindow {
  // No gateway URL here: the window opens before its gateway exists and gets it through boot:get/boot:update.
  const additionalArguments = [
    `--ygg-project-id=${project.id}`,
    `--ygg-project-name=${project.name}`,
    `--ygg-project-path=${project.path}`,
    `--ygg-project-color=${project.color ?? ""}`,
    `--ygg-theme=${JSON.stringify(currentTheme)}`,
    `--ygg-default-project-id=${defaultProjectId ?? ""}`,
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
    title: `Yggdrasil - ${project.name}`,
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
  forwardPluginFrameErrors(win.webContents);
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
    // Closed while still booting: release what the boot had started (runBoot sees the window gone and stops).
    const booting = bootingProjects.get(project.id);
    if (booting?.window === win) {
      abortBoot(booting);
      bootingProjects.delete(project.id);
    }
    const entry = projectWindows.get(project.id);
    if (entry?.window === win) {
      entry.gateway.shutdown();
      entry.paneControl.shutdown();
      entry.browserTab?.destroy();
      entry.pluginWatcher?.close();
      entry.notesWatcher?.close();
      disposeTerminalsForProject(project.id);
      disposeAttention(project.id);
      disposeQueues(project.id);
      void lspIpc?.stopProject(project.id);
      projectWindows.delete(project.id);
      broadcastWorkspaceChanged();
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

/** Closes a project's window (if open) and waits for its "closed" cleanup, so watchers/terminals/sqlite handles are released before the folder is touched. */
async function closeProjectWindow(projectId: string): Promise<void> {
  const entry = projectWindows.get(projectId);
  if (!entry || entry.window.isDestroyed()) return;
  const closed = new Promise<void>((res) => entry.window.once("closed", () => res()));
  entry.window.close();
  await closed;
}

/** Lazily creates this project's Browser-tab WebContentsView on first use (navigate, or switching to the tab) — undefined only if the project's window is already gone. */
function resolveBrowserTab(projectId: string): BrowserTabHandle | undefined {
  const entry = projectWindows.get(projectId);
  if (!entry || entry.window.isDestroyed()) return undefined;
  if (!entry.browserTab) entry.browserTab = createBrowserTabView(entry.window, createCommentsHost(projectId));
  return entry.browserTab;
}

/** Launchable CLIs per project, pushed by the renderer (it owns the enabled-CLIs setting) — the Browser comments "New agent" popover lists these. */
const commentProviders = new Map<string, CommentProvider[]>();
/** Pane titles per project as the renderer's Terminal tab shows them (paneControl lists a UI-created pane by its raw id). */
const commentPaneTitles = new Map<string, Record<string, string>>();

function createCommentsHost(projectId: string) {
  const pc = () => projectWindows.get(projectId)?.paneControl;
  const needPc = () => {
    const handle = pc();
    if (!handle) throw new Error("project window is not open");
    return handle;
  };
  return createBrowserCommentsHost({
    store: {
      list: (pageUrl) => listBrowserComments(projectId, pageUrl),
      add: (input) => addBrowserComment(projectId, input),
      update: (pageUrl, id, text) => updateBrowserComment(projectId, pageUrl, id, text),
      remove: (pageUrl, id) => removeBrowserComment(projectId, pageUrl, id),
      setStatus: async (ids, status, sentTo) => {
        const changed = await setBrowserCommentsStatus(projectId, ids, status, sentTo);
        projectWindows.get(projectId)?.browserTab?.refreshComments();
        return changed;
      },
    },
    panes: {
      list: async () => {
        const titles = commentPaneTitles.get(projectId) ?? {};
        return (await needPc().listPanes()).panes.map((p) => ({ id: p.id, title: titles[p.id] || p.title, command: p.command }));
      },
      create: (spec) => needPc().createPane(spec),
      write: (id, text, pressEnter) => needPc().writePane(id, text, pressEnter, undefined, { source: { kind: "browser" } }),
      read: (id, maxChars) => pc()?.readPane(id, maxChars),
    },
    captures: {
      write: async (fileName, content) => {
        const project = await getProject(projectId);
        if (!project) throw new Error("project not found");
        return writeCaptureBundle(project.path, fileName, content);
      },
    },
    providers: () => commentProviders.get(projectId) ?? [],
  });
}

/** Review comments on code, per project (notes/features/code-review-comments.md). */
const codeCommentsHosts = new Map<string, CodeCommentsHost>();

function codeCommentsHostFor(projectId: string): CodeCommentsHost {
  const existing = codeCommentsHosts.get(projectId);
  if (existing) return existing;
  const needPc = () => {
    const handle = projectWindows.get(projectId)?.paneControl;
    if (!handle) throw new Error("project window is not open");
    return handle;
  };
  const host = createCodeCommentsHost({
    projectPath: async () => {
      const root = projectWindows.get(projectId)?.root ?? (await getProject(projectId))?.path;
      if (!root) throw new Error("project not found");
      return root;
    },
    store: {
      list: (root) => listStoredCodeComments(projectId, root),
      add: (root, input) => addStoredCodeComment(projectId, root, input),
      update: (root, id, text) => updateStoredCodeComment(projectId, root, id, text),
      remove: (root, id) => removeStoredCodeComment(projectId, root, id),
      clearDone: (root) => clearDoneStoredCodeComments(projectId, root),
      dropRoot: (root) => dropStoredRepoCodeComments(projectId, root),
      setStatus: (ids, status, sentTo) => setStoredCodeCommentsStatus(projectId, ids, status, sentTo),
    },
    panes: {
      list: async () => {
        const titles = commentPaneTitles.get(projectId) ?? {};
        return (await needPc().listPanes()).panes.map((p) => ({ id: p.id, title: titles[p.id] || p.title, command: p.command, cwd: p.cwd }));
      },
      create: (spec) => needPc().createPane(spec),
      write: (id, text, pressEnter) => needPc().writePane(id, text, pressEnter, undefined, { source: { kind: "review" } }),
      read: (id, maxChars) => projectWindows.get(projectId)?.paneControl.readPane(id, maxChars),
    },
    providers: () => commentProviders.get(projectId) ?? [],
    changed: (root) => {
      const win = projectWindows.get(projectId)?.window;
      if (win && !win.isDestroyed()) win.webContents.send("codeComments:changed", root);
    },
  });
  codeCommentsHosts.set(projectId, host);
  return host;
}

/** Like resolveBrowserTab, for operations that can't proceed without a window. */
function requireBrowserTab(projectId: string): BrowserTabHandle {
  const tab = resolveBrowserTab(projectId);
  if (!tab) throw new Error("project window is not open");
  return tab;
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

const CLONE_ERROR_KEYS: Record<GitCloneErrorCode, MainMessageKey> = {
  emptyUrl: "clone.emptyUrl",
  invalidUrl: "clone.invalidUrl",
  unsupportedProtocol: "clone.unsupportedProtocol",
  invalidFolder: "clone.invalidFolder",
  targetExists: "clone.targetExists",
  gitMissing: "clone.gitMissing",
  timeout: "clone.timeout",
  cloneFailed: "clone.failed",
};

/**
 * Home → "Clone repository": git clone <url> into <parentDir>/<folderName>
 * (default ~/Yggdrasil/<repo>), then register and open it like "Open folder".
 * Used by both the GitHub tab (repo.cloneUrl) and the paste-a-URL tab. The
 * stored GitHub token, if any, authenticates github.com HTTPS (private repos).
 */
async function cloneRepoAsProject(params: { url: string; parentDir?: string; folderName?: string }): Promise<ProjectRecord> {
  try {
    const url = parseGitUrl(params.url ?? "");
    const folder = validateCloneFolderName(params.folderName?.trim() || url.defaultFolder);
    const parentDir = params.parentDir?.trim() || remoteProjectsRoot();
    if (!isAbsolute(parentDir)) throw new Error(mt("clone.parentNotAbsolute"));
    const target = join(parentDir, folder);
    const taken =
      (await stat(target).then(() => true, () => false)) || (await listProjects()).some((p) => p.path === target);
    if (taken) throw new GitCloneError("targetExists", target);
    await mkdir(parentDir, { recursive: true });
    const githubToken = url.githubHttps ? ((await getGithubAccount())?.accessToken ?? null) : null;
    await cloneGitRepo({ url, target, githubToken });
    const project = await upsertProject({ path: target, name: folder });
    await openProject(project);
    return project;
  } catch (err) {
    if (err instanceof GitCloneError) throw new Error(mt(CLONE_ERROR_KEYS[err.code], { detail: err.detail }));
    throw err;
  }
}

async function openProject(project: ProjectRecord, prelude?: LaunchPrelude): Promise<void> {
  try {
    await openProjectUnsafe(project, prelude);
  } catch (err) {
    console.error(`[openProject] failed for ${project.path}:`, err);
    if (err instanceof BootShownInWindow) throw err; // the window shows it, with Retry
    dialog.showErrorBox(mt("project.openFailed"), err instanceof Error ? (err.stack ?? err.message) : String(err));
    throw err;
  }
}

async function openProjectUnsafe(project: ProjectRecord, prelude?: LaunchPrelude): Promise<void> {
  await app.whenReady(); // open-url can arrive before the app is ready; windows can't exist before that
  const existing = projectWindows.get(project.id);
  if (existing && !existing.window.isDestroyed()) {
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.focus();
    return;
  }
  // Already booting (a second click, a deep link): bring that window up instead of starting a second gateway.
  const booting = bootingProjects.get(project.id);
  if (booting && !booting.window.isDestroyed()) {
    if (booting.window.isMinimized()) booting.window.restore();
    booting.window.focus();
    return booting.done;
  }

  // Window first: it shows right away and boots inside (renderer/src/boot/), instead of the user
  // waiting on nothing while the gateway starts.
  const win = createProjectBrowserWindow(project);
  const b: BootingProject = {
    project,
    window: win,
    snapshot: initialBoot(prelude ? "launch" : "project"),
    registered: false,
    done: Promise.resolve(),
    prelude,
  };
  bootingProjects.set(project.id, b);
  b.done = runBoot(b);
  return b.done;
}

/** Runs one boot attempt for a booting window; a failure is shown in the window (with Retry) and rethrown as BootShownInWindow. */
async function runBoot(b: BootingProject): Promise<void> {
  try {
    await bootSteps(b);
  } catch (err) {
    abortBoot(b);
    if (b.window.isDestroyed() || bootingProjects.get(b.project.id) !== b) return;
    const message = err instanceof Error ? err.message : String(err);
    setBoot(b, (s) => failBoot(s, { message }));
    throw new BootShownInWindow(message);
  }
}

async function bootSteps(b: BootingProject): Promise<void> {
  const { project, window: win } = b;
  // The window can close at any await below: then release what exists and stop.
  const gone = () => win.isDestroyed() || bootingProjects.get(project.id) !== b;
  const next = (to: BootStageId) => setBoot(b, (s) => advance(s, to, Date.now()));

  if (b.prelude) {
    try {
      await b.prelude(next);
    } finally {
      markStartupDone(); // never leave other windows waiting, even if startup failed
    }
    b.prelude = undefined; // ran once; a Retry starts from the project's own stages
    if (gone()) return;
  }
  next("folder");
  await startupDone; // a window opened during launch (deep link) waits here, shown as preparing its folder
  if (gone()) return;
  await mkdir(project.path, { recursive: true });
  await ensurePluginDirs(project.path);
  if (gone()) return;
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
      commentDone: async (id) => {
        const changed = await setBrowserCommentsStatus(project.id, [id], "done");
        projectWindows.get(project.id)?.browserTab?.refreshComments();
        return changed;
      },
      readPage: (maxChars) => requireBrowserTab(project.id).readPage(maxChars),
      extract: (opts) => requireBrowserTab(project.id).extract(opts),
      fetchAsset: (input) => requireBrowserTab(project.id).fetchAsset(input),
      screenshot: () => requireBrowserTab(project.id).screenshot(),
      click: (selector) => requireBrowserTab(project.id).click(selector),
      type: (selector, text, submit) => requireBrowserTab(project.id).type(selector, text, submit),
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
    {
      call: (kind, op, params) => {
        const win = projectWindows.get(project.id)?.window;
        if (!win || win.isDestroyed()) return Promise.reject(new Error("The project window is not open"));
        const callId = randomUUID();
        return new Promise((resolve, reject) => {
          const contents = win.webContents;
          const settle = () => {
            clearTimeout(timer);
            contents.removeListener("did-start-loading", gone);
            contents.removeListener("destroyed", gone);
          };
          // A reload or close drops the renderer's editors: fail now instead of leaving the agent waiting.
          const gone = () => {
            if (!pendingEditorCalls.delete(callId)) return;
            settle();
            reject(new Error("The project window was reloaded or closed before the editor answered"));
          };
          const timer = setTimeout(() => {
            pendingEditorCalls.delete(callId);
            settle();
            reject(new Error("The editor did not answer in time"));
          }, 40_000);
          pendingEditorCalls.set(callId, {
            resolve: (v) => (settle(), resolve(v)),
            reject: (e) => (settle(), reject(e)),
            webContentsId: contents.id,
          });
          contents.once("did-start-loading", gone);
          contents.once("destroyed", gone);
          contents.send("editors:request", { callId, kind, op, params });
        });
      },
    },
    (paneId, event) => reportAttention(project.id, paneId, event),
    { commentDone: (id) => codeCommentsHostFor(project.id).setStatus([id], "done") },
  );
  b.paneControl = paneControl;
  if (gone()) return abortBoot(b);
  next("gateway");
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
  b.gateway = gateway;
  if (gone()) return abortBoot(b); // the window closed while the gateway was starting: don't leave it running
  await registerOpenGateway(project.id, gateway.port);
  b.registered = true;
  notifyPhoneLinkChanged();
  if (gone()) return abortBoot(b);
  next("agents");
  const { staleApprovals } = await writeYggdrasilMcpConfig(
    project.path,
    yggdrasilShimPath(),
    paneControl.url,
    paneControl.token,
    gateway.url,
  );
  await trustYggdrasilMcpServer(project.path, staleApprovals);
  await seedPaneControlGuidance(project.path);
  await seedDocumentsGuidance(project.path);
  await seedPluginsGuidance(project.path);
  await seedMemoryGuidance(project.path);
  await seedWorkflowsGuidance(project.path);
  await writeStatuslineConfig(project.path, statuslineBridgePath(), paneControl.url, paneControl.token);
  if (gone()) return abortBoot(b);
  // Fire-and-forget — pre-existing plugin data (installed before this
  // integration shipped, or from a plugin the user hasn't touched since
  // opening this project) becomes searchable without waiting on its next
  // write. Small JSON files, cheap even on a slow disk.
  void reindexAllPluginStorage(project.path, project.id).catch((err) => {
    console.error(`[pluginStorageIndex] initial reindex failed for ${project.id}:`, err);
  });
  const pluginWatcher = watchPluginsDir(projectPluginsDir(project.path), (pluginId) => {
    if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "project", pluginId });
  });
  const notesWatcher = watchNotesDir(notesAbsoluteDir(project.path), project.id);
  // Main's part is done: hand the gateway to the renderer, which finishes the "connect" stage itself.
  const boot = bootReady(finishStage(b.snapshot, "agents", Date.now()), { url: gateway.url, lanUrl: gateway.lanUrl }, Date.now());
  bootingProjects.delete(project.id);
  projectWindows.set(project.id, { window: win, root: project.path, gateway, paneControl, pluginWatcher, notesWatcher, boot });
  win.setTitle(`Yggdrasil - ${project.name} - ${gateway.lanUrl}`);
  win.webContents.send("boot:update", toWire(boot));
  broadcastWorkspaceChanged();
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
  // Window-first boot (bootState.ts): the current progress for the asking window, and Retry after a failure.
  ipcMain.handle("boot:get", (event) => bootSnapshotForSender(event.sender));
  ipcMain.handle("boot:retry", (event) => {
    for (const b of bootingProjects.values()) {
      if (b.window.isDestroyed() || b.window.webContents !== event.sender || !b.snapshot.error) continue;
      setBoot(b, resetForRetry);
      b.done = runBoot(b).catch((err) => console.error(`[boot] retry failed for ${b.project.path}:`, err));
      return true;
    }
    return false;
  });
  // The setup wizard takes the whole screen while it's open, then hands back whatever state the window had.
  const fullScreenBefore = new WeakMap<BrowserWindow, boolean>();
  ipcMain.handle("window:setFullScreen", (event, on: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (on) {
      if (!fullScreenBefore.has(win)) fullScreenBefore.set(win, win.isFullScreen());
      win.setFullScreen(true);
    } else if (fullScreenBefore.has(win)) {
      win.setFullScreen(fullScreenBefore.get(win) === true);
      fullScreenBefore.delete(win);
    }
  });
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
  // Address-bar navigation: URL-or-search, errors land in browserTab:state
  // rather than rejecting here (agent-driven browser_open keeps the strict
  // `navigate` above).
  ipcMain.handle("browserTab:go", async (_event, projectId: string, input: string) => {
    await resolveBrowserTab(projectId)?.go(input);
  });
  ipcMain.handle("browserTab:newTab", async (_event, projectId: string, input?: string) => {
    return (await resolveBrowserTab(projectId)?.newTab(input)) ?? null;
  });
  ipcMain.handle("browserTab:closeTab", (_event, projectId: string, id: string) => {
    projectWindows.get(projectId)?.browserTab?.closeTab(id);
  });
  ipcMain.handle("browserTab:activateTab", (_event, projectId: string, id: string) => {
    projectWindows.get(projectId)?.browserTab?.activateTab(id);
  });
  ipcMain.handle("browserTab:toggleDevTools", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.toggleDevTools();
  });
  ipcMain.handle("browserTab:zoom", (_event, projectId: string, direction: "in" | "out" | "reset") => {
    projectWindows.get(projectId)?.browserTab?.zoom(direction);
  });
  ipcMain.handle("browserTab:showDownload", (_event, projectId: string, path: string) => {
    projectWindows.get(projectId)?.browserTab?.showDownload(path);
  });
  // Which common dev-server ports are listening on this machine (the empty
  // Browser tab offers them as one-click links). Not per project.
  ipcMain.handle("browserTab:scanPorts", () => scanLocalPorts());
  ipcMain.handle("browserTab:back", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.back();
  });
  ipcMain.handle("browserTab:forward", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.forward();
  });
  ipcMain.handle("browserTab:reload", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.reload();
  });
  ipcMain.handle("browserTab:stop", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.stop();
  });
  ipcMain.handle("browserTab:getState", (_event, projectId: string) => projectWindows.get(projectId)?.browserTab?.getState() ?? null);
  ipcMain.handle("browserTab:setBounds", (event, projectId: string, bounds: BrowserTabBounds) => {
    resolveBrowserTab(projectId)?.setBounds(scaleBrowserTabBounds(bounds, event.sender.getZoomFactor()));
  });
  ipcMain.handle("browserTab:show", (_event, projectId: string) => {
    resolveBrowserTab(projectId)?.show();
  });
  ipcMain.handle("browserTab:hide", (_event, projectId: string) => {
    projectWindows.get(projectId)?.browserTab?.hide();
  });
  // Still image of the active page, for the renderer to show in the viewport
  // placeholder while the native view is temporarily hidden (a DOM flyout
  // can't draw over a WebContentsView). null on any failure: the caller just
  // falls back to hiding the view without a placeholder.
  ipcMain.handle("browserTab:snapshot", async (_event, projectId: string) => {
    try {
      const shot = await projectWindows.get(projectId)?.browserTab?.screenshot();
      return shot ? { base64: shot.base64, mimeType: shot.mimeType } : null;
    } catch {
      return null;
    }
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

  // Toolbar 💬 toggle → the active page's comment mode (the page's own overlay
  // handles the clicking); providers feed the in-page "New agent" popover.
  ipcMain.handle("browserTab:comments:setMode", (_event, projectId: string, on: boolean) => {
    projectWindows.get(projectId)?.browserTab?.setCommentMode(Boolean(on));
  });
  ipcMain.handle("browserTab:comments:setPaneTitles", (_event, projectId: string, titles: Record<string, string>) => {
    const clean: Record<string, string> = {};
    for (const [id, title] of Object.entries(titles ?? {})) if (typeof title === "string") clean[id] = title;
    commentPaneTitles.set(projectId, clean);
  });
  ipcMain.handle("browserTab:comments:setProviders", (_event, projectId: string, providers: CommentProvider[]) => {
    commentProviders.set(
      projectId,
      (Array.isArray(providers) ? providers : []).map((p) => ({
        id: String(p.id),
        label: String(p.label),
        command: String(p.command),
      })),
    );
  });

  // Review comments on code: diffs and the file editor (codeCommentsHost.ts).
  ipcMain.handle("codeComments:locate", (_e, projectId: string, target: string) => codeCommentsHostFor(projectId).locate(String(target)));
  ipcMain.handle("codeComments:list", (_e, projectId: string, root: string) => codeCommentsHostFor(projectId).list(root));
  ipcMain.handle("codeComments:add", (_e, projectId: string, root: string, input: unknown) => codeCommentsHostFor(projectId).add(root, input));
  ipcMain.handle("codeComments:update", (_e, projectId: string, root: string, id: string, text: string) =>
    codeCommentsHostFor(projectId).update(root, id, text),
  );
  ipcMain.handle("codeComments:remove", (_e, projectId: string, root: string, id: string) => codeCommentsHostFor(projectId).remove(root, id));
  ipcMain.handle("codeComments:clearDone", (_e, projectId: string, root: string) => codeCommentsHostFor(projectId).clearDone(root));
  ipcMain.handle("codeComments:setStatus", (_e, projectId: string, ids: string[], status: "idle" | "sent" | "done") =>
    codeCommentsHostFor(projectId).setStatus(Array.isArray(ids) ? ids : [], status),
  );
  ipcMain.handle("codeComments:dropRoot", (_e, projectId: string, path: string) => codeCommentsHostFor(projectId).dropRoot(path));
  ipcMain.handle("codeComments:targets", (_e, projectId: string) => codeCommentsHostFor(projectId).targets());
  ipcMain.handle("codeComments:send", (_e, projectId: string, req: Parameters<CodeCommentsHost["send"]>[0]) =>
    codeCommentsHostFor(projectId).send(req),
  );

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
      title: mt("project.createTitle"),
      buttonLabel: mt("project.createButton"),
    });
    if (result.canceled || !result.filePath) return null;
    const folderPath = result.filePath;
    await mkdir(folderPath, { recursive: true });
    const project = await upsertProject({ path: folderPath, name: basename(folderPath) });
    await openProject(project);
    return project;
  });

  ipcMain.handle("projects:cloneDefaultParent", () => remoteProjectsRoot());

  ipcMain.handle("projects:cloneRepo", (_event, params: { url: string; parentDir?: string; folderName?: string }) =>
    cloneRepoAsProject(params ?? { url: "" }),
  );

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

  ipcMain.handle("projects:reveal", async (_event, id: string) => {
    const project = await getProject(id);
    if (!project) return { opened: false, error: "Project not found." };
    const err = await shell.openPath(project.path);
    return err ? { opened: false, error: err } : { opened: true };
  });

  ipcMain.handle("projects:openInIde", async (_event, id: string) => {
    const project = await getProject(id);
    if (!project) return { opened: false, error: "Project not found." };
    const settings = await loadIdeSettings(app.getPath("userData"));
    return openProjectInIde(project.path, settings);
  });

  // "Clone" = duplicate the project folder somewhere else and register the
  // copy as its own project (not `git clone`).
  ipcMain.handle("projects:clone", async (_event, id: string) => {
    const project = await getProject(id);
    if (!project) throw new Error("Project not found.");
    const result = await dialog.showSaveDialog({
      title: mt("project.cloneTitle", { name: project.name }),
      buttonLabel: mt("project.cloneButton"),
      defaultPath: join(dirname(project.path), `${basename(project.path)}-copy`),
    });
    if (result.canceled || !result.filePath) return null;
    const dest = resolve(result.filePath);
    const src = resolve(project.path);
    if (dest === src || !relative(src, dest).startsWith("..")) {
      throw new Error("Destination can't be the project folder or inside it.");
    }
    if (await stat(dest).then(() => true, () => false)) throw new Error("Destination already exists.");
    await cp(src, dest, { recursive: true });
    const copy = await upsertProject({ path: dest, name: basename(dest) });
    await openProject(copy);
    return copy;
  });

  // Removes from the list only — the folder stays on disk.
  ipcMain.handle("projects:remove", async (_event, id: string) => {
    if (id === defaultProjectId) throw new Error("The default workspace can't be removed.");
    await closeProjectWindow(id);
    await workspaceBroker?.forgetProject(id);
    return removeProject(id);
  });

  // Removes from the list AND deletes the project folder from disk.
  ipcMain.handle("projects:purge", async (_event, id: string) => {
    if (id === defaultProjectId) throw new Error("The default workspace can't be purged.");
    const project = await getProject(id);
    if (!project) return false;
    const target = resolve(project.path);
    // A registry entry pointing at a drive root / the home dir / app data must never reach rm().
    if (parse(target).root === target || target === resolve(homedir()) || target === resolve(app.getPath("userData"))) {
      throw new Error(`Refusing to delete "${target}".`);
    }
    await closeProjectWindow(id);
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await workspaceBroker?.forgetProject(id);
    return removeProject(id);
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
      await paneControl.writePane(id, text, pressEnter ?? true, undefined, { source: { kind: "plugin" } });
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

  // Reply half of the editors:request pair built in openProject() above: the renderer's open spreadsheet /
  // document / presentation answers an agent's tool call. Only the window that was asked may answer.
  ipcMain.handle("editors:reply", (event, callId: string, ok: boolean, payload: unknown) => {
    const pending = pendingEditorCalls.get(callId);
    if (!pending || pending.webContentsId !== event.sender.id) return;
    pendingEditorCalls.delete(callId);
    if (ok) pending.resolve(payload);
    else pending.reject(new Error(typeof payload === "string" ? payload : "editor operation failed"));
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

  ipcMain.handle(
    "plugins:updateManifest",
    async (_event, projectId: string, scope: PluginScope, id: string, patch: PluginManifestPatch) => {
      const project = await getProject(projectId);
      if (!project) throw new Error("Unknown project");
      const record = await updatePluginManifest(scope, id, projectId, project.path, patch);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
      }
      return record;
    },
  );

  ipcMain.handle("plugins:listFiles", async (_event, projectId: string, scope: PluginScope, id: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return listPluginFiles(scope, id, project.path);
  });

  ipcMain.handle("plugins:lintPermissions", async (_event, projectId: string, scope: PluginScope, id: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return lintPluginPermissions(scope, id, project.path);
  });

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

  // Absolute path of a project-relative one, confined to the project root: what
  // "send to terminal" writes into a pane and what "copy file" puts on the clipboard.
  const resolveInProject = async (projectId: string, relativePath: string): Promise<string> => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const root = resolve(project.path);
    const target = resolve(root, relativePath);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("relativePath escapes the project root");
    return target;
  };

  ipcMain.handle("files:absolutePath", (_event, projectId: string, relativePath: string) =>
    resolveInProject(projectId, relativePath),
  );

  // In-app spreadsheet editor (workspace/SheetEditor.tsx): .xlsx ⇄ the editor's snapshot, confined to the project.
  ipcMain.handle("office:sheetLoad", async (_event, projectId: string, relativePath: string) =>
    loadSheetSnapshot(await resolveInProject(projectId, relativePath), basename(relativePath)),
  );
  ipcMain.handle("office:sheetSave", async (_event, projectId: string, relativePath: string, snapshot: unknown) =>
    saveSheetSnapshot(await resolveInProject(projectId, relativePath), snapshot as Parameters<typeof saveSheetSnapshot>[1]),
  );
  ipcMain.handle("office:sheetBaseline", async (_event, projectId: string, relativePath: string, snapshot: unknown) =>
    setSheetBaseline(await resolveInProject(projectId, relativePath), snapshot as Parameters<typeof saveSheetSnapshot>[1]),
  );
  // "Save a copy" for a file the editor can't round-trip without loss: returns the copy's project-relative path.
  ipcMain.handle("office:sheetSaveCopy", async (_event, projectId: string, relativePath: string, snapshot: unknown) => {
    const copy = await copyPathFor(await resolveInProject(projectId, relativePath));
    await saveSheetSnapshot(copy, snapshot as Parameters<typeof saveSheetSnapshot>[1]);
    const project = await getProject(projectId);
    return relative(resolve(project!.path), copy);
  });
  // Word documents (workspace/DocEditor.tsx).
  ipcMain.handle("office:docLoad", async (_event, projectId: string, relativePath: string) =>
    loadDoc(await resolveInProject(projectId, relativePath)),
  );
  ipcMain.handle("office:docSave", async (_event, projectId: string, relativePath: string, model: unknown) =>
    saveDoc(await resolveInProject(projectId, relativePath), model as Parameters<typeof saveDoc>[1]),
  );
  ipcMain.handle("office:docSaveCopy", async (_event, projectId: string, relativePath: string, model: unknown) => {
    const copy = await copyPathFor(await resolveInProject(projectId, relativePath));
    await saveDoc(copy, model as Parameters<typeof saveDoc>[1]);
    const project = await getProject(projectId);
    return relative(resolve(project!.path), copy);
  });
  ipcMain.handle("office:docCreate", async (_event, projectId: string, relativePath: string, model: unknown) =>
    createDocFile(await resolveInProject(projectId, relativePath), model as Parameters<typeof createDocFile>[1]),
  );
  // PowerPoint presentations (workspace/DeckEditor.tsx).
  ipcMain.handle("office:deckLoad", async (_event, projectId: string, relativePath: string) =>
    loadDeck(await resolveInProject(projectId, relativePath)),
  );
  ipcMain.handle("office:deckSave", async (_event, projectId: string, relativePath: string, deck: unknown) =>
    saveDeck(await resolveInProject(projectId, relativePath), deck as Parameters<typeof saveDeck>[1]),
  );
  ipcMain.handle("office:deckSaveCopy", async (_event, projectId: string, relativePath: string, deck: unknown) => {
    const copy = await copyPathFor(await resolveInProject(projectId, relativePath));
    await saveDeck(copy, deck as Parameters<typeof saveDeck>[1]);
    const project = await getProject(projectId);
    return relative(resolve(project!.path), copy);
  });
  ipcMain.handle("office:deckCreate", async (_event, projectId: string, relativePath: string, deck: unknown) =>
    createDeckFile(await resolveInProject(projectId, relativePath), deck as Parameters<typeof createDeckFile>[1]),
  );
  ipcMain.handle(
    "office:sheetCreate",
    async (_event, projectId: string, relativePath: string, rows?: Array<Array<string | number | boolean | null>>) =>
      createSheetFile(await resolveInProject(projectId, relativePath), rows ?? []),
  );

  // An image pasted, dropped or picked into a note: stored in an `assets` folder next to the note, under a safe
  // name that doesn't collide with what is already there. Returns the address to write in the markdown
  // (`assets/name.png`, relative to the note).
  ipcMain.handle(
    "files:saveAsset",
    async (_event, projectId: string, noteRelativePath: string, fileName: string, data: Uint8Array) => {
      const name = sanitizeAssetName(fileName);
      if (!isImageName(name)) throw new Error("Solo se pueden guardar imágenes (png, jpg, gif, webp, svg, bmp, avif).");
      if (data.byteLength > MAX_ASSET_BYTES) throw new Error("La imagen pesa más de 25 MB.");
      const noteDir = noteRelativePath.includes("/") ? noteRelativePath.slice(0, noteRelativePath.lastIndexOf("/")) : "";
      const assetsDir = await resolveInProject(projectId, noteDir ? `${noteDir}/assets` : "assets");
      await mkdir(assetsDir, { recursive: true });
      const unique = uniqueAssetName(name, await readdir(assetsDir));
      await writeFile(resolve(assetsDir, unique), Buffer.from(data));
      return { src: `assets/${unique}` };
    },
  );

  ipcMain.handle("clipboard:writeFilePaths", async (_event, projectId: string, relativePaths: string[]) => {
    const absolute = await Promise.all(relativePaths.map((p) => resolveInProject(projectId, p)));
    return writeClipboardFilePaths(absolute);
  });

  // The chat's "attach" button: a native picker that opens on the project. Attachments are
  // project-relative (the gateway reads them from there), so anything chosen outside it
  // is reported back instead of being silently dropped.
  ipcMain.handle("files:pickToAttach", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const root = resolve(project.path);
    const result = await dialog.showOpenDialog({
      defaultPath: root,
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    if (result.canceled) return { attachments: [], rejected: [] };
    return classifyPickedPaths(root, result.filePaths, async (path) => {
      const info = await stat(path).catch(() => null);
      return info ? (info.isDirectory() ? "directory" : "file") : null;
    });
  });

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
      title: mt("whisper.pickBinary"),
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
        title: mt("settings.exportTitle"),
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
        let globalProviders: Record<string, unknown> | null = null;
        try {
          globalProviders = JSON.parse(await readFile(join(homedir(), ".yggdrasil", "providers.json"), "utf8")) as Record<string, unknown>;
        } catch {
          globalProviders = null;
        }
        gateway = withGlobalProviders(gateway, globalProviders);
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
        title: mt("settings.importTitle"),
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

  installDashboardIpc();
  lspIpc = installLspIpc({
    userDataDir: app.getPath("userData"),
    projectForSender: (sender) => {
      for (const [id, entry] of projectWindows) {
        if (entry.window.webContents === sender) return { id, root: entry.root, webContents: sender };
      }
      return undefined;
    },
  });

  // Code editor preferences: same persist-and-broadcast shape as the theme.
  ipcMain.handle("editorSettings:get", () => loadEditorSettings(app.getPath("userData")));
  ipcMain.handle("editorSettings:set", async (_event, settings: EditorSettings) => {
    const saved = await saveEditorSettings(app.getPath("userData"), settings);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("editorSettings:changed", saved);
    }
    return saved;
  });

  // Settings -> Agent CLIs -> Claude Code: applies to claude panes opened after saving.
  ipcMain.handle("claudePaneSettings:get", async () => ({
    settings: await loadClaudePaneSettings(app.getPath("userData")),
    cavemanInstalled: isCavemanInstalled(),
    userMcpServers: readUserMcpServers(),
  }));
  ipcMain.handle("claudePaneSettings:set", (_event, settings: ClaudePaneSettings) =>
    saveClaudePaneSettings(app.getPath("userData"), settings),
  );

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

  // Workspaces canvas (home window): every project and link at once; connecting
  // links both directions, trust is set per direction + action. See
  // notes/features/workspaces-canvas.md. Changes broadcast workspace:changed.
  ipcMain.handle("workspace:graph", () => requireWorkspaceBroker().graph());
  ipcMain.handle("workspace:connect", (_event, a: string, b: string) => requireWorkspaceBroker().connect(String(a), String(b)));
  ipcMain.handle("workspace:disconnect", (_event, a: string, b: string) =>
    requireWorkspaceBroker().disconnect(String(a), String(b)),
  );
  ipcMain.handle("workspace:setTrust", (_event, from: string, to: string, action: WorkspaceAction, trusted: boolean) =>
    requireWorkspaceBroker().setTrust(String(from), String(to), action, trusted === true),
  );
  ipcMain.handle("workspace:setPosition", (_event, projectId: string, position: { x: number; y: number }) =>
    requireWorkspaceBroker().setPosition(String(projectId), { x: Number(position?.x), y: Number(position?.y) }),
  );

  ipcMain.handle(
    "workspace:saveZone",
    (_event, zone: WorkspaceZone, positions?: Record<string, { x: number; y: number }>) =>
      requireWorkspaceBroker().saveZone(zone, positions ?? {}),
  );
  ipcMain.handle("workspace:deleteZone", (_event, id: string) => requireWorkspaceBroker().deleteZone(String(id)));

  ipcMain.handle("onboarding:getState", async () => {
    const userData = app.getPath("userData");
    const settings = await loadOnboardingSettings(userData);
    return { settings, autoOpen: shouldAutoOpenOnboarding(settings, await hasExistingConfig(userData)) };
  });
  ipcMain.handle("onboarding:save", async (_event, settings: OnboardingSettings) => {
    const saved = await saveOnboardingSettings(app.getPath("userData"), settings);
    // Native dialogs and the app menu follow the UI language; rebuild the menu so it switches live.
    setMainLanguage(resolveMainLanguage(saved.language, app.getLocale()));
    installAboutMenu();
    return saved;
  });
  ipcMain.handle("onboarding:detectClis", () => detectClis());
  ipcMain.handle("onboarding:detectOllama", () => detectOllama());
  // Only the install links the wizard itself shows — not an open-any-URL channel.
  ipcMain.handle("onboarding:openExternal", async (_event, url: string) => {
    const allowed = new Set<string | undefined>([...CLI_CATALOG.map((c) => c.installUrl), "https://ollama.com/download"]);
    if (allowed.has(url)) await shell.openExternal(url);
  });

  ipcMain.handle("ide:getSettings", async (): Promise<IdeSettings> => loadIdeSettings(app.getPath("userData")));

  ipcMain.handle("ide:saveSettings", async (_event, settings: IdeSettings) => {
    await saveIdeSettings(app.getPath("userData"), settings);
  });

  // Package bundles (.app on macOS) are directories but should still be
  // pickable as a single "file" here — showOpenDialog's default (not
  // treating them as navigable directories) already does the right thing.
  ipcMain.handle("ide:pickCustomPath", async () => {
    const result = await dialog.showOpenDialog({ title: mt("ide.pickCustom"), properties: ["openFile"] });
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

  // Terminal path links (renderer terminal/pathLinkProvider.ts). Paths come
  // from untrusted terminal output, so this only stats them, and anything
  // outside the project is only ever *revealed* (selected in Finder/Explorer),
  // never opened — opening could run a script or an .app an agent printed.
  ipcMain.handle("paths:resolve", async (_event, projectId: string, raw: string, cwd: string | null) => {
    if (typeof raw !== "string" || raw.length > 4096) return null;
    const project = await getProject(projectId);
    return resolveTerminalPath(raw, typeof cwd === "string" && isAbsolute(cwd) ? cwd : null, project?.path ?? null);
  });

  ipcMain.handle("paths:reveal", async (_event, abs: string) => {
    if (typeof abs !== "string" || !isAbsolute(abs)) return { opened: false, error: "Not an absolute path." };
    const info = await stat(abs).catch(() => null);
    if (!info) return { opened: false, error: "Path not found." };
    shell.showItemInFolder(resolve(abs));
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
  void startSystemMonitor();
  // Must land before any project's gateway or panes start — Agent Flow/terminal spawns (terminals.ts) exec
  // CLIs directly with no shell in between, so they only see this process's PATH. Resolving it runs a login
  // shell, which can take seconds, so it runs in the background while the first window already shows; the
  // default project's boot waits for it (its "settings" stage).
  const pathReady = resolveShellPathAsync().then((path) => {
    process.env.PATH = path;
  });
  const savedOnboarding = await loadOnboardingSettings(app.getPath("userData")).catch(() => null);
  setMainLanguage(resolveMainLanguage(savedOnboarding?.language, app.getLocale()));
  installAboutMenu();
  installAutoUpdater();
  installUpdateCheck();
  registerIpc();
  registerTerminalIpc(
    (projectId) => projectWindows.get(projectId)?.window,
    (projectId) => projectWindows.get(projectId)?.gateway.url,
    (projectId) => projectWindows.get(projectId)?.root,
  );
  // Attention states of claude panes (notes/features/attention-inbox.md): the
  // hooks run attentionBridge.js with the same `node` the statusLine uses.
  setAttentionBridgeCommand(`node ${JSON.stringify(attentionBridgePath())}`);
  setAttentionHooks({
    target: (projectId) => {
      const pc = projectWindows.get(projectId)?.paneControl;
      return pc ? { url: pc.url, token: pc.token } : undefined;
    },
    onInput: reportPaneInput,
  });
  installAttention({
    getWindow: (projectId) => projectWindows.get(projectId)?.window,
    paneTitle: (projectId, paneId) => commentPaneTitles.get(projectId)?.[paneId],
  });
  // Message queue per claude pane (notes/features/pane-message-queue.md): a
  // message for a busy agent waits, and the turn's end (seen by the attention
  // inbox) hands it over.
  installPaneQueue({
    getWindow: (projectId) => projectWindows.get(projectId)?.window,
    paneTitle: (projectId, paneId) => commentPaneTitles.get(projectId)?.[paneId],
    status: paneAttentionStatus,
    enabled: () => attentionEnabled() && currentAttentionSettings().holdMessages,
    deliver: async (paneId, text) => {
      await submitToTerminal(paneId, text, undefined, { when: "now" });
    },
  });
  setQueueHooks({ onTurnEnd: queueTurnEnd, onInterrupt: queueInterrupt, onEnd: dropPaneQueue });
  setSubmitGate(gateSubmit, dropPaneQueue);
  registerPluginProtocol((id) => getProject(id));
  registerFileProtocol((id) => getProject(id));
  // Window first (bootState.ts): the theme and the default project are all the window needs. The rest of
  // startup runs as its first live stages ("settings", "plugins"), then the default project's own boot.
  currentTheme = await loadThemeSettings(app.getPath("userData"));
  const defaultProject = await upsertProject({ path: defaultWorkspaceRoot(), name: "Default Workspace" });
  defaultProjectId = defaultProject.id;
  const opening = openProject(defaultProject, async (stage) => {
    stage("settings");
    await pathReady;
    // Before any project (and its claude panes) can open — see claudePaneSettings.ts.
    await loadClaudePaneSettings(app.getPath("userData")).catch((error) => console.error("[claudePaneSettings] load failed", error));
    stage("plugins");
    await ensurePluginDirs();
    // Never closed — lives for the app's whole lifetime, same as the process
    // itself; nothing meaningful to clean up on quit. Once, even if a Retry reruns this.
    globalPluginsWatcher ??= watchPluginsDir(globalPluginsDir(), (pluginId) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "global", pluginId });
      }
    });

    workspaceBroker ??= await createWorkspaceBroker({
      userDataDir: app.getPath("userData"),
      listProjects: async () => (await listProjects()).map((p) => ({ id: p.id, name: p.name, color: p.color })),
      paneApi: (id) => {
        const entry = projectWindows.get(id);
        if (!entry || entry.window.isDestroyed()) return undefined;
        return {
          listPanes: entry.paneControl.listPanes,
          readPane: entry.paneControl.readPane,
          writePane: async (paneId, text, pressEnter) => {
            await entry.paneControl.writePane(paneId, text, pressEnter, undefined, { source: { kind: "workspace" } });
          },
        };
      },
      ask: askWorkspace,
      notify: (projectId, notice) => {
        const win = projectWindows.get(projectId)?.window;
        if (win && !win.isDestroyed()) win.webContents.send("workspace:notice", notice);
      },
      onChange: broadcastWorkspaceChanged,
    });
    await resetOpenGateways();
    if (!phoneLinkStarted) {
      phoneLinkStarted = true;
      registerPhoneLinkIpc(); // ipcMain.handle throws if registered twice
      startPhoneLink();
    }
  });
  try {
    await opening;
  } catch (error) {
    if (error instanceof BootShownInWindow) {
      // The window is up and shows the failure with Retry: keep the app running.
      logCaughtError("openProject(default)", error);
    } else {
      // Failed before the window existed: without this the app would run with zero windows and no
      // taskbar/dock presence, indistinguishable from a silent crash (reason only in main-crashes.log).
      console.error("[main] failed to open default project", error);
      logCaughtError("openProject(default)", error);
      dialog.showErrorBox(
        mt("app.startFailed"),
        `${error instanceof Error ? error.message : String(error)}\n\n${mt("app.seeLog", { path: logPath() })}`,
      );
      app.quit();
      return;
    }
  }

  reopenDefaultWindow = () => void openProject(defaultProject);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) reopenDefaultWindow?.();
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
  for (const b of bootingProjects.values()) abortBoot(b);
  stopWhisperServer();
  void Promise.allSettled([disposeAllTerminalsAndWait(), lspIpc?.stopAll(), stopSystemMonitor()]).finally(() => app.quit());
});
