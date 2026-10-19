import { join } from "node:path";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

export type WhisperBackend = "cpu" | "gpu";

export type WhisperSettings = {
  /** Absolute path to a whisper-server binary. Empty until the user picks one or a bundled default is found. */
  binaryPath: string;
  /** Directory holding downloaded ggml-*.bin models. Defaults to userData/whisper/models. */
  modelsDir: string;
  /** Model file basename without extension, e.g. "base.en" — resolved to `${modelsDir}/ggml-${model}.bin`. */
  model: string;
  /** ISO 639-1 code, or "auto" for whisper.cpp's own language detection. */
  language: string;
  /**
   * Which bundled build binaryPath should auto-resolve to — purely a UI/
   * resolution convenience so the Settings toggle can offer "switch to the
   * CPU/GPU build" without requiring a manual Browse. binaryPath is still
   * the actual source of truth for what gets spawned; a manually-browsed
   * binaryPath overrides this.
   */
  backend: WhisperBackend;
};

export function defaultWhisperSettings(modelsDir: string): WhisperSettings {
  // "small" (multilingual, not the .en-only variant) — Spanish + English use
  // case, an English-only model would silently mistranscribe Spanish input.
  return { binaryPath: "", modelsDir, model: "small", language: "auto", backend: "cpu" };
}

export async function loadWhisperSettings(userDataDir: string): Promise<WhisperSettings> {
  const defaults = defaultWhisperSettings(join(userDataDir, "whisper", "models"));
  const raw = await readSettingsFile(userDataDir);
  return { ...defaults, ...((raw as { whisper?: Partial<WhisperSettings> }).whisper ?? {}) };
}

/** desktop-settings.json also holds stt's settings (nested under "stt") — see settingsFile.ts's shared write queue. */
export async function saveWhisperSettings(userDataDir: string, settings: WhisperSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, whisper: settings }));
}

// --- STT: local (whisper, above) vs cloud dispatcher ---------------------
//
// Cloud providers speak the OpenAI /audio/transcriptions multipart shape —
// OpenAI itself does, and "custom" covers any self-hosted server that mimics
// it (e.g. faster-whisper-server) — one implementation (sttCloud.ts) serves
// both, just with a different baseUrl/model.

export type SttCloudProvider = "openai" | "custom";

export type SttCloudSettings = {
  provider: SttCloudProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type SttSource = "local" | "cloud";

export type SttSettings = {
  source: SttSource;
  cloud: SttCloudSettings;
};

export const STT_CLOUD_PRESETS: Record<SttCloudProvider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
  custom: { baseUrl: "", model: "" },
};

export function defaultSttSettings(): SttSettings {
  return { source: "cloud", cloud: { provider: "openai", ...STT_CLOUD_PRESETS.openai, apiKey: "" } };
}

/** Nested under a "stt" key — same desktop-settings.json file, same write queue, see saveWhisperSettings's comment. */
export async function loadSttSettings(userDataDir: string): Promise<SttSettings> {
  const defaults = defaultSttSettings();
  const raw = await readSettingsFile(userDataDir);
  const stored = (raw as { stt?: Partial<SttSettings> }).stt;
  return { ...defaults, ...stored, cloud: { ...defaults.cloud, ...(stored?.cloud ?? {}) } };
}

export async function saveSttSettings(userDataDir: string, settings: SttSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, stt: settings }));
}
