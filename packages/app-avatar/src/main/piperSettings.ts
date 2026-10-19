import { join } from "node:path";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

export type PiperSettings = {
  /** Absolute path to piper.exe. Empty until the user picks one or the bundled default is found. */
  binaryPath: string;
  /** Directory holding downloaded voice .onnx/.onnx.json pairs. Defaults to userData/piper/voices. */
  voicesDir: string;
  /** Voice basename without extension, e.g. "en_US-lessac-medium" — resolved to `${voicesDir}/${voice}.onnx`. */
  voice: string;
  /** Read assistant replies aloud automatically when a turn finishes. */
  enabled: boolean;
};

export function defaultPiperSettings(voicesDir: string): PiperSettings {
  return { binaryPath: "", voicesDir, voice: "es_ES-davefx-medium", enabled: true };
}

export async function loadPiperSettings(userDataDir: string): Promise<PiperSettings> {
  const defaults = defaultPiperSettings(join(userDataDir, "piper", "voices"));
  const raw = await readSettingsFile(userDataDir);
  return { ...defaults, ...((raw as { piper?: Partial<PiperSettings> }).piper ?? {}) };
}

/**
 * Shares the same avatar-settings.json file as whisperSettings.ts, under a
 * "piper" key. Goes through settingsFile.ts's shared write queue — see its
 * comment for why (concurrent whisper+piper saves were corrupting the file).
 */
export async function savePiperSettings(userDataDir: string, settings: PiperSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, piper: settings }));
}

// --- TTS: local (piper, above) vs cloud dispatcher ------------------------
//
// Two request shapes, see ttsCloud.ts:
//  - "minimax": its own bespoke t2a_v2 JSON shape (audio comes back hex-
//    encoded inside the JSON body).
//  - "groq" and "custom": OpenAI's /audio/speech shape (model/input/voice/
//    response_format JSON in, raw binary audio bytes out) — Groq implements
//    it verbatim, and "custom" is any self-hosted server that mimics it,
//    same "one shape, two providers" pattern already used for STT.

export type TtsCloudProvider = "minimax" | "groq" | "custom" | "replicate";

export type TtsCloudSettings = {
  provider: TtsCloudProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  voiceId: string;
};

export type TtsSource = "local" | "cloud";

export type TtsSettings = {
  source: TtsSource;
  cloud: TtsCloudSettings;
};

export const TTS_CLOUD_PRESETS: Record<TtsCloudProvider, { baseUrl: string; model: string }> = {
  minimax: { baseUrl: "https://api.minimax.io/v1", model: "speech-2.8-turbo" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "canopylabs/orpheus-v1-english" },
  replicate: { baseUrl: "https://api.replicate.com/v1", model: "minimax/speech-2.8-turbo" },
  custom: { baseUrl: "", model: "" },
};

export function defaultTtsSettings(): TtsSettings {
  return { source: "cloud", cloud: { provider: "minimax", ...TTS_CLOUD_PRESETS.minimax, apiKey: "", voiceId: "" } };
}

/** Nested under a "tts" key — same avatar-settings.json file, same write queue, see savePiperSettings's comment. */
export async function loadTtsSettings(userDataDir: string): Promise<TtsSettings> {
  const defaults = defaultTtsSettings();
  const raw = await readSettingsFile(userDataDir);
  const stored = (raw as { tts?: Partial<TtsSettings> }).tts;
  return { ...defaults, ...stored, cloud: { ...defaults.cloud, ...(stored?.cloud ?? {}) } };
}

export async function saveTtsSettings(userDataDir: string, settings: TtsSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, tts: settings }));
}
