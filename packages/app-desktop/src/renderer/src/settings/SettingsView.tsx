import { useEffect, useState } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import type {
  ConfigGetResult,
  ConfigPatchResult,
  ConfigShape,
  HarnessInfo,
  McpServerStatus,
  ProviderInfo,
  McpTestResult,
} from "../types.js";
import { GeneralSection } from "./sections/GeneralSection.js";
import { AgentSection } from "./sections/AgentSection.js";
import { ProvidersSection, buildProvidersPatch } from "./sections/ProvidersSection.js";
import { HarnessSection } from "./sections/HarnessSection.js";
import { ChannelsSection } from "./sections/ChannelsSection.js";
import { McpSection, buildMcpServersPatch } from "./sections/McpSection.js";
import { OnboardingSection } from "./sections/OnboardingSection.js";
import { WhisperSection } from "./sections/WhisperSection.js";
import { PairedDevicesSection } from "./sections/PairedDevicesSection.js";
import { PhoneLinkSection } from "./sections/PhoneLinkSection.js";
import { ConnectorsSection } from "./sections/ConnectorsSection.js";
import { IdeSection } from "./sections/IdeSection.js";
import { SkillsSection } from "./sections/SkillsSection.js";
import { SyncSection } from "./sections/SyncSection.js";
import { AutomationSection } from "./sections/AutomationSection.js";
import { VoiceSection } from "./sections/VoiceSection.js";
import { TransferSection } from "./sections/TransferSection.js";
import { AppearanceSection } from "./sections/AppearanceSection.js";
import { EditorSection } from "./sections/EditorSection.js";
import { WorkspaceSection } from "./sections/WorkspaceSection.js";
import type { IdeSettings, SttSettings, SyncSettings, WhisperSettings } from "../types.js";
import { useI18n, type MessageKey } from "../i18n/index.js";

type Section =
  | "onboarding"
  | "general"
  | "appearance"
  | "editor"
  | "workspace"
  | "agent"
  | "providers"
  | "mcp"
  | "harness"
  | "channels"
  | "stt"
  | "devices"
  | "phone"
  | "connectors"
  | "ide"
  | "skills"
  | "sync"
  | "automation"
  | "voice"
  | "transfer";

const SECTIONS: Array<{ id: Section; label: MessageKey }> = [
  { id: "general", label: "set.nav.general" },
  { id: "appearance", label: "set.nav.appearance" },
  { id: "editor", label: "set.nav.editor" },
  { id: "workspace", label: "set.nav.workspace" },
  { id: "agent", label: "set.nav.agent" },
  { id: "providers", label: "set.nav.providers" },
  { id: "mcp", label: "set.nav.mcp" },
  { id: "harness", label: "set.nav.harness" },
  { id: "channels", label: "set.nav.channels" },
  { id: "stt", label: "set.nav.stt" },
  { id: "devices", label: "set.nav.devices" },
  { id: "phone", label: "set.nav.phone" },
  { id: "connectors", label: "set.nav.connectors" },
  { id: "ide", label: "set.nav.ide" },
  { id: "onboarding", label: "set.nav.onboarding" },
  { id: "skills", label: "set.nav.skills" },
  { id: "sync", label: "set.nav.sync" },
  { id: "automation", label: "set.nav.automation" },
  { id: "voice", label: "set.nav.voice" },
  { id: "transfer", label: "set.nav.transfer" },
];

type Props = {
  onClose: () => void;
  /** Jumps straight to a section instead of "general" — e.g. the title bar's IDE button opening Settings pre-scrolled to "ide" when no IDE is configured yet. */
  initialSection?: Section;
};

