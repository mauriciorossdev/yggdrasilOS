import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type {
  ConfigGetResult,
  ConfigPatchResult,
  ConfigShape,
  McpServerStatus,
  PiperSettings,
  ProviderInfo,
  SttSettings,
  TtsSettings,
  WhisperSettings,
} from "../types.js";
import { AgentSection } from "./sections/AgentSection.js";
import { ProvidersSection, buildProvidersPatch } from "./sections/ProvidersSection.js";
import { McpSection, buildMcpServersPatch } from "./sections/McpSection.js";
import { WhisperSection } from "./sections/WhisperSection.js";
import { VoiceSection } from "./sections/VoiceSection.js";

type Section = "agent" | "providers" | "mcp" | "whisper" | "voice";

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "agent", label: "Agent" },
  { id: "providers", label: "Providers" },
  { id: "mcp", label: "MCP" },
  { id: "whisper", label: "STT" },
  { id: "voice", label: "TTS" },
];

type Props = { onClose: () => void };

export function SettingsView({ onClose }: Props) {
  const { call } = useGateway();
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([]);
  const [whisperSettings, setWhisperSettings] = useState<WhisperSettings | null>(null);
  const [piperSettings, setPiperSettings] = useState<PiperSettings | null>(null);
  const [sttSettings, setSttSettings] = useState<SttSettings | null>(null);
  const [ttsSettings, setTtsSettings] = useState<TtsSettings | null>(null);
  const [section, setSection] = useState<Section>("agent");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyEdits, setApiKeyEdits] = useState<Record<string, string>>({});
  const [mcpSecretEdits, setMcpSecretEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const [cfg, p, m, w, v, stt, tts] = await Promise.all([
          call<ConfigGetResult>("config.get"),
          call<{ providers: ProviderInfo[] }>("providers.list"),
          call<{ servers: McpServerStatus[] }>("mcp.status").catch(() => ({ servers: [] })),
          window.yggdrasil.whisper.getSettings(),
          window.yggdrasil.piper.getSettings(),
          window.yggdrasil.stt.getSettings(),
          window.yggdrasil.tts.getSettings(),
        ]);
        setConfig(cfg.config);
        setProviders(p.providers ?? []);
        setMcpStatus(m.servers ?? []);
        setWhisperSettings(w);
        setPiperSettings(v);
        setSttSettings(stt);
        setTtsSettings(tts);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [call]);

  if (!config || !whisperSettings || !piperSettings || !sttSettings || !ttsSettings) {
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
      await Promise.all([
        call<ConfigPatchResult>("config.patch", {
          agents: config.agents,
          providers: buildProvidersPatch(config, apiKeyEdits),
          mcpServers: buildMcpServersPatch(config, mcpSecretEdits),
        }),
        window.yggdrasil.whisper.saveSettings(whisperSettings),
        window.yggdrasil.piper.saveSettings(piperSettings),
        window.yggdrasil.stt.saveSettings(sttSettings),
        window.yggdrasil.tts.saveSettings(ttsSettings),
      ]);
      setApiKeyEdits({});
      setMcpSecretEdits({});
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
            ✕
          </button>
        </div>

        {saved && <p className="banner">Saved. Applied immediately — no restart needed.</p>}
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
            {section === "whisper" && (
              <WhisperSection
                settings={whisperSettings}
                setSettings={setWhisperSettings}
                sttSettings={sttSettings}
                setSttSettings={setSttSettings}
              />
            )}
            {section === "voice" && (
              <VoiceSection
                settings={piperSettings}
                setSettings={setPiperSettings}
                ttsSettings={ttsSettings}
                setTtsSettings={setTtsSettings}
              />
            )}
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
