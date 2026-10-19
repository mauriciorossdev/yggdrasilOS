import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { ensureGateway, type GatewayHandle } from "./gateway.js";
import { buildAvatarSystemPrompt } from "./avatarPrompt.js";
import { initSessionLog, logError, logEvent } from "./sessionLog.js";
import {
  deleteModel,
  downloadModel,
  fileExists,
  findBundledBinary as findBundledWhisperBinary,
  isModelDownloaded,
  listDownloadedModels,
  WHISPER_MODELS,
} from "./whisper.js";
import { ensureWhisperServer, stopWhisperServer, transcribeViaServer } from "./whisperServer.js";
import {
  loadWhisperSettings,
  saveWhisperSettings,
  loadSttSettings,
  saveSttSettings,
  type WhisperSettings,
  type SttSettings,
} from "./whisperSettings.js";
import { transcribeCloud } from "./sttCloud.js";
import {
  deleteVoice,
  downloadVoice,
  findBundledBinary as findBundledPiperBinary,
  isVoiceDownloaded,
  listDownloadedVoices,
  synthesize,
  PIPER_VOICES,
} from "./piper.js";
import {
  loadPiperSettings,
  savePiperSettings,
  loadTtsSettings,
  saveTtsSettings,
  type PiperSettings,
  type TtsSettings,
} from "./piperSettings.js";
import { synthesizeCloud } from "./ttsCloud.js";

// Explicit, unambiguous userData folder name — Electron's default (derived
// from package.json's scoped "@yggdrasil/app-avatar" name) is unpredictable.
app.setName("yggdrasil-avatar");

let gateway: GatewayHandle | null = null;

function pluginSearchDir(): string {
  return join(app.getAppPath(), "node_modules/@yggdrasil");
}

function loadRenderer(window: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function createWindow(gatewayUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      additionalArguments: [`--ygg-gateway-url=${gatewayUrl}`],
    },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  loadRenderer(window);
  return window;
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
}

async function resolveInitialBinaryPath(current: string, backend: WhisperSettings["backend"]): Promise<string> {
  if (current) return current;
  return (await findBundledWhisperBinary(resourcesDir(), backend)) ?? "";
}

async function resolveInitialPiperBinaryPath(current: string): Promise<string> {
  if (current) return current;
  return (await findBundledPiperBinary(resourcesDir())) ?? "";
}