export function SettingsView({ onClose, initialSection }: Props) {
  const { t } = useI18n();
  const { call } = useGateway();
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([]);
  const [section, setSection] = useState<Section>(initialSection ?? "general");
  const [saved, setSaved] = useState(false);
  const [savedRequiresRestart, setSavedRequiresRestart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyEdits, setApiKeyEdits] = useState<Record<string, string>>({});
  const [mcpSecretEdits, setMcpSecretEdits] = useState<Record<string, string>>({});
  // Whisper/STT settings don't go through the gateway's config.patch — they're
  // local-only (Electron IPC, desktop-settings.json), same pattern app-avatar
  // uses. Loaded/saved alongside config here so there's still one Settings
  // modal and one Save button.
  const [whisperSettings, setWhisperSettings] = useState<WhisperSettings | null>(null);
  const [sttSettings, setSttSettings] = useState<SttSettings | null>(null);
  // Local-only (Electron IPC, desktop-settings.json), same non-gateway
  // pattern as whisper/stt above — see main/ideSettings.ts.
  const [ideSettings, setIdeSettings] = useState<IdeSettings | null>(null);
  // Same local-only pattern as ideSettings above — see main/syncSettings.ts.
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, h, p, m, whisper, stt, ide, sync] = await Promise.all([
          call<ConfigGetResult>("config.get"),
          call<{ harnesses: HarnessInfo[] }>("harnesses.list"),
          call<{ providers: ProviderInfo[] }>("providers.list"),
          call<{ servers: McpServerStatus[] }>("mcp.status").catch(() => ({ servers: [] })),
          window.yggdrasil.whisper.getSettings(),
          window.yggdrasil.stt.getSettings(),
          window.yggdrasil.ide.getSettings(),
          window.yggdrasil.sync.getSettings(),
        ]);
        setConfig(cfg.config);
        setHarnesses(h.harnesses ?? []);
        setProviders(p.providers ?? []);
        setMcpStatus(m.servers ?? []);
        setWhisperSettings(whisper);
        setSttSettings(stt);
        setIdeSettings(ide);
        setSyncSettings(sync);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [call]);

  // Servers connect in the background, so keep refreshing while any is still
  // coming up instead of showing a stale "connecting".
  const anyConnecting = mcpStatus.some((s) => s.state === "connecting");
  useEffect(() => {
    if (!anyConnecting) return;
    const timer = setInterval(() => {
      call<{ servers: McpServerStatus[] }>("mcp.status")
        .then((m) => setMcpStatus(m.servers ?? []))
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [anyConnecting, call]);

  const mcpAction = async (method: "mcp.reconnect" | "mcp.disconnect", serverId: string) => {
    setError(null);
    // Mark it connecting right away; the reconnect call itself only returns once it settles.
    if (method === "mcp.reconnect") {
      setMcpStatus((cur) => cur.map((s) => (s.id === serverId ? { ...s, state: "connecting", connected: false } : s)));
    }
    try {
      const m = await call<{ servers: McpServerStatus[] }>(method, { serverId });
      setMcpStatus(m.servers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!config) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          {error ? <p className="error">{error}</p> : <p className="muted">{t("ui.loading")}</p>}
        </div>
      </div>
    );
  }

  // Try the server as it is in the form (unsaved edits included); blank secrets fall back to the saved ones server-side.
  const mcpTest = (serverId: string): Promise<McpTestResult> => {
    const server = buildMcpServersPatch(config, mcpSecretEdits)[serverId];
    return call<McpTestResult>("mcp.test", { serverId, server });
  };

  const save = async () => {
    setSaved(false);
    setError(null);
    try {
      const result = await call<ConfigPatchResult>("config.patch", {
        agents: config.agents,
        defaultAgent: config.defaultAgent,
        language: config.language,
        harness: config.harness,
        channels: config.channels,
        providers: buildProvidersPatch(config, apiKeyEdits),
        mcpServers: buildMcpServersPatch(config, mcpSecretEdits),
      });
      if (whisperSettings) await window.yggdrasil.whisper.saveSettings(whisperSettings);
      if (sttSettings) await window.yggdrasil.stt.saveSettings(sttSettings);
      if (ideSettings) await window.yggdrasil.ide.saveSettings(ideSettings);
      if (syncSettings) await window.yggdrasil.sync.saveSettings(syncSettings);
      setApiKeyEdits({});
      setMcpSecretEdits({});
      setSavedRequiresRestart(result.requiresRestart);
      setSaved(true);
      // Apply MCP changes live (connect new/changed, drop removed) — no restart.
      await call("mcp.reload").catch(() => undefined);
      const [p, m] = await Promise.all([
        call<{ providers: ProviderInfo[] }>("providers.list"),
        call<{ servers: McpServerStatus[] }>("mcp.status").catch(() => ({ servers: [] })),
      ]);
      setProviders(p.providers ?? []);
      setMcpStatus(m.servers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-view" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("set.title")}</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <XMarkIcon className="hero-icon" />
          </button>
        </div>
        <p className="muted settings-gateway-url">Gateway: {window.yggdrasil.gatewayLanUrl}</p>

        {saved && (
          <p className="banner">
            {savedRequiresRestart
              ? t("set.savedRestart")
              : t("set.saved")}
          </p>
        )}
        {error && <p className="error">{error}</p>}

        <div className="settings-body">
          <nav className="settings-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`settings-nav-item ${section === s.id ? "active" : ""}`}
                onClick={() => setSection(s.id)}
              >
                {t(s.label)}
              </button>
            ))}
          </nav>

          <div className="settings-panel">
            {section === "general" && <GeneralSection config={config} setConfig={setConfig} />}
            {section === "appearance" && <AppearanceSection />}
            {section === "editor" && <EditorSection />}
            {section === "workspace" && <WorkspaceSection />}
            {section === "agent" && <AgentSection config={config} setConfig={setConfig} providers={providers} />}
            {section === "providers" && (
              <ProvidersSection
                config={config}
                setConfig={setConfig}
                providers={providers}
                apiKeyEdits={apiKeyEdits}
                setApiKeyEdits={setApiKeyEdits}
              />
            )}
            {section === "onboarding" && <OnboardingSection />}
            {section === "mcp" && (
              <McpSection
                config={config}
                setConfig={setConfig}
                mcpStatus={mcpStatus}
                onMcpAction={mcpAction}
                onMcpTest={mcpTest}
                mcpSecretEdits={mcpSecretEdits}
                setMcpSecretEdits={setMcpSecretEdits}
              />
            )}
            {section === "harness" && (
              <HarnessSection config={config} setConfig={setConfig} harnesses={harnesses} />
            )}
            {section === "channels" && <ChannelsSection config={config} setConfig={setConfig} />}
            {section === "stt" && whisperSettings && sttSettings && (
              <WhisperSection
                settings={whisperSettings}
                setSettings={setWhisperSettings}
                sttSettings={sttSettings}
                setSttSettings={setSttSettings}
              />
            )}
            {section === "devices" && <PairedDevicesSection />}
            {section === "phone" && <PhoneLinkSection />}
            {section === "connectors" && <ConnectorsSection />}
            {section === "sync" && syncSettings && (
              <SyncSection syncSettings={syncSettings} setSyncSettings={setSyncSettings} />
            )}
            {section === "ide" && ideSettings && (
              <IdeSection ideSettings={ideSettings} setIdeSettings={setIdeSettings} />
            )}
            {section === "skills" && <SkillsSection />}
            {section === "automation" && <AutomationSection />}
            {section === "voice" && <VoiceSection />}
            {section === "transfer" && <TransferSection />}
          </div>
        </div>

        <div className="agent-form-actions">
          <button type="button" onClick={onClose}>
            {t("ui.close")}
          </button>
          <button type="button" onClick={() => void save()}>
            {t("set.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
