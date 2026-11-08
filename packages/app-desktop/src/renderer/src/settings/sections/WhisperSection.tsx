import { useEffect, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import { useI18n } from "../../i18n/index.js";
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
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
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
  const { t } = useI18n();
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
      <h3>{t("set.whisper.title")}</h3>

      <label>
        {t("set.whisper.source")}
        <div className="input-with-button">
          <button
            type="button"
            className={sttSettings.source === "local" ? "active" : ""}
            onClick={() => setSttSettings({ ...sttSettings, source: "local" })}
          >
            {t("set.whisper.sourceLocal")}
          </button>
          <button
            type="button"
            className={sttSettings.source === "cloud" ? "active" : ""}
            onClick={() => setSttSettings({ ...sttSettings, source: "cloud" })}
          >
            {t("set.whisper.sourceCloud")}
          </button>
        </div>
      </label>

      {sttSettings.source === "cloud" && (
        <>
          <label>
            {t("set.whisper.provider")}
            <select
              value={sttSettings.cloud.provider}
              onChange={(e) => switchCloudProvider(e.target.value as SttCloudProvider)}
            >
              <option value="openai">OpenAI</option>
              <option value="custom">{t("set.whisper.providerCustom")}</option>
            </select>
          </label>
          <label>
            {t("set.whisper.baseUrl")}
            <input
              type="text"
              value={sttSettings.cloud.baseUrl}
              onChange={(e) => setSttSettings({ ...sttSettings, cloud: { ...sttSettings.cloud, baseUrl: e.target.value } })}
              placeholder="https://…"
            />
          </label>
          <label>
            {t("set.whisper.model")}
            <input
              type="text"
              value={sttSettings.cloud.model}
              onChange={(e) => setSttSettings({ ...sttSettings, cloud: { ...sttSettings.cloud, model: e.target.value } })}
              placeholder="whisper-large-v3-turbo"
            />
          </label>
          <label>
            {t("set.whisper.apiKey")}
            <input
              type="password"
              value={sttSettings.cloud.apiKey}
              onChange={(e) => setSttSettings({ ...sttSettings, cloud: { ...sttSettings.cloud, apiKey: e.target.value } })}
              autoComplete="off"
            />
          </label>
          {!sttSettings.cloud.apiKey && (
            <p className="provider-warning">
              <ExclamationTriangleIcon className="hero-icon" />{" "}
              {t("set.whisper.noApiKey")}
            </p>
          )}
        </>
      )}

      {sttSettings.source === "local" && (
        <>
          <label>
            {t("set.whisper.backend")}
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
                GPU
              </button>
            </div>
          </label>
          {settings.backend === "gpu" && !bundledBackends.gpu && (
            <p className="provider-warning">
              <ExclamationTriangleIcon className="hero-icon" />{" "}
              {t("set.whisper.noGpu")}
            </p>
          )}
          <p className="muted">
            {t("set.whisper.backendHint")}
          </p>

          <label>
            {t("set.whisper.serverPath")}
            <div className="input-with-button">
              <input
                type="text"
                value={settings.binaryPath}
                onChange={(e) => setSettings({ ...settings, binaryPath: e.target.value })}
                placeholder={t("set.whisper.serverPathPlaceholder")}
              />
              <button type="button" onClick={() => void pickBinary()}>
                {t("set.whisper.browse")}
              </button>
            </div>
          </label>
          <p className="muted">
            {t("set.whisper.serverHintA")} <code>whisper-server</code>
            {t("set.whisper.serverHintB")} <code>whisper-cli</code>.
          </p>
          {!settings.binaryPath && (
            <p className="provider-warning">
              <ExclamationTriangleIcon className="hero-icon" />{" "}
              {t("set.whisper.noBinary")}
            </p>
          )}

          <label>
            {t("set.whisper.modelsFolder")}
            <input
              type="text"
              value={settings.modelsDir}
              onChange={(e) => setSettings({ ...settings, modelsDir: e.target.value })}
            />
          </label>

          <label>
            {t("set.whisper.language")}
            <select value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code === "auto" ? t("set.whisper.autoDetect") : l.label}
                </option>
              ))}
            </select>
          </label>

          <div className="whisper-models">
            <p className="muted">
              {t("set.whisper.modelHint")}
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
                    <span className="muted">{t("set.whisper.downloading", { pct: Math.round(progress * 100) })}</span>
                  ) : isDownloaded ? (
                    <button type="button" onClick={() => void remove(name)}>
                      {t("set.whisper.delete")}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void download(name)}>
                      {t("set.whisper.download")}
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
