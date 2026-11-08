import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/index.js";
import type { TtsSettings } from "../../types.js";

// Confirmed preset voice_ids for Replicate's minimax/speech-2.8-turbo model
// (the one tts.ts actually calls) — "Spanish_FrankLady" is this app's own
// long-running default (tts.ts's DEFAULT_VOICE); the rest are the model's
// documented built-in presets. Not exhaustive — MiniMax's full system-voice
// catalog is much larger and changes over time, so the free-text field below
// still accepts any other voice id directly.
const PRESET_VOICES = [
  "Spanish_FrankLady",
  "Wise_Woman",
  "Friendly_Person",
  "Inspirational_girl",
  "Deep_Voice_Man",
  "Calm_Woman",
  "Casual_Guy",
  "Lively_Girl",
  "Patient_Man",
  "Young_Knight",
  "Determined_Man",
  "Lovely_Girl",
  "Decent_Boy",
  "Imposing_Manner",
  "Elegant_Man",
  "Abbess",
  "Sweet_Girl_2",
  "Exuberant_Girl",
];

/**
 * Own load/save cycle via window.yggdrasil.tts (Electron IPC, local to this
 * machine) — same self-contained pattern as AutomationSection.tsx, not the
 * SettingsView-batched-config pattern, since nothing else depends on this.
 */
export function VoiceSection() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<TtsSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.yggdrasil.tts
      .getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const save = async (next: TtsSettings) => {
    setSettings(next);
    setSaving(true);
    try {
      await window.yggdrasil.tts.saveSettings(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>{t("set.voice.title")}</h3>
      <p className="muted">
        {t("set.voice.intro")}
      </p>

      {error && <p className="error">{error}</p>}
      {!settings && !error && <p className="muted">{t("set.voice.loading")}</p>}

      {settings && (
        <>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={saving}
              onChange={(e) => void save({ ...settings, enabled: e.target.checked })}
            />
            {t("set.voice.enable")}
          </label>

          <label>
            {t("set.voice.voice")}
            <select
              value={PRESET_VOICES.includes(settings.voiceId) ? settings.voiceId : ""}
              disabled={saving || !settings.enabled}
              onChange={(e) => {
                if (e.target.value) void save({ ...settings, voiceId: e.target.value });
              }}
            >
              <option value="">
                {settings.voiceId && !PRESET_VOICES.includes(settings.voiceId) ? t("set.voice.customBelow") : t("set.voice.default")}
              </option>
              {PRESET_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("set.voice.voiceId")}
            <input
              type="text"
              value={settings.voiceId}
              placeholder="Spanish_FrankLady"
              disabled={saving || !settings.enabled}
              onChange={(e) => void save({ ...settings, voiceId: e.target.value })}
            />
          </label>

          <label>
            Replicate API token (REPLICATE_API_TOKEN)
            <input
              type="password"
              value={settings.apiToken}
              placeholder={t("set.voice.tokenPlaceholder")}
              disabled={saving || !settings.enabled}
              onChange={(e) => void save({ ...settings, apiToken: e.target.value })}
            />
          </label>
          <p className="muted">
            {t("set.voice.tokenHint")}
          </p>
        </>
      )}
    </section>
  );
}
