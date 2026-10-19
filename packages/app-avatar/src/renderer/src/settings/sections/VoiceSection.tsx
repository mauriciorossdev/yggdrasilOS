import { useEffect, useState } from "react";
import type { PiperSettings, PiperVoiceInfo, TtsCloudProvider, TtsSettings } from "../../types.js";

type Props = {
  settings: PiperSettings;
  setSettings: (settings: PiperSettings) => void;
  ttsSettings: TtsSettings;
  setTtsSettings: (settings: TtsSettings) => void;
};

// Mirrors main/piperSettings.ts's TTS_CLOUD_PRESETS — kept in sync manually
// since main/renderer don't share modules across the Electron process boundary.
const TTS_CLOUD_PRESETS: Record<TtsCloudProvider, { baseUrl: string; model: string }> = {
  minimax: { baseUrl: "https://api.minimax.io/v1", model: "speech-2.8-turbo" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "canopylabs/orpheus-v1-english" },
  replicate: { baseUrl: "https://api.replicate.com/v1", model: "minimax/speech-2.8-turbo" },
  custom: { baseUrl: "", model: "" },
};

export function VoiceSection({ settings, setSettings, ttsSettings, setTtsSettings }: Props) {
  const switchCloudProvider = (provider: TtsCloudProvider) => {
    setTtsSettings({
      ...ttsSettings,
      cloud: { ...ttsSettings.cloud, provider, ...TTS_CLOUD_PRESETS[provider] },
    });
  };

  const [voices, setVoices] = useState<PiperVoiceInfo[]>([]);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});

  const refreshDownloaded = async (voicesDir: string) => {
    const list = await window.yggdrasil.piper.listDownloaded(voicesDir);
    setDownloaded(new Set(list));
  };

  useEffect(() => {
    void window.yggdrasil.piper.listVoices().then(setVoices);
  }, []);

  useEffect(() => {
    if (settings.voicesDir) void refreshDownloaded(settings.voicesDir);
  }, [settings.voicesDir]);

  useEffect(() => {
    return window.yggdrasil.piper.onDownloadProgress(({ id, fraction }) => {
      setDownloadProgress((prev) => ({ ...prev, [id]: fraction }));
    });
  }, []);

  const pickBinary = async () => {
    const path = await window.yggdrasil.piper.pickBinary();
    if (path) setSettings({ ...settings, binaryPath: path });
  };

  const download = async (id: string) => {
    setDownloadProgress((prev) => ({ ...prev, [id]: 0 }));
    setDownloadErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await window.yggdrasil.piper.download(settings.voicesDir, id);
      await refreshDownloaded(settings.voicesDir);
    } catch (err) {
      setDownloadErrors((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const remove = async (id: string) => {
    await window.yggdrasil.piper.deleteVoice(settings.voicesDir, id);
    await refreshDownloaded(settings.voicesDir);
  };

  return (
    <section className="settings-section">
      <h3>TTS (text-to-speech)</h3>

      <label className="input-with-button">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
          style={{ width: "auto" }}
        />
        Read replies aloud
      </label>

      <label>
        Source
        <div className="input-with-button">
          <button
            type="button"
            className={ttsSettings.source === "local" ? "active" : ""}
            onClick={() => setTtsSettings({ ...ttsSettings, source: "local" })}
          >
            Local (Piper)
          </button>
          <button
            type="button"
            className={ttsSettings.source === "cloud" ? "active" : ""}
            onClick={() => setTtsSettings({ ...ttsSettings, source: "cloud" })}
          >
            Cloud
          </button>
        </div>
      </label>

      {ttsSettings.source === "cloud" && (
        <>
          <label>
            Provider
            <select
              value={ttsSettings.cloud.provider}
              onChange={(e) => switchCloudProvider(e.target.value as TtsCloudProvider)}
            >
              <option value="minimax">MiniMax</option>
              <option value="groq">Groq</option>
              <option value="replicate">Replicate</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>
          </label>
          <label>
            Base URL
            <input
              type="text"
              value={ttsSettings.cloud.baseUrl}
              onChange={(e) => setTtsSettings({ ...ttsSettings, cloud: { ...ttsSettings.cloud, baseUrl: e.target.value } })}
              placeholder="https://…"
            />
          </label>
          <label>
            Model
            <input
              type="text"
              value={ttsSettings.cloud.model}
              onChange={(e) => setTtsSettings({ ...ttsSettings, cloud: { ...ttsSettings.cloud, model: e.target.value } })}
              placeholder="speech-2.8-turbo"
            />
          </label>
          <label>
            Voice ID
            <input
              type="text"
              value={ttsSettings.cloud.voiceId}
              onChange={(e) => setTtsSettings({ ...ttsSettings, cloud: { ...ttsSettings.cloud, voiceId: e.target.value } })}
              placeholder="MiniMax e.g. English_radiant_girl · Groq e.g. troy — see the provider's voice list"
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={ttsSettings.cloud.apiKey}
              onChange={(e) => setTtsSettings({ ...ttsSettings, cloud: { ...ttsSettings.cloud, apiKey: e.target.value } })}
              autoComplete="off"
            />
          </label>
          {!ttsSettings.cloud.apiKey && (
            <p className="provider-warning">⚠ No API key set — cloud speech won't work until this is filled in.</p>
          )}
          {!ttsSettings.cloud.voiceId && (
            <p className="provider-warning">⚠ No voice ID set — required by MiniMax's API.</p>
          )}
        </>
      )}

      {ttsSettings.source === "local" && (
        <>
      <label>
        piper.exe path
        <div className="input-with-button">
          <input
            type="text"
            value={settings.binaryPath}
            onChange={(e) => setSettings({ ...settings, binaryPath: e.target.value })}
            placeholder="Not found — browse for piper.exe"
          />
          <button type="button" onClick={() => void pickBinary()}>
            Browse…
          </button>
        </div>
      </label>
      {!settings.binaryPath && (
        <p className="provider-warning">
          ⚠ No Piper binary set. Voice replies won't work until this points at a piper.exe build — text/typed
          replies still work fine.
        </p>
      )}

      <label>
        Voices folder
        <input
          type="text"
          value={settings.voicesDir}
          onChange={(e) => setSettings({ ...settings, voicesDir: e.target.value })}
        />
      </label>

      <div className="whisper-models">
        <p className="muted">
          A voice only speaks its own language well — pick the one matching the language you expect replies in, and
          switch if you switch languages.
        </p>
        {voices.map((v) => {
          const isDownloaded = downloaded.has(v.id);
          const progress = downloadProgress[v.id];
          const error = downloadErrors[v.id];
          return (
            <div key={v.id}>
              <div className={`whisper-model-row ${settings.voice === v.id ? "active" : ""}`}>
                <label className="whisper-model-radio">
                  <input
                    type="radio"
                    name="piper-voice"
                    checked={settings.voice === v.id}
                    disabled={!isDownloaded}
                    onChange={() => setSettings({ ...settings, voice: v.id })}
                  />
                  {v.label}
                </label>
                {progress !== undefined ? (
                  <span className="muted">Downloading… {Math.round(progress * 100)}%</span>
                ) : isDownloaded ? (
                  <button type="button" onClick={() => void remove(v.id)}>
                    Delete
                  </button>
                ) : (
                  <button type="button" onClick={() => void download(v.id)}>
                    Download
                  </button>
                )}
              </div>
              {error && <p className="error">⚠ {error}</p>}
            </div>
          );
        })}
      </div>
        </>
      )}
    </section>
  );
}
