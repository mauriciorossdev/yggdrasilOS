import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
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
} from "../renderer/src/types.js";

function readArg(flag: string): string | null {
  const prefix = `${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

const api = {
  gatewayUrl: readArg("--ygg-gateway-url"),
  whisper: {
    getSettings: (): Promise<WhisperSettings> => ipcRenderer.invoke("whisper:getSettings"),
    saveSettings: (settings: WhisperSettings): Promise<void> => ipcRenderer.invoke("whisper:saveSettings", settings),
    pickBinary: (): Promise<string | null> => ipcRenderer.invoke("whisper:pickBinary"),
    findBundledBinary: (backend: WhisperBackend): Promise<string | null> =>
      ipcRenderer.invoke("whisper:findBundledBinary", backend),
    listModels: (): Promise<WhisperModelName[]> => ipcRenderer.invoke("whisper:listModels"),
    listDownloaded: (modelsDir: string): Promise<string[]> => ipcRenderer.invoke("whisper:listDownloaded", modelsDir),
    isDownloaded: (modelsDir: string, name: string): Promise<boolean> =>
      ipcRenderer.invoke("whisper:isDownloaded", modelsDir, name),
    download: (modelsDir: string, name: string): Promise<void> =>
      ipcRenderer.invoke("whisper:download", modelsDir, name),
    deleteModel: (modelsDir: string, name: string): Promise<void> =>
      ipcRenderer.invoke("whisper:deleteModel", modelsDir, name),
    transcribe: (audio: ArrayBuffer, settings: WhisperSettings): Promise<string> =>
      ipcRenderer.invoke("whisper:transcribe", audio, settings),
    onDownloadProgress: (handler: (payload: { name: string; fraction: number }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { name: string; fraction: number }) => handler(payload);
      ipcRenderer.on("whisper:downloadProgress", listener);
      return () => ipcRenderer.removeListener("whisper:downloadProgress", listener);
    },
  },
  stt: {
    getSettings: (): Promise<SttSettings> => ipcRenderer.invoke("stt:getSettings"),
    saveSettings: (settings: SttSettings): Promise<void> => ipcRenderer.invoke("stt:saveSettings", settings),
    transcribeCloud: (audio: ArrayBuffer, settings: SttCloudSettings): Promise<string> =>
      ipcRenderer.invoke("stt:transcribeCloud", audio, settings),
  },
  piper: {
    getSettings: (): Promise<PiperSettings> => ipcRenderer.invoke("piper:getSettings"),
    saveSettings: (settings: PiperSettings): Promise<void> => ipcRenderer.invoke("piper:saveSettings", settings),
    pickBinary: (): Promise<string | null> => ipcRenderer.invoke("piper:pickBinary"),
    listVoices: (): Promise<PiperVoiceInfo[]> => ipcRenderer.invoke("piper:listVoices"),
    listDownloaded: (voicesDir: string): Promise<string[]> => ipcRenderer.invoke("piper:listDownloaded", voicesDir),
    isDownloaded: (voicesDir: string, id: string): Promise<boolean> =>
      ipcRenderer.invoke("piper:isDownloaded", voicesDir, id),
    download: (voicesDir: string, id: string): Promise<void> => ipcRenderer.invoke("piper:download", voicesDir, id),
    deleteVoice: (voicesDir: string, id: string): Promise<void> =>
      ipcRenderer.invoke("piper:deleteVoice", voicesDir, id),
    synthesize: (text: string, settings: PiperSettings): Promise<ArrayBuffer> =>
      ipcRenderer.invoke("piper:synthesize", text, settings),
    onDownloadProgress: (handler: (payload: { id: string; fraction: number }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { id: string; fraction: number }) => handler(payload);
      ipcRenderer.on("piper:downloadProgress", listener);
      return () => ipcRenderer.removeListener("piper:downloadProgress", listener);
    },
  },
  log: {
    write: (kind: string, data: Record<string, unknown>): Promise<void> => ipcRenderer.invoke("log:write", kind, data),
  },
  tts: {
    getSettings: (): Promise<TtsSettings> => ipcRenderer.invoke("tts:getSettings"),
    saveSettings: (settings: TtsSettings): Promise<void> => ipcRenderer.invoke("tts:saveSettings", settings),
    synthesizeCloud: (text: string, settings: TtsCloudSettings): Promise<TtsCloudResult> =>
      ipcRenderer.invoke("tts:synthesizeCloud", text, settings),
  },
};

contextBridge.exposeInMainWorld("yggdrasil", api);

export type YggdrasilAvatarPreloadApi = typeof api;
