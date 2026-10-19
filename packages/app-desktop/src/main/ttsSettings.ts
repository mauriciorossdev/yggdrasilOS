import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

export type TtsSettings = {
  /** Kill switch for every TTS call this gateway makes (tts.synthesize, terminals.speak) — checked gateway-side via desktopTtsOverrides.ts, same pattern as the automation kill switch (killSwitch.ts). */
  enabled: boolean;
  /** Replicate voice id, e.g. "Spanish_FrankLady" — empty lets the gateway fall back to its own default (tts.ts's DEFAULT_VOICE/REPLICATE_TTS_VOICE). */
  voiceId: string;
  /** Replicate API token — overrides this machine's REPLICATE_API_TOKEN env var when set, so TTS can be configured from Settings instead of requiring an env var. Stored locally only (desktop-settings.json), never synced/shared. */
  apiToken: string;
};

export function defaultTtsSettings(): TtsSettings {
  return { enabled: true, voiceId: "", apiToken: "" };
}

/** Nested under a "tts" key — same desktop-settings.json file/write queue as whisper/stt, see whisperSettings.ts's comment. */
export async function loadTtsSettings(userDataDir: string): Promise<TtsSettings> {
  const defaults = defaultTtsSettings();
  const raw = await readSettingsFile(userDataDir);
  return { ...defaults, ...((raw as { tts?: Partial<TtsSettings> }).tts ?? {}) };
}

export async function saveTtsSettings(userDataDir: string, settings: TtsSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, tts: settings }));
}
