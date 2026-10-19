import { join } from "node:path";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

export type WhisperBackend = "cpu" | "gpu";

export type WhisperSettings = {
  /** Absolute path to a whisper-server.exe binary. Empty until the user picks one or the bundled default is found. */
  binaryPath: string;
  /** Directory holding downloaded ggml-*.bin models. Defaults to userData/whisper/models. */
  modelsDir: string;
  /** Model file basename without extension, e.g. "base.en" — resolved to `${modelsDir}/ggml-${model}.bin`. */
  model: string;
  /** ISO 639-1 code, or "auto" for whisper.cpp's own language detection. */
  language: string;
  /**
   * Which bundled build binaryPath should auto-resolve to (resources/whisper/win/
   * for cpu, resources/whisper/win-gpu/ for a CUDA build) — purely a UI/resolution
   * convenience so the Settings toggle can offer "switch to the CPU/GPU build" without
   * requiring a manual Browse. binaryPath is still the actual source of truth for
   * what gets spawned; a manually-browsed binaryPath overrides this.
   */
  backend: WhisperBackend;
};

export function defaultWhisperSettings(modelsDir: string): WhisperSettings {
  // "small" (multilingual, not the .en-only variant) — default use case is
  // Spanish + English, so an English-only model would silently mistranscribe
  // Spanish input.
  return { binaryPath: "", modelsDir, model: "small", language: "auto", backend: "cpu" };
}

export async function loadWhisperSettings(userDataDir: string): Promise<WhisperSettings> {
  const defaults = defaultWhisperSettings(join(userDataDir, "whisper", "models"));
  const raw = await readSettingsFile(userDataDir);
  return { ...defaults, ...(raw as Partial<WhisperSettings>) };
}

/**
 * avatar-settings.json also holds piper's settings (nested under a "piper"
 * key — see piperSettings.ts). Both go through settingsFile.ts's shared
 * write queue so concurrent whisper+piper saves (e.g. Settings' Save button,
 * which fires both via Promise.all) can't race and corrupt the file.
 */
export async function saveWhisperSettings(userDataDir: string, settings: WhisperSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, ...settings }));
}

// --- STT: local (whisper, above) vs cloud dispatcher ---------------------
//
// Cloud providers speak the OpenAI /audio/transcriptions multipart shape —
// Groq and OpenAI itself both do, and "custom" covers any self-hosted server
// that mimics it (e.g. faster-whisper-server) — one implementation
// (sttCloud.ts) serves all three, just with a different baseUrl/model.

export type SttCloudProvider = "groq" | "openai" | "custom" | "replicate" | "replicate-whisper" | "agy";

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
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
  replicate: { baseUrl: "https://api.replicate.com/v1", model: "google/gemini-3-pro" },
  "replicate-whisper": { baseUrl: "https://api.replicate.com/v1", model: "openai/whisper" },
  agy: { baseUrl: "", model: "gemini-3.1-pro-high" },
  custom: { baseUrl: "", model: "" },
};

export function defaultSttSettings(): SttSettings {
  return { source: "cloud", cloud: { provider: "groq", ...STT_CLOUD_PRESETS.groq, apiKey: "" } };
}

/** Nested under a "stt" key — same avatar-settings.json file, same write queue, see saveWhisperSettings's comment. */
export async function loadSttSettings(userDataDir: string): Promise<SttSettings> {
  const defaults = defaultSttSettings();
  const raw = await readSettingsFile(userDataDir);
  const stored = (raw as { stt?: Partial<SttSettings> }).stt;
  return { ...defaults, ...stored, cloud: { ...defaults.cloud, ...(stored?.cloud ?? {}) } };
}

export async function saveSttSettings(userDataDir: string, settings: SttSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, stt: settings }));
}
