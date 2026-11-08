import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import type { DetectedIde, IdeSettings } from "../../types.js";

type Props = {
  ideSettings: IdeSettings;
  setIdeSettings: (settings: IdeSettings) => void;
};

/**
 * Which IDE the title bar's "IDE" button (TitleBar.tsx) opens the current
 * project in. Local-only (desktop-settings.json via window.yggdrasil.ide),
 * never sent through the gateway. Detection re-runs every time this section
 * mounts (Settings section switches re-mount it) so a freshly-installed IDE
 * shows up without restarting the app.
 */
export function IdeSection({ ideSettings, setIdeSettings }: Props) {
  const { t } = useI18n();
  const [detected, setDetected] = useState<DetectedIde[] | null>(null);
  const [query, setQuery] = useState("");
  const [detectError, setDetectError] = useState<string | null>(null);

  useEffect(() => {
    void window.yggdrasil.ide
      .detectInstalled()
      .then(setDetected)
      .catch((err) => setDetectError(err instanceof Error ? err.message : String(err)));
  }, []);

  const [detectedBlender, setDetectedBlender] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void window.yggdrasil.ide
      .detectBlender()
      .then(setDetectedBlender)
      .catch(() => setDetectedBlender(null));
  }, []);

  const pickBlenderPath = async () => {
    const path = await window.yggdrasil.ide.pickCustomPath();
    if (path) setIdeSettings({ ...ideSettings, blenderPath: path });
  };

  const filtered = (detected ?? []).filter((ide) => ide.label.toLowerCase().includes(query.trim().toLowerCase()));

  const pickCustomPath = async () => {
    const path = await window.yggdrasil.ide.pickCustomPath();
    if (path) setIdeSettings({ ...ideSettings, configuredId: "custom", customPath: path });
  };

  return (
    <section className="settings-section">
      <h3>IDE</h3>
      <p className="muted">
        {t("set.ide.intro")}
      </p>

      <label>
        {t("set.ide.search")}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("set.ide.filterPh")}
        />
      </label>

      {detectError && <p className="error">{detectError}</p>}

      <div className="ide-option-list">
        {detected === null && !detectError && <p className="muted">{t("set.ide.detecting")}</p>}
        {filtered.map((ide) => (
          <label key={ide.id} className={`ide-option-row ${!ide.installed ? "disabled" : ""}`}>
            <input
              type="radio"
              name="ide-configured"
              checked={ideSettings.configuredId === ide.id}
              disabled={!ide.installed}
              onChange={() => setIdeSettings({ ...ideSettings, configuredId: ide.id })}
            />
            {ide.label}
            <span className={`ide-option-status ${ide.installed ? "installed" : ""}`}>
              {ide.installed ? t("set.ide.installed") : t("set.ide.notFound")}
            </span>
          </label>
        ))}
        {detected !== null && filtered.length === 0 && <p className="muted">{t("set.ide.noMatch", { query })}</p>}
      </div>

      <label className="ide-option-row">
        <input
          type="radio"
          name="ide-configured"
          checked={ideSettings.configuredId === "custom"}
          onChange={() => setIdeSettings({ ...ideSettings, configuredId: "custom" })}
        />
        {t("set.ide.custom")}
      </label>

      {ideSettings.configuredId === "custom" && (
        <>
          <label>
            {t("set.ide.label")}
            <input
              type="text"
              value={ideSettings.customLabel ?? ""}
              onChange={(e) => setIdeSettings({ ...ideSettings, customLabel: e.target.value })}
              placeholder={t("set.ide.labelPh")}
            />
          </label>
          <label>
            {window.yggdrasil.platform === "darwin" ? t("set.ide.exeApp") : t("set.ide.exe")}
            <div className="input-with-button">
              <input
                type="text"
                value={ideSettings.customPath ?? ""}
                onChange={(e) => setIdeSettings({ ...ideSettings, customPath: e.target.value })}
                placeholder={t("set.ide.pathPh")}
              />
              <button type="button" onClick={() => void pickCustomPath()}>
                {t("set.ide.browse")}
              </button>
            </div>
          </label>
        </>
      )}

      <h3>Blender</h3>
      <p className="muted">
        {t("set.ide.blenderHelp")}
        {detectedBlender
          ? t("set.ide.blenderFound", { path: detectedBlender })
          : detectedBlender === null
            ? t("set.ide.blenderNone")
            : ""}
        .
      </p>
      <label>
        {window.yggdrasil.platform === "darwin" ? t("set.ide.blenderExeApp") : t("set.ide.blenderExe")}
        <div className="input-with-button">
          <input
            type="text"
            value={ideSettings.blenderPath ?? ""}
            onChange={(e) => setIdeSettings({ ...ideSettings, blenderPath: e.target.value || undefined })}
            placeholder={t("set.ide.autodetect")}
          />
          <button type="button" onClick={() => void pickBlenderPath()}>
            {t("set.ide.browse")}
          </button>
        </div>
      </label>
    </section>
  );
}
