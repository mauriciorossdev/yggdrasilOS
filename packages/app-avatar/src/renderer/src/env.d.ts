/// <reference types="vite/client" />

import type {
  PiperSettings,
  PiperVoiceInfo,
  SttCloudSettings,
  SttSettings,
  TtsCloudSettings,
  TtsCloudResult,
  TtsSettings,
  WhisperBackend,
  WhisperModelName,
  WhisperSettings,
} from "./types.js";

declare global {
  interface Window {
    yggdrasil: {
      gatewayUrl: string | null;
      whisper: {
        getSettings: () => Promise<WhisperSettings>;
        saveSettings: (settings: WhisperSettings) => Promise<void>;
        pickBinary: () => Promise<string | null>;
        findBundledBinary: (backend: WhisperBackend) => Promise<string | null>;
        listModels: () => Promise<WhisperModelName[]>;
        listDownloaded: (modelsDir: string) => Promise<string[]>;
        isDownloaded: (modelsDir: string, name: string) => Promise<boolean>;
        download: (modelsDir: string, name: string) => Promise<void>;
        deleteModel: (modelsDir: string, name: string) => Promise<void>;
        transcribe: (audio: ArrayBuffer, settings: WhisperSettings) => Promise<string>;
        onDownloadProgress: (handler: (payload: { name: string; fraction: number }) => void) => () => void;
      };
      stt: {
        getSettings: () => Promise<SttSettings>;
        saveSettings: (settings: SttSettings) => Promise<void>;
        transcribeCloud: (audio: ArrayBuffer, settings: SttCloudSettings) => Promise<string>;
      };
      piper: {
        getSettings: () => Promise<PiperSettings>;
        saveSettings: (settings: PiperSettings) => Promise<void>;
        pickBinary: () => Promise<string | null>;
        listVoices: () => Promise<PiperVoiceInfo[]>;
        listDownloaded: (voicesDir: string) => Promise<string[]>;
        isDownloaded: (voicesDir: string, id: string) => Promise<boolean>;
        download: (voicesDir: string, id: string) => Promise<void>;
        deleteVoice: (voicesDir: string, id: string) => Promise<void>;
        synthesize: (text: string, settings: PiperSettings) => Promise<ArrayBuffer>;
        onDownloadProgress: (handler: (payload: { id: string; fraction: number }) => void) => () => void;
      };
      log: {
        write: (kind: string, data: Record<string, unknown>) => Promise<void>;
      };
      tts: {
        getSettings: () => Promise<TtsSettings>;
        saveSettings: (settings: TtsSettings) => Promise<void>;
        synthesizeCloud: (text: string, settings: TtsCloudSettings) => Promise<TtsCloudResult>;
      };
    };
  }
}
