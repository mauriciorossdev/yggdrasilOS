/// <reference types="vite/client" />

import type {
  AgentFlow,
  AgentFlowAutoCapturePayload,
  AgentFlowCommunicationPayload,
  AgentTeam,
  AutomationSettings,
  BrowserTabBounds,
  PickedElement,
  CustomFlowTemplate,
  CustomRole,
  DesktopPermissions,
  DetectedIde,
  SkillInfo,
  DocumentTabsLayout,
  CreatePaneSpec,
  IdeCatalogEntry,
  IdeSettings,
  ImportFilesResult,
  MyShareSummary,
  OpenIdeResult,
  PaneSummary,
  PermissionKind,
  PluginRecord,
  PluginScope,
  PluginStatus,
  PullResult,
  PushResult,
  ResourceRef,
  ResourceStatus,
  ShareMember,
  ScaffoldPluginSpec,
  SharedResourceRole,
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
} from "./types.js";

// Adding the `import type` above makes this file a module, not an ambient
// script — `declare global` is required for `interface Window` to actually
// merge with the real global Window type instead of shadowing it locally.
declare global {
  interface Window {
    yggdrasil: {
      projectId: string | null;
      gatewayUrl: string | null;
      gatewayLanUrl: string | null;
      projectName: string | null;
      projectColor: string | null;
      isDefaultProject: boolean;
      platform: NodeJS.Platform;
      windowsBuildNumber: number | undefined;
      phoneLink: {
        get: () => Promise<PhoneLinkInfo>;
        save: (input: { hubUrl?: string; hubKey?: string; publish?: boolean }) => Promise<PhoneLinkInfo>;
        publishNow: () => Promise<PhoneLinkInfo>;
        qr: () => Promise<string>;
      };
      projects: {
        list: () => Promise<ProjectRecord[]>;
        openExisting: () => Promise<ProjectRecord | null>;
        createNew: () => Promise<ProjectRecord | null>;
        open: (id: string) => Promise<boolean>;
        rename: (id: string, name: string) => Promise<ProjectRecord | undefined>;
        setColor: (id: string, color: string | null) => Promise<ProjectRecord | undefined>;
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
        }) => Promise<void>;
        write: (id: string, data: string) => Promise<void>;
        resize: (id: string, cols: number, rows: number) => Promise<void>;
        dispose: (id: string) => Promise<void>;
        read: (id: string, maxChars?: number) => Promise<string | undefined>;
        getLayout: () => Promise<TerminalLayout>;
        saveLayout: (layout: TerminalLayout) => Promise<void>;
        onData: (handler: (id: string, chunk: string) => void) => () => void;
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
          }) => void,
        ) => () => void;
        onMobileFocus: (handler: (id: string, active: boolean) => void) => () => void;
      };
      window: {
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        onMaximizedChange: (handler: (maximized: boolean) => void) => () => void;
      };
      connectors: {
        onOAuthCallback: (handler: (payload: { code: string; state: string }) => void) => () => void;
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
        setBounds: (bounds: BrowserTabBounds) => Promise<void>;
        show: () => Promise<void>;
        hide: () => Promise<void>;
        getUrl: () => Promise<string>;
        startPick: (timeoutMs?: number) => Promise<PickedElement | null>;
        onRequestShow: (handler: () => void) => () => void;
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
        getLayout: () => Promise<PluginTabsLayout>;
        saveLayout: (layout: PluginTabsLayout) => Promise<void>;
        reveal: (dir: string) => Promise<void>;
        scaffold: (spec: ScaffoldPluginSpec) => Promise<PluginRecord>;
        setStatus: (scope: PluginScope, id: string, status: PluginStatus) => Promise<PluginRecord>;
        delete: (scope: PluginScope, id: string) => Promise<void>;
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
      files: {
        importExternal: (destRelativePath: string, sourcePaths: string[]) => Promise<ImportFilesResult>;
        getPathForFile: (file: File) => string;
        pickToImport: () => Promise<string[]>;
        fileUrl: (relativePath: string) => string;
        openExternal: (relativePath: string) => Promise<void>;
      };
      clipboard: {
        readFilePaths: () => Promise<string[]>;
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
      ide: {
        listCatalog: () => Promise<IdeCatalogEntry[]>;
        detectInstalled: () => Promise<DetectedIde[]>;
        getSettings: () => Promise<IdeSettings>;
        saveSettings: (settings: IdeSettings) => Promise<void>;
        pickCustomPath: () => Promise<string | null>;
        openProject: () => Promise<OpenIdeResult>;
        openPath: (relativePath: string) => Promise<OpenIdeResult>;
        revealPath: (relativePath: string, isDir: boolean) => Promise<{ opened: boolean; error?: string }>;
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
