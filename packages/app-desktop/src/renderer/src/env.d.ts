/// <reference types="vite/client" />

import type {
  AgentFlow,
  AgentFlowAutoCapturePayload,
  AgentFlowCommunicationPayload,
  AgentTeam,
  AutomationSettings,
  BootSnapshot,
  ClaudePaneSettings,
  UserMcpChoice,
  UserMcpServer,
  BrowserTabBounds,
  BrowserDownload,
  BrowserTabState,
  PickedElement,
  CustomFlowTemplate,
  CustomRole,
  DesktopPermissions,
  DetectedCli,
  DetectedIde,
  SkillInfo,
  DocumentTabsLayout,
  CreatePaneSpec,
  IdeCatalogEntry,
  IdeSettings,
  OllamaStatus,
  OnboardingSettings,
  OnboardingState,
  ImportFilesResult,
  MyShareSummary,
  OpenIdeResult,
  PaneSummary,
  PermissionKind,
  PermissionLint,
  PluginFileEntry,
  PluginManifestPatch,
  PluginRecord,
  PluginScope,
  PluginStatus,
  PullResult,
  PushResult,
  WorkspaceAsk,
  WorkspaceNotice,
  WorkspaceView,
  WorkspaceGraph,
  WorkspaceZone,
  WorkspaceAction,
  ResourceRef,
  ResourceStatus,
  ShareMember,
  ScaffoldPluginSpec,
  SharedResourceRole,
  PluginTabsLayout,
  ProjectRecord,
  RateLimitsPayload,
  PaneAttention,
  PaneQueueView,
  SubmitResult,
  CodeComment,
  CodeCommentStatus,
  CodeCommentTarget,
  CodeCommentTargets,
  NewCodeComment,
  RepoLocation,
  SttCloudSettings,
  SttSettings,
  SyncSettings,
  TerminalLayout,
  TtsSettings,
  WhisperBackend,
  WhisperModelName,
  WhisperSettings,
  PhoneLinkInfo,
  HubTestResult,
  HubUrlCheck,
} from "./types.js";
import type { ThemeSettings } from "@yggdrasil/ui-kit";

declare global {
  /** packages/app-desktop/package.json's version, set by electron.vite.config.ts. */
  const __APP_VERSION__: string;
}

