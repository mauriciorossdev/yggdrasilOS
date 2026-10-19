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
} from "../types.js";
import { GeneralSection } from "./sections/GeneralSection.js";
import { AgentSection } from "./sections/AgentSection.js";
import { ProvidersSection, buildProvidersPatch } from "./sections/ProvidersSection.js";
import { HarnessSection } from "./sections/HarnessSection.js";
import { ChannelsSection } from "./sections/ChannelsSection.js";
import { McpSection, buildMcpServersPatch } from "./sections/McpSection.js";
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
import type { IdeSettings, SttSettings, SyncSettings, WhisperSettings } from "../types.js";

type Section =
  | "general"
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

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "general", label: "General" },
  { id: "agent", label: "Agent" },
  { id: "providers", label: "Providers" },
  { id: "mcp", label: "MCP" },
  { id: "harness", label: "Harness" },
  { id: "channels", label: "Channels" },
  { id: "stt", label: "STT" },
  { id: "devices", label: "Paired devices" },
  { id: "phone", label: "Teléfono" },
  { id: "connectors", label: "Connectors" },
  { id: "ide", label: "IDE" },
  { id: "skills", label: "Skills" },
  { id: "sync", label: "Compartir" },
  { id: "automation", label: "Automation" },
  { id: "voice", label: "Voz" },
  { id: "transfer", label: "Exportar / Importar" },
];

type Props = {
  onClose: () => void;
  /** Jumps straight to a section instead of "general" — e.g. the title bar's IDE button opening Settings pre-scrolled to "ide" when no IDE is configured yet. */
  initialSection?: Section;
};

export function SettingsView({ onClose, initialSection }: Props) {
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

  if (!config) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
        </div>
      </div>
    );
  }

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
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <XMarkIcon className="hero-icon" />
          </button>
        </div>
        <p className="muted settings-gateway-url">Gateway: {window.yggdrasil.gatewayLanUrl}</p>

        {saved && (
          <p className="banner">
            {savedRequiresRestart
              ? "Saved. Channel changes take effect after the channel is stopped and started again (or the gateway restarts)."
              : "Saved. Applied immediately — no restart needed."}
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
                {s.label}
              </button>
            ))}
          </nav>

          <div className="settings-panel">
            {section === "general" && <GeneralSection config={config} setConfig={setConfig} />}
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
            {section === "mcp" && (
              <McpSection
                config={config}
                setConfig={setConfig}
                mcpStatus={mcpStatus}
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
            Close
          </button>
          <button type="button" onClick={() => void save()}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
