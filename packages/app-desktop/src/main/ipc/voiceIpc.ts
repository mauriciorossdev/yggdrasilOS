// IPC for speech: local Whisper, cloud speech to text and text to speech.
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, dialog, ipcMain } from "electron";
import { mt } from "../i18n.js";
import { transcribeCloud } from "../sttCloud.js";
import { type TtsSettings, loadTtsSettings, saveTtsSettings } from "../ttsSettings.js";
import {
  WHISPER_MODELS,
  deleteModel,
  downloadModel,
  fileExists,
  findBundledBinary as findBundledWhisperBinary,
  isModelDownloaded,
  listDownloadedModels,
} from "../whisper.js";
import { ensureWhisperServer, transcribeViaServer } from "../whisperServer.js";
import {
  type SttSettings,
  type WhisperSettings,
  loadSttSettings,
  loadWhisperSettings,
  saveSttSettings,
  saveWhisperSettings,
} from "../whisperSettings.js";

async function resolveInitialWhisperBinaryPath(resourcesDir: string, current: string, backend: WhisperSettings["backend"]): Promise<string> {
  if (current) return current;
  return (await findBundledWhisperBinary(resourcesDir, backend)) ?? "";
}

type Deps = {
  /** The folder with the app's bundled binaries. */
  resourcesDir: () => string;
};

export function registerVoiceIpc({ resourcesDir }: Deps): void {
  ipcMain.handle("whisper:getSettings", async (): Promise<WhisperSettings> => {
    const settings = await loadWhisperSettings(app.getPath("userData"));
    settings.binaryPath = await resolveInitialWhisperBinaryPath(resourcesDir(), settings.binaryPath, settings.backend);
    return settings;
  });
  // Used by the Settings CPU/GPU toggle to look up the matching bundled
  // build's path (if present) without saving — the renderer decides whether
  // to adopt it into binaryPath.
  ipcMain.handle("whisper:findBundledBinary", async (_event, backend: WhisperSettings["backend"]) =>
    findBundledWhisperBinary(resourcesDir(), backend),
  );
  ipcMain.handle("whisper:saveSettings", async (_event, settings: WhisperSettings) => {
    await saveWhisperSettings(app.getPath("userData"), settings);
  });
  ipcMain.handle("whisper:pickBinary", async () => {
    const result = await dialog.showOpenDialog({
      title: mt("whisper.pickBinary"),
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  });
  ipcMain.handle("whisper:listModels", () => WHISPER_MODELS);
  ipcMain.handle("whisper:listDownloaded", async (_event, modelsDir: string) => listDownloadedModels(modelsDir));
  ipcMain.handle("whisper:isDownloaded", async (_event, modelsDir: string, name: string) =>
    isModelDownloaded(modelsDir, name),
  );
  ipcMain.handle("whisper:download", async (event, modelsDir: string, name: string) => {
    await downloadModel(modelsDir, name, (fraction) => {
      event.sender.send("whisper:downloadProgress", { name, fraction });
    });
  });
  ipcMain.handle("whisper:deleteModel", async (_event, modelsDir: string, name: string) => {
    await deleteModel(modelsDir, name);
  });
  ipcMain.handle(
    "whisper:transcribe",
    async (_event, audioBytes: ArrayBuffer, settings: WhisperSettings): Promise<string> => {
      if (!(await fileExists(settings.binaryPath))) {
        throw new Error(`whisper-server binary not found at "${settings.binaryPath}". Set it in Settings → STT.`);
      }
      const modelPath = join(settings.modelsDir, `ggml-${settings.model}.bin`);
      if (!(await fileExists(modelPath))) {
        throw new Error(`Whisper model not found at "${modelPath}". Download it in Settings → STT.`);
      }

      const tempDir = join(tmpdir(), "yggdrasil-desktop");
      await mkdir(tempDir, { recursive: true });
      const wavPath = join(tempDir, `${randomUUID()}.wav`);
      await writeFile(wavPath, Buffer.from(audioBytes));
      try {
        const server = await ensureWhisperServer(settings.binaryPath, modelPath);
        return await transcribeViaServer(server.port, wavPath, settings.language);
      } finally {
        void unlink(wavPath).catch(() => {});
      }
    },
  );
  ipcMain.handle("stt:getSettings", async (): Promise<SttSettings> => loadSttSettings(app.getPath("userData")));
  ipcMain.handle("stt:saveSettings", async (_event, settings: SttSettings) => {
    await saveSttSettings(app.getPath("userData"), settings);
  });
  ipcMain.handle(
    "stt:transcribeCloud",
    async (_event, audioBytes: ArrayBuffer, settings: SttSettings["cloud"]): Promise<string> =>
      transcribeCloud(Buffer.from(audioBytes), settings),
  );
  ipcMain.handle("tts:getSettings", async (): Promise<TtsSettings> => loadTtsSettings(app.getPath("userData")));
  ipcMain.handle("tts:saveSettings", async (_event, settings: TtsSettings) => {
    await saveTtsSettings(app.getPath("userData"), settings);
  });
}