function registerIpc(): void {
  ipcMain.handle("whisper:getSettings", async (): Promise<WhisperSettings> => {
    const settings = await loadWhisperSettings(app.getPath("userData"));
    settings.binaryPath = await resolveInitialBinaryPath(settings.binaryPath, settings.backend);
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
      title: "Select whisper-server.exe",
      properties: ["openFile"],
      filters: [{ name: "Executable", extensions: ["exe"] }],
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

      const tempDir = join(tmpdir(), "yggdrasil-avatar");
      await mkdir(tempDir, { recursive: true });
      const wavPath = join(tempDir, `${randomUUID()}.wav`);
      await writeFile(wavPath, Buffer.from(audioBytes));
      try {
        const server = await ensureWhisperServer(settings.binaryPath, modelPath);
        return await transcribeViaServer(server.port, wavPath, settings.language);
      } finally {
        void import("node:fs/promises").then((fs) => fs.unlink(wavPath).catch(() => {}));
      }
    },
  );

  ipcMain.handle("stt:getSettings", async (): Promise<SttSettings> => loadSttSettings(app.getPath("userData")));

  ipcMain.handle("stt:saveSettings", async (_event, settings: SttSettings) => {
    await saveSttSettings(app.getPath("userData"), settings);
  });

  ipcMain.handle(
    "stt:transcribeCloud",
    async (_event, audioBytes: ArrayBuffer, settings: SttSettings["cloud"]): Promise<string> => {
      const started = Date.now();
      const info = { provider: settings.provider, model: settings.model, bytes: audioBytes.byteLength };
      try {
        const text = await transcribeCloud(Buffer.from(audioBytes), settings);
        logEvent("stt.done", { ...info, ms: Date.now() - started, chars: text.length });
        return text;
      } catch (err) {
        logError("stt.failed", err, { ...info, ms: Date.now() - started });
        throw err;
      }
    },
  );

  ipcMain.handle("piper:getSettings", async (): Promise<PiperSettings> => {
    const settings = await loadPiperSettings(app.getPath("userData"));
    settings.binaryPath = await resolveInitialPiperBinaryPath(settings.binaryPath);
    return settings;
  });

  ipcMain.handle("piper:saveSettings", async (_event, settings: PiperSettings) => {
    await savePiperSettings(app.getPath("userData"), settings);
  });

  ipcMain.handle("piper:pickBinary", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select piper.exe",
      properties: ["openFile"],
      filters: [{ name: "Executable", extensions: ["exe"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  });

  ipcMain.handle("piper:listVoices", () => PIPER_VOICES);

  ipcMain.handle("piper:listDownloaded", async (_event, voicesDir: string) => listDownloadedVoices(voicesDir));

  ipcMain.handle("piper:isDownloaded", async (_event, voicesDir: string, id: string) =>
    isVoiceDownloaded(voicesDir, id),
  );

  ipcMain.handle("piper:download", async (event, voicesDir: string, id: string) => {
    await downloadVoice(voicesDir, id, (fraction) => {
      event.sender.send("piper:downloadProgress", { id, fraction });
    });
  });

  ipcMain.handle("piper:deleteVoice", async (_event, voicesDir: string, id: string) => {
    await deleteVoice(voicesDir, id);
  });

  ipcMain.handle(
    "piper:synthesize",
    async (_event, text: string, settings: PiperSettings): Promise<ArrayBuffer> => {
      const voiceOnnxPath = join(settings.voicesDir, `${settings.voice}.onnx`);
      const tempDir = join(tmpdir(), "yggdrasil-avatar");
      await mkdir(tempDir, { recursive: true });
      const wavPath = join(tempDir, `${randomUUID()}-tts.wav`);
      try {
        await synthesize({ binaryPath: settings.binaryPath, voiceOnnxPath, text, outWavPath: wavPath });
        const fs = await import("node:fs/promises");
        const buffer = await fs.readFile(wavPath);
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } finally {
        void import("node:fs/promises").then((fs) => fs.unlink(wavPath).catch(() => {}));
      }
    },
  );

  ipcMain.handle("tts:getSettings", async (): Promise<TtsSettings> => loadTtsSettings(app.getPath("userData")));

  ipcMain.handle("tts:saveSettings", async (_event, settings: TtsSettings) => {
    await saveTtsSettings(app.getPath("userData"), settings);
  });

  ipcMain.handle(
    "tts:synthesizeCloud",
    async (_event, text: string, settings: TtsSettings["cloud"]): Promise<{ audio: ArrayBuffer; mimeType: string }> => {
      const started = Date.now();
      const info = { provider: settings.provider, model: settings.model, chars: text.length };
      try {
        const { audio, mimeType } = await synthesizeCloud(text, settings);
        logEvent("tts.done", { ...info, ms: Date.now() - started, bytes: audio.byteLength });
        return {
          audio: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer,
          mimeType,
        };
      } catch (err) {
        logError("tts.failed", err, { ...info, ms: Date.now() - started });
        throw err;
      }
    },
  );

  ipcMain.handle("log:write", (_event, kind: string, data: Record<string, unknown>) => {
    logEvent(`renderer.${kind}`, data ?? {});
  });
}

app.whenReady().then(async () => {
  const workspaceRoot = app.getPath("userData");
  initSessionLog(workspaceRoot, app.getVersion());
  registerIpc();

  await mkdir(workspaceRoot, { recursive: true });
  const stt = await loadWhisperSettings(workspaceRoot);
  gateway = await ensureGateway(workspaceRoot, pluginSearchDir(), {
    systemPrompt: buildAvatarSystemPrompt(stt.language),
    desktopShimPath: join(__dirname, "desktopControlMcpShim.js"),
    docsDir: join(workspaceRoot, "documents"),
  });
  logEvent("gateway.ready", { url: gateway.url, sttLanguage: stt.language });
  createWindow(gateway.url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && gateway) createWindow(gateway.url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  logEvent("session.end");
  gateway?.shutdown();
  stopWhisperServer();
});
