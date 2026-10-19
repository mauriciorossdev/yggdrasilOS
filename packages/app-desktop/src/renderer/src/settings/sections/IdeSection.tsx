import { useEffect, useState } from "react";
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
        Which IDE the title bar's IDE button opens the current project's folder in. Only installed IDEs can be
        selected — reinstall or use "Custom…" below if yours isn't detected.
      </p>

      <label>
        Search
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter IDEs…"
        />
      </label>

      {detectError && <p className="error">{detectError}</p>}

      <div className="ide-option-list">
        {detected === null && !detectError && <p className="muted">Detecting installed IDEs…</p>}
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
              {ide.installed ? "Installed" : "Not found"}
            </span>
          </label>
        ))}
        {detected !== null && filtered.length === 0 && <p className="muted">No IDE matches "{query}".</p>}
      </div>

      <label className="ide-option-row">
        <input
          type="radio"
          name="ide-configured"
          checked={ideSettings.configuredId === "custom"}
          onChange={() => setIdeSettings({ ...ideSettings, configuredId: "custom" })}
        />
        Custom…
      </label>

      {ideSettings.configuredId === "custom" && (
        <>
          <label>
            Label
            <input
              type="text"
              value={ideSettings.customLabel ?? ""}
              onChange={(e) => setIdeSettings({ ...ideSettings, customLabel: e.target.value })}
              placeholder="e.g. Fleet"
            />
          </label>
          <label>
            Executable{window.yggdrasil.platform === "darwin" ? " or .app" : ""}
            <div className="input-with-button">
              <input
                type="text"
                value={ideSettings.customPath ?? ""}
                onChange={(e) => setIdeSettings({ ...ideSettings, customPath: e.target.value })}
                placeholder="Not set — browse to it"
              />
              <button type="button" onClick={() => void pickCustomPath()}>
                Browse…
              </button>
            </div>
          </label>
        </>
      )}

      <h3>Blender</h3>
      <p className="muted">
        Used by "Open in Blender" on 3D files. Leave empty to autodetect
        {detectedBlender ? ` (found: ${detectedBlender})` : detectedBlender === null ? " (none found yet)" : ""}.
      </p>
      <label>
        Blender executable{window.yggdrasil.platform === "darwin" ? " or .app" : ""}
        <div className="input-with-button">
          <input
            type="text"
            value={ideSettings.blenderPath ?? ""}
            onChange={(e) => setIdeSettings({ ...ideSettings, blenderPath: e.target.value || undefined })}
            placeholder="Autodetect"
          />
          <button type="button" onClick={() => void pickBlenderPath()}>
            Browse…
          </button>
        </div>
      </label>
    </section>
  );
}