// Adding the `import type` above makes this file a module, not an ambient
// script — `declare global` is required for `interface Window` to actually
// merge with the real global Window type instead of shadowing it locally.
declare global {
  interface Window {
    yggdrasil: {
      projectId: string | null;
      boot: {
        get: () => Promise<BootSnapshot | null>;
        retry: () => Promise<boolean>;
        onUpdate: (handler: (snapshot: BootSnapshot) => void) => () => void;
      };
      projectName: string | null;
      projectPath: string | null;
      projectColor: string | null;
      isDefaultProject: boolean;
      defaultProjectId: string | null;
      platform: NodeJS.Platform;
      windowsBuildNumber: number | undefined;
      phoneLink: {
        get: () => Promise<PhoneLinkInfo>;
        save: (input: { hubUrl?: string; hubKey?: string; publish?: boolean }) => Promise<PhoneLinkInfo>;
        publishNow: () => Promise<PhoneLinkInfo>;
        qr: () => Promise<string>;
        checkUrl: (hubUrl: string) => Promise<HubUrlCheck>;
        generateKey: () => Promise<string>;
        test: (input: { hubUrl: string; hubKey: string }) => Promise<HubTestResult>;
      };
      theme: {
        initial: ThemeSettings;
        get: () => Promise<ThemeSettings>;
        set: (settings: ThemeSettings) => Promise<ThemeSettings>;
        reset: () => Promise<ThemeSettings>;
        onChange: (handler: (settings: ThemeSettings) => void) => () => void;
      };
      lsp: {
        start: (language: string) => Promise<unknown>;
        send: (sessionId: string, message: unknown) => void;
        status: () => Promise<unknown>;
        setTrusted: (trusted: boolean) => Promise<void>;
        readExternal: (uri: string) => Promise<string | null>;
        onMessage: (handler: (payload: unknown) => void) => () => void;
        onClosed: (handler: (payload: unknown) => void) => () => void;
        onTrustChanged: (handler: (payload: unknown) => void) => () => void;
      };
      update: {
        get: () => Promise<{ version: string; url: string } | null>;
        openRelease: () => Promise<void>;
        dismiss: () => Promise<void>;
        onChange: (handler: (update: { version: string; url: string } | null) => void) => () => void;
      };
      claudePaneSettings: {
        get: () => Promise<{ settings: ClaudePaneSettings; cavemanInstalled: boolean; userMcpServers: UserMcpServer[] }>;
        /** Rejects when extraSettings isn't a JSON object; nothing is saved then. */
        set: (settings: ClaudePaneSettings) => Promise<ClaudePaneSettings>;
      };
      editorSettings: {
        get: () => Promise<import("./files/editorPrefs.js").EditorPrefs>;
        set: (settings: import("./files/editorPrefs.js").EditorPrefs) => Promise<import("./files/editorPrefs.js").EditorPrefs>;
        onChange: (handler: (settings: import("./files/editorPrefs.js").EditorPrefs) => void) => () => void;
      };
      workspace: {
        view: () => Promise<WorkspaceView>;
        setLink: (targetId: string, linked: boolean) => Promise<void>;
        revokeTrust: (key: string) => Promise<void>;
        answer: (id: string, answer: { allow: boolean; trust: boolean }) => Promise<void>;
        onAsk: (handler: (ask: WorkspaceAsk) => void) => () => void;
        onAskClosed: (handler: (payload: { id: string }) => void) => () => void;
        onNotice: (handler: (notice: WorkspaceNotice) => void) => () => void;
        /** Workspaces canvas (home window). */
        graph: () => Promise<WorkspaceGraph>;
        connect: (a: string, b: string) => Promise<void>;
        disconnect: (a: string, b: string) => Promise<void>;
        setTrust: (from: string, to: string, action: WorkspaceAction, trusted: boolean) => Promise<void>;
        setPosition: (projectId: string, position: { x: number; y: number }) => Promise<void>;
        /** Creates/updates a zone; `positions` moves the projects it carried along in the same save. */
        saveZone: (zone: WorkspaceZone, positions?: Record<string, { x: number; y: number }>) => Promise<void>;
        deleteZone: (id: string) => Promise<void>;
        onChanged: (handler: () => void) => () => void;
      };
      projects: {
        list: () => Promise<ProjectRecord[]>;
        openExisting: () => Promise<ProjectRecord | null>;
        createNew: () => Promise<ProjectRecord | null>;
        open: (id: string) => Promise<boolean>;
        openHome: () => Promise<boolean>;
        rename: (id: string, name: string) => Promise<ProjectRecord | undefined>;
        setColor: (id: string, color: string | null) => Promise<ProjectRecord | undefined>;
        reveal: (id: string) => Promise<OpenIdeResult>;
        openInIde: (id: string) => Promise<OpenIdeResult>;
        clone: (id: string) => Promise<ProjectRecord | null>;
        cloneDefaultParent: () => Promise<string>;
        cloneRepo: (params: { url: string; parentDir?: string; folderName?: string }) => Promise<ProjectRecord>;
        remove: (id: string) => Promise<boolean>;
        purge: (id: string) => Promise<boolean>;
        onColorChange: (handler: (id: string, color: string | null) => void) => () => void;
      };
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
          claudeUserMcp?: UserMcpChoice;
        }) => Promise<void>;
        write: (id: string, data: string) => Promise<void>;
        submit: (id: string, text: string, when?: "auto" | "now") => Promise<SubmitResult>;
        resize: (id: string, cols: number, rows: number) => Promise<void>;
        dispose: (id: string) => Promise<void>;
        read: (id: string, maxChars?: number) => Promise<string | undefined>;
        cwdFallback: (id: string) => Promise<{ missing: string; cwd: string } | undefined>;
        forPid: (pid: number) => Promise<string | undefined>;
        memory: (
          id: string,
        ) => Promise<
          { rssBytes: number; processes: Array<{ pid: number; name: string; rssBytes: number }>; processCount: number } | undefined
        >;
        memoryAll: () => Promise<{ totalBytes: number; usedBytes: number; appBytes: number; panes: Array<{ id: string; rssBytes: number }> }>;
        snapshot: (id: string) => Promise<{ data: string; cols: number; rows: number; seq: number } | undefined>;
        getLayout: () => Promise<TerminalLayout>;
        saveLayout: (layout: TerminalLayout) => Promise<void>;
        onData: (handler: (id: string, chunk: string, seq?: number) => void) => () => void;
        onResized: (handler: (id: string, cols: number, rows: number) => void) => () => void;
        onExit: (handler: (id: string, exitCode: number | null) => void) => () => void;
        onSpec: (handler: (paneId: string, specPath: string) => void) => () => void;
        onPaneCreated: (
          handler: (pane: {
            id: string;
            title: string;
            cwd: string;
            command?: string;
            args?: string[];
            sourcePaneId?: string;
            initialPrompt?: string;
          }) => void,
        ) => () => void;
        onPaneShow: (handler: (pane: { id: string; title: string; cwd: string; command?: string }) => void) => () => void;
        onMobileFocus: (handler: (id: string, active: boolean) => void) => () => void;
      };
      window: {
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        setFullScreen: (on: boolean) => Promise<void>;
        onMaximizedChange: (handler: (maximized: boolean) => void) => () => void;
      };
      connectors: {
        onOAuthCallback: (handler: (payload: { code: string; state: string }) => void) => () => void;
      };
      codeComments: {
        locate: (target: string) => Promise<RepoLocation | undefined>;
        list: (root: string) => Promise<CodeComment[]>;
        add: (root: string, input: NewCodeComment) => Promise<CodeComment>;
        update: (root: string, id: string, text: string) => Promise<void>;
        remove: (root: string, id: string) => Promise<void>;
        clearDone: (root: string) => Promise<void>;
        setStatus: (ids: string[], status: CodeCommentStatus) => Promise<boolean>;
        dropRoot: (path: string) => Promise<void>;
        targets: () => Promise<CodeCommentTargets>;
        send: (req: {
          root: string;
          ids?: string[];
          target: CodeCommentTarget;
        }) => Promise<{ ok: boolean; error?: string; queued?: boolean; position?: number }>;
        onChanged: (handler: (root: string) => void) => () => void;
      };
      queue: {
        get: () => Promise<Record<string, PaneQueueView>>;
        onUpdate: (handler: (queues: Record<string, PaneQueueView>) => void) => () => void;
        onDropped: (handler: (info: { paneId: string; title: string; count: number }) => void) => () => void;
        edit: (paneId: string, id: string, text: string) => Promise<void>;
        move: (paneId: string, id: string, delta: -1 | 1) => Promise<void>;
        remove: (paneId: string, id: string) => Promise<void>;
        clear: (paneId: string) => Promise<void>;
        pause: (paneId: string, paused: boolean) => Promise<void>;
        sendNow: (paneId: string, id: string) => Promise<void>;
      };
      attention: {
        get: () => Promise<Record<string, PaneAttention>>;
        onUpdate: (handler: (panes: Record<string, PaneAttention>) => void) => () => void;
        setViewing: (paneId: string | null) => Promise<void>;
        seen: (paneId: string) => Promise<void>;
        clearDone: () => Promise<void>;
        onReveal: (handler: (paneId: string) => void) => () => void;
      };
      statusline: {
        get: () => Promise<RateLimitsPayload | undefined>;
        onUpdate: (handler: (payload: RateLimitsPayload) => void) => () => void;
      };
      scripts: {
        runInTerminal: (params: { cwd: string; packageManager: string; scriptName: string }) => Promise<void>;
      };
      agentFlow: {
        get: () => Promise<AgentFlow | null>;
        save: (flow: AgentFlow) => Promise<void>;
        onAutoCapture: (handler: (payload: AgentFlowAutoCapturePayload) => void) => () => void;
        onCommunication: (handler: (payload: AgentFlowCommunicationPayload) => void) => () => void;
      };
      browserTab: {
        navigate: (url: string) => Promise<void>;
        go: (input: string) => Promise<void>;
        newTab: (input?: string) => Promise<string | null>;
        closeTab: (id: string) => Promise<void>;
        activateTab: (id: string) => Promise<void>;
        toggleDevTools: () => Promise<void>;
        zoom: (direction: "in" | "out" | "reset") => Promise<void>;
        showDownload: (path: string) => Promise<void>;
        scanPorts: () => Promise<number[]>;
        onFocusAddress: (handler: () => void) => () => void;
        onDownload: (handler: (download: BrowserDownload) => void) => () => void;
        back: () => Promise<void>;
        forward: () => Promise<void>;
        reload: () => Promise<void>;
        stop: () => Promise<void>;
        getState: () => Promise<BrowserTabState | null>;
        onState: (handler: (state: BrowserTabState) => void) => () => void;
        setBounds: (bounds: BrowserTabBounds) => Promise<void>;
        show: () => Promise<void>;
        hide: () => Promise<void>;
        getUrl: () => Promise<string>;
        snapshot: () => Promise<{ base64: string; mimeType: string } | null>;
        startPick: (timeoutMs?: number) => Promise<PickedElement | null>;
        onRequestShow: (handler: () => void) => () => void;
        comments: {
          setMode: (on: boolean) => Promise<void>;
          onMode: (handler: (on: boolean) => void) => () => void;
          setProviders: (providers: Array<{ id: string; label: string; command: string }>) => Promise<void>;
          setPaneTitles: (titles: Record<string, string>) => Promise<void>;
        };
      };
      agentTeams: {
        list: () => Promise<AgentTeam[]>;
        save: (team: AgentTeam) => Promise<AgentTeam[]>;
        delete: (id: string) => Promise<AgentTeam[]>;
        rename: (id: string, name: string) => Promise<AgentTeam[]>;
      };
      documents: {
        getLayout: () => Promise<DocumentTabsLayout>;
        saveLayout: (layout: DocumentTabsLayout) => Promise<void>;
      };
      plugins: {
        list: () => Promise<PluginRecord[]>;
        reload: () => Promise<PluginRecord[]>;
        storageGet: (scope: PluginScope, id: string, key: string) => Promise<unknown>;
        storageSet: (scope: PluginScope, id: string, key: string, value: unknown) => Promise<void>;
        storageDelete: (scope: PluginScope, id: string, key: string) => Promise<void>;
        storageKeys: (scope: PluginScope, id: string) => Promise<string[]>;
        fsWrite: (relativePath: string, content: string) => Promise<void>;
        fsMkdir: (relativePath: string) => Promise<void>;
        onChanged: (handler: (payload: { scope: PluginScope | "all"; pluginId?: string }) => void) => () => void;
        onOpenRequest: (handler: (payload: { key: string; view?: "tab" | "panel" }) => void) => () => void;
        onFrameError: (
          handler: (payload: { frameUrl: string; message: string; sourceId: string; lineNumber: number }) => void,
        ) => () => void;
        getLayout: () => Promise<PluginTabsLayout>;
        saveLayout: (layout: PluginTabsLayout) => Promise<void>;
        reveal: (dir: string) => Promise<void>;
        scaffold: (spec: ScaffoldPluginSpec) => Promise<PluginRecord>;
        setStatus: (scope: PluginScope, id: string, status: PluginStatus) => Promise<PluginRecord>;
        delete: (scope: PluginScope, id: string) => Promise<void>;
        updateManifest: (scope: PluginScope, id: string, patch: PluginManifestPatch) => Promise<PluginRecord>;
        listFiles: (scope: PluginScope, id: string) => Promise<PluginFileEntry[]>;
        lintPermissions: (scope: PluginScope, id: string) => Promise<PermissionLint>;
        onToolCallRequest: (
          handler: (payload: { callId: string; scope: PluginScope; id: string; tool: string; params: unknown }) => void,
        ) => () => void;
        toolCallResult: (callId: string, ok: boolean, resultOrError: unknown) => Promise<void>;
      };
      panes: {
        list: () => Promise<PaneSummary[]>;
        create: (spec: CreatePaneSpec) => Promise<{ id: string }>;
        write: (id: string, text: string, pressEnter?: boolean) => Promise<void>;
      };
      editors: {
        onRequest: (handler: (req: { callId: string; kind: string; op: string; params: Record<string, unknown> }) => void) => () => void;
        reply: (callId: string, ok: boolean, payload: unknown) => Promise<void>;
      };
      office: {
        sheetLoad: (relativePath: string) => Promise<{ snapshot: unknown; lossy: string[] }>;
        sheetSave: (relativePath: string, snapshot: unknown) => Promise<void>;
        docLoad: (relativePath: string) => Promise<{ model: unknown; lossy: string[] }>;
        docSave: (relativePath: string, model: unknown) => Promise<void>;
        docSaveCopy: (relativePath: string, model: unknown) => Promise<string>;
        docCreate: (relativePath: string, model: unknown) => Promise<void>;
        deckLoad: (relativePath: string) => Promise<{ deck: unknown; lossy: string[] }>;
        deckSave: (relativePath: string, deck: unknown) => Promise<void>;
        deckSaveCopy: (relativePath: string, deck: unknown) => Promise<string>;
        deckCreate: (relativePath: string, deck: unknown) => Promise<void>;
        sheetBaseline: (relativePath: string, snapshot: unknown) => Promise<void>;
        sheetSaveCopy: (relativePath: string, snapshot: unknown) => Promise<string>;
        sheetCreate: (relativePath: string, rows?: Array<Array<string | number | boolean | null>>) => Promise<void>;
      };
      files: {
        importExternal: (destRelativePath: string, sourcePaths: string[]) => Promise<ImportFilesResult>;
        getPathForFile: (file: File) => string;
        pickToImport: () => Promise<string[]>;
        fileUrl: (relativePath: string) => string;
        openExternal: (relativePath: string) => Promise<void>;
        absolutePath: (relativePath: string) => Promise<string>;
        saveAsset: (noteRelativePath: string, fileName: string, data: ArrayBuffer) => Promise<{ src: string }>;
        pickToAttach: () => Promise<{
          attachments: Array<{ relativePath: string; type: "file" | "directory" }>;
          rejected: string[];
        }>;
      };
      clipboard: {
        readFilePaths: () => Promise<string[]>;
        writeFilePaths: (relativePaths: string[]) => Promise<{ ok: boolean; error?: string }>;
      };
      dialog: {
        openDirectory: () => Promise<string | null>;
      };
      whisper: {
        getSettings: () => Promise<WhisperSettings>;
        saveSettings: (settings: WhisperSettings) => Promise<void>;
        pickBinary: () => Promise<string | null>;
        findBundledBinary: (backend: WhisperBackend) => Promise<string | null>;
        listModels: () => Promise<WhisperModelName[]>;
        listDownloaded: (modelsDir: string) => Promise<string[]>;
        isDownloaded: (modelsDir: string, name: string) => Promise<boolean>;
        download: (modelsDir: string, name: string) => Promise<void>;
        deleteModel: (modelsDir: string, name: string) => Promise<void>;
        transcribe: (audio: ArrayBuffer, settings: WhisperSettings) => Promise<string>;
        onDownloadProgress: (handler: (payload: { name: string; fraction: number }) => void) => () => void;
      };
      stt: {
        getSettings: () => Promise<SttSettings>;
        saveSettings: (settings: SttSettings) => Promise<void>;
        transcribeCloud: (audio: ArrayBuffer, settings: SttCloudSettings) => Promise<string>;
      };
      tts: {
        getSettings: () => Promise<TtsSettings>;
        saveSettings: (settings: TtsSettings) => Promise<void>;
      };
      settingsTransfer: {
        exportSettings: (workspaceRoot: string | null, includeSecrets: boolean) => Promise<{ path: string } | null>;
        importSettings: () => Promise<{
          path: string;
          desktopKeys: string[];
          gateway: Record<string, unknown> | null;
          warnings: string[];
        } | null>;
      };
      roles: {
        listCustom: () => Promise<CustomRole[]>;
        saveCustom: (role: { label: string; summary?: string; systemPrompt: string }) => Promise<CustomRole[]>;
        deleteCustom: (id: string) => Promise<CustomRole[]>;
      };
      flowTemplates: {
        listCustom: () => Promise<CustomFlowTemplate[]>;
        saveCustom: (template: { label: string; summary?: string; prompt: string }) => Promise<CustomFlowTemplate[]>;
        deleteCustom: (id: string) => Promise<CustomFlowTemplate[]>;
      };
      onboarding: {
        getState: () => Promise<OnboardingState>;
        save: (settings: OnboardingSettings) => Promise<OnboardingSettings>;
        detectClis: () => Promise<DetectedCli[]>;
        detectOllama: () => Promise<OllamaStatus>;
        openExternal: (url: string) => Promise<void>;
      };
      ide: {
        listCatalog: () => Promise<IdeCatalogEntry[]>;
        detectInstalled: () => Promise<DetectedIde[]>;
        getSettings: () => Promise<IdeSettings>;
        saveSettings: (settings: IdeSettings) => Promise<void>;
        pickCustomPath: () => Promise<string | null>;
        openProject: () => Promise<OpenIdeResult>;
        openPath: (relativePath: string) => Promise<OpenIdeResult>;
        revealPath: (relativePath: string, isDir: boolean) => Promise<{ opened: boolean; error?: string }>;
        resolveTerminalPath: (
          raw: string,
          cwd: string | null,
        ) => Promise<{ abs: string; kind: "file" | "directory"; insideProject: boolean; relativePath?: string } | null>;
        revealAbsolutePath: (abs: string) => Promise<{ opened: boolean; error?: string }>;
        openInBlender: (relativePath: string) => Promise<{ opened: boolean; error?: string }>;
        detectBlender: () => Promise<string | null>;
      };
      skills: {
        list: () => Promise<SkillInfo[]>;
        open: (skillPath: string, reveal: boolean) => Promise<{ opened: boolean; error?: string }>;
        create: (name: string, description: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
      };
      automation: {
        getPermissions: () => Promise<DesktopPermissions>;
        requestPermission: (kind: PermissionKind) => Promise<void>;
        getSettings: () => Promise<AutomationSettings>;
        saveSettings: (settings: AutomationSettings) => Promise<void>;
      };
      sync: {
        getSettings: () => Promise<SyncSettings>;
        saveSettings: (settings: SyncSettings) => Promise<void>;
        createShare: (ref: ResourceRef) => Promise<{ shareId: string }>;
        createInvite: (ref: ResourceRef, role: SharedResourceRole, expiresInHours?: number) => Promise<{ code: string }>;
        redeemInvite: (code: string, memberName: string, ref: ResourceRef) => Promise<unknown>;
        listMyShares: () => Promise<MyShareSummary[]>;
        getResourceStatus: (ref: ResourceRef) => Promise<ResourceStatus>;
        push: (ref: ResourceRef) => Promise<PushResult>;
        pull: (ref: ResourceRef) => Promise<PullResult>;
        resolveConflict: (ref: ResourceRef, choice: "keep-mine" | "take-theirs") => Promise<PullResult>;
        createWebLink: (ref: ResourceRef, email: string, role: SharedResourceRole) => Promise<{ url: string; keyHash: string }>;
        listMembers: (ref: ResourceRef) => Promise<ShareMember[]>;
        revokeMember: (ref: ResourceRef, memberKeyHash: string) => Promise<void>;
        refreshWebBundle: (ref: ResourceRef) => Promise<void>;
      };
    };
  }
}
