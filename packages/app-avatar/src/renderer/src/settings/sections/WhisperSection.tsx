import { useEffect, useState } from "react";
import type { SttCloudProvider, SttSettings, WhisperBackend, WhisperModelName, WhisperSettings } from "../../types.js";

type Props = {
  settings: WhisperSettings;
  setSettings: (settings: WhisperSettings) => void;
  sttSettings: SttSettings;
  setSttSettings: (settings: SttSettings) => void;
};

// Mirrors main/whisperSettings.ts's STT_CLOUD_PRESETS — kept in sync manually
// since main/renderer don't share modules across the Electron process boundary.
const STT_CLOUD_PRESETS: Record<SttCloudProvider, { baseUrl: string; model: string }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
  replicate: { baseUrl: "https://api.replicate.com/v1", model: "google/gemini-3-pro" },
  "replicate-whisper": { baseUrl: "https://api.replicate.com/v1", model: "openai/whisper" },
  agy: { baseUrl: "", model: "gemini-3.1-pro-high" },
  custom: { baseUrl: "", model: "" },
};

const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
];

export function WhisperSection({ settings, setSettings, sttSettings, setSttSettings }: Props) {
  const switchCloudProvider = (provider: SttCloudProvider) => {
    setSttSettings({
      ...sttSettings,
      cloud: { ...sttSettings.cloud, provider, ...STT_CLOUD_PRESETS[provider] },
    });
  };

  const [availableModels, setAvailableModels] = useState<WhisperModelName[]>([]);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [bundledBackends, setBundledBackends] = useState<Record<WhisperBackend, boolean>>({
    cpu: false,
    gpu: false,
  });

  const refreshDownloaded = async (modelsDir: string) => {
    const list = await window.yggdrasil.whisper.listDownloaded(modelsDir);
    setDownloaded(new Set(list));
  };

  useEffect(() => {
    void window.yggdrasil.whisper.listModels().then(setAvailableModels);
  }, []);

  useEffect(() => {
    void Promise.all([
      window.yggdrasil.whisper.findBundledBinary("cpu"),
      window.yggdrasil.whisper.findBundledBinary("gpu"),
    ]).then(([cpu, gpu]) => setBundledBackends({ cpu: !!cpu, gpu: !!gpu }));
  }, []);

  useEffect(() => {
    if (settings.modelsDir) void refreshDownloaded(settings.modelsDir);
  }, [settings.modelsDir]);

  useEffect(() => {
    return window.yggdrasil.whisper.onDownloadProgress(({ name, fraction }) => {
      setDownloadProgress((prev) => ({ ...prev, [name]: fraction }));
    });
  }, []);

  const pickBinary = async () => {
    const path = await window.yggdrasil.whisper.pickBinary();
    if (path) setSettings({ ...settings, binaryPath: path });
  };

  /** Switches the backend and, if a matching bundled build was found, auto-fills binaryPath to it. Otherwise just records the intent — the user browses to their own build. */
  const switchBackend = async (backend: WhisperBackend) => {
    const bundled = await window.yggdrasil.whisper.findBundledBinary(backend);
    setSettings({ ...settings, backend, binaryPath: bundled ?? settings.binaryPath });
  };

  const download = async (name: string) => {
    setDownloadProgress((prev) => ({ ...prev, [name]: 0 }));
    try {
      await window.yggdrasil.whisper.download(settings.modelsDir, name);
      await refreshDownloaded(settings.modelsDir);
    } finally {
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const remove = async (name: string) => {
    await window.yggdrasil.whisper.deleteModel(settings.modelsDir, name);
    await refreshDownloaded(settings.modelsDir);
  };

  return (
    <section className="settings-section">
      <h3>STT (speech-to-text)</h3>

      <label>
        Source
        <div className="input-with-button">
          <button
            type="button"
            className={sttSettings.source === "local" ? "active" : ""}
            onClick={() => setSttSettings({ ...sttSettings, source: "local" })}
          >
            Local (Whisper)
          </button>
          <button
            type="button"
            className={sttSettings.source === "cloud" ? "active" : ""}
            onClick={() => setSttSettings({ ...sttSettings, source: "cloud" })}
          >
            Cloud
          </button>
        </div>
      </label>

      {sttSettings.source === "cloud" && (
        <>
          <label>
            Provider
            <select
              value={sttSettings.cloud.provider}
              onChange={(e) => switchCloudProvider(e.target.value as SttCloudProvider)}
            >
              <option value="groq">Groq</option>
              <option value="replicate">Replicate (Gemini)</option>
              <option value="replicate-whisper">Replicate (Whisper)</option>
              <option value="agy">Antigravity CLI (agy)</option>
              <option value="openai">OpenAI</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>
          </label>
          <label>
            Base URL
            <input
              type="text"
              value={sttSettings.cloud.baseUrl}
              onChange={(e) => setSttSettings({ ...sttSettings, cloud: { ...sttSettings.cloud, baseUrl: e.target.value } })}
              placeholder="https://…"
            />
          </label>
          <label>
            Model
            <input
              type="text"
              value={sttSettings.cloud.model}
              onChange={(e) => setSttSettings({ ...sttSettings, cloud: { ...sttSettings.cloud, model: e.target.value } })}
              placeholder="whisper-large-v3-turbo"
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={sttSettings.cloud.apiKey}
              onChange={(e) => setSttSettings({ ...sttSettings, cloud: { ...sttSettings.cloud, apiKey: e.target.value } })}
              autoComplete="off"
            />
          </label>
          {!sttSettings.cloud.apiKey && (
            <p className="provider-warning">⚠ No API key set — cloud transcription won't work until this is filled in.</p>
          )}
        </>
      )}

      {sttSettings.source === "local" && (
        <>
      <label>
        Backend
        <div className="input-with-button">
          <button
            type="button"
            className={settings.backend === "cpu" ? "active" : ""}
            onClick={() => void switchBackend("cpu")}
          >
            CPU
          </button>
          <button
            type="button"
            className={settings.backend === "gpu" ? "active" : ""}
            onClick={() => void switchBackend("gpu")}
          >
            GPU (CUDA)
          </button>
        </div>
      </label>
      {settings.backend === "gpu" && !bundledBackends.gpu && (
        <p className="provider-warning">
          ⚠ No bundled CUDA build found. Point "whisper-server.exe path" below at your own CUDA whisper.cpp build
          manually — needs an NVIDIA GPU and a compatible driver.
        </p>
      )}
      <p className="muted">
        Same model, same settings, different binary — switch back and forth to compare speed. CPU always works; GPU
        needs an NVIDIA card and a CUDA-enabled whisper-server build.
      </p>

      <label>
        whisper-server.exe path
        <div className="input-with-button">
          <input
            type="text"
            value={settings.binaryPath}
            onChange={(e) => setSettings({ ...settings, binaryPath: e.target.value })}
            placeholder="Not found — browse for whisper-server.exe"
          />
          <button type="button" onClick={() => void pickBinary()}>
            Browse…
          </button>
        </div>
      </label>
      <p className="muted">
        Transcription runs against a persistent whisper-server process (loads the model into RAM once, not on every
        push-to-talk) — this must point at <code>whisper-server.exe</code>, not <code>whisper-cli.exe</code>.
      </p>
      {!settings.binaryPath && (
        <p className="provider-warning">
          ⚠ No whisper-server binary set. Build or download a Windows whisper.cpp release (whisper-server.exe) and
          point this at it — voice input won't work until then. Text chat still works.
        </p>
      )}

      <label>
        Models folder
        <input
          type="text"
          value={settings.modelsDir}
          onChange={(e) => setSettings({ ...settings, modelsDir: e.target.value })}
        />
      </label>

      <label>
        Language
        <select value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <div className="whisper-models">
        <p className="muted">
          Model size trades off speed for accuracy — tiny/base for fast replies, small/medium for better accuracy on
          a desktop machine.
        </p>
        {availableModels.map((name) => {
          const isDownloaded = downloaded.has(name);
          const progress = downloadProgress[name];
          return (
            <div key={name} className={`whisper-model-row ${settings.model === name ? "active" : ""}`}>
              <label className="whisper-model-radio">
                <input
                  type="radio"
                  name="whisper-model"
                  checked={settings.model === name}
                  disabled={!isDownloaded}
                  onChange={() => setSettings({ ...settings, model: name })}
                />
                {name}
              </label>
              {progress !== undefined ? (
                <span className="muted">Downloading… {Math.round(progress * 100)}%</span>
              ) : isDownloaded ? (
                <button type="button" onClick={() => void remove(name)}>
                  Delete
                </button>
              ) : (
                <button type="button" onClick={() => void download(name)}>
                  Download
                </button>
              )}
            </div>
          );
        })}
      </div>
        </>
      )}
    </section>
  );
}
