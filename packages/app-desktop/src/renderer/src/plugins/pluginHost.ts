import type { PluginRecord } from "../types.js";
import { blobToWav } from "../mic/wavEncoder.js";

type YggReq = { type: "ygg:req"; id: string; method: string; params?: unknown };

const MIC_MAX_MS = 20 * 60_000;

type MicSession = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  startedAt: number;
  timer: number;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
type YggRes = { type: "ygg:res"; id: string; ok: true; result: unknown } | { type: "ygg:res"; id: string; ok: false; error: string };
type YggEvent = { type: "ygg:event"; name: string; payload: unknown };

export type Send = (msg: YggRes | YggEvent) => void;

// The app only has two real CSS custom properties today (project accent/
// border color — see TitleBar.tsx); everything else here is a fixed palette
// constant matching styles.css's own hardcoded dark theme, since there's no
// broader theme system yet for a plugin to actually read from.
/** A token's concrete color. Derived tokens are color-mix() expressions, so resolve through a probe element instead of reading the raw custom property. */
function tokenColor(name: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name}, ${fallback})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || fallback;
}

function themeSnapshot() {
  const root = getComputedStyle(document.documentElement);
  return {
    colorScheme: "dark" as const,
    accent: root.getPropertyValue("--project-accent-color").trim() || "#4a9eff",
    border: root.getPropertyValue("--project-border-color").trim() || "transparent",
    // Resolved from the app's tokens (see ui/theme) so plugins follow the user's theme.
    bg: tokenColor("--ygg-bg", "#1a1918"),
    panel: tokenColor("--ygg-sidebar", "#151413"),
    line: tokenColor("--ygg-border", "#3a3835"),
    fg: tokenColor("--ygg-text", "#f1efe7"),
    muted: tokenColor("--ygg-text-muted", "#9c9a92"),
  };
}

function pluginInfo(plugin: PluginRecord) {
  return {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    scope: plugin.scope,
    permissions: plugin.manifest.permissions ?? [],
  };
}

function hasPermission(plugin: PluginRecord, permission: string): boolean {
  return (plugin.manifest.permissions ?? []).includes(permission);
}

/** A plain string relativePath guard — the gateway's own fs.* RPCs already confine to the workspace root server-side, and plugins:fsWrite/fsMkdir do their own resolve/relative check in main; this just rejects the obviously-hostile shape before either of those ever sees it. */
function assertSafeRelativePath(value: unknown): string {
  const rel = typeof value === "string" ? value : "";
  if (rel.startsWith("/") || rel.includes("..")) throw new Error(`ruta relativa inválida: "${rel}"`);
  return rel;
}

export type PluginHost = {
  handleMessage: (data: unknown, send: Send) => Promise<void>;
  setVisible: (visible: boolean) => void;
  /** Forwards a host-side event (e.g. the gateway's own "fs.changed") to the plugin as a ygg:event — see PluginFrame.tsx's useGateway().onEvent subscription. */
  pushEvent: (name: string, payload: unknown) => void;
  dispose: () => void;
};

export type PluginHostDeps = {
  plugin: PluginRecord;
  onOpenFile?: (relativePath: string) => void;
  onOpenTab?: (tab: string) => void;
  /** The gateway's own RPC call — backs ygg.fs.list/read (fs permission) and ygg.gateway.call (gateway:<method> permission). Undefined only in a context with no gateway connection (there isn't one today, but keeps this module decoupled from useGateway). */
  gatewayCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * One instance per mounted PluginFrame — owns the request/response and event
 * plumbing for that plugin's `window.ygg` calls (see pluginSdk.ts, the
 * matching script running inside the iframe), gated by the manifest's own
 * declared `permissions` (plugins.ts's PluginPermission).
 */
export function createPluginHost({ plugin, onOpenFile, onOpenTab, gatewayCall }: PluginHostDeps): PluginHost {
  let visible = false;
  let lastSend: Send | null = null;
  let mic: MicSession | null = null;
  // Audio cut off by MIC_MAX_MS, kept until the plugin's next stop/transcribe call.
  let autoStopped: { blob: Blob; durationMs: number } | null = null;

  function requirePermission(permission: string): void {
    if (!hasPermission(plugin, permission)) throw new Error(`permiso denegado: ${permission}`);
  }

  // Capture happens in the host renderer (app origin), not the plugin's sandboxed
  // iframe: Chromium refuses getUserMedia for the plugin's ygg-plugin:// origin.
  async function micStart(): Promise<unknown> {
    if (mic) throw new Error("el micrófono ya está grabando");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.start();
    autoStopped = null;
    const timer = window.setTimeout(() => {
      void micFinish()
        .then((result) => {
          autoStopped = result;
        })
        .catch(() => undefined);
    }, MIC_MAX_MS);
    mic = { recorder, stream, chunks, startedAt: Date.now(), timer };
    return { ok: true, maxSeconds: MIC_MAX_MS / 1000 };
  }

  async function micFinish(): Promise<{ blob: Blob; durationMs: number }> {
    const session = mic;
    if (!session) {
      if (autoStopped) {
        const result = autoStopped;
        autoStopped = null;
        return result;
      }
      throw new Error("el micrófono no está grabando");
    }
    mic = null;
    window.clearTimeout(session.timer);
    await new Promise<void>((resolve) => {
      session.recorder.onstop = () => resolve();
      session.recorder.stop();
    });
    session.stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(session.chunks, { type: session.recorder.mimeType || "audio/webm" });
    return { blob, durationMs: Date.now() - session.startedAt };
  }

  async function micStop(): Promise<unknown> {
    const { blob, durationMs } = await micFinish();
    return { mime: blob.type, base64: await blobToBase64(blob), bytes: blob.size, durationMs };
  }

  // Same whisper path the Files tab's mic uses (MicButton.tsx): WAV encode, then the main process's whisper server.
  async function micTranscribe(): Promise<unknown> {
    const { blob } = await micFinish();
    const wav = await blobToWav(blob);
    const settings = await window.yggdrasil.whisper.getSettings();
    return { text: await window.yggdrasil.whisper.transcribe(wav, settings) };
  }

  async function run(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "storage.get":
        return window.yggdrasil.plugins.storageGet(plugin.scope, plugin.manifest.id, String(params.key ?? ""));
      case "storage.set":
        await window.yggdrasil.plugins.storageSet(plugin.scope, plugin.manifest.id, String(params.key ?? ""), params.value);
        return null;
      case "storage.delete":
        await window.yggdrasil.plugins.storageDelete(plugin.scope, plugin.manifest.id, String(params.key ?? ""));
        return null;
      case "storage.keys":
        return window.yggdrasil.plugins.storageKeys(plugin.scope, plugin.manifest.id);
      case "app.theme":
        return themeSnapshot();
      case "app.info":
        return {
          plugin: pluginInfo(plugin),
          project: { id: window.yggdrasil.projectId, name: window.yggdrasil.projectName },
          theme: themeSnapshot(),
          visible,
        };
      case "app.openTab":
        onOpenTab?.(String(params.tab ?? ""));
        return null;
      case "app.openFile":
        onOpenFile?.(String(params.relativePath ?? ""));
        return null;
      case "fs.list":
        requirePermission("fs");
        if (!gatewayCall) throw new Error("gateway no disponible");
        return gatewayCall("fs.list", { relativePath: assertSafeRelativePath(params.relativePath ?? "") });
      case "fs.read":
        requirePermission("fs");
        if (!gatewayCall) throw new Error("gateway no disponible");
        return gatewayCall("fs.read", { relativePath: assertSafeRelativePath(params.relativePath) });
      case "fs.write":
        requirePermission("fs:write");
        await window.yggdrasil.plugins.fsWrite(assertSafeRelativePath(params.relativePath), String(params.content ?? ""));
        return null;
      case "fs.mkdir":
        requirePermission("fs:write");
        await window.yggdrasil.plugins.fsMkdir(assertSafeRelativePath(params.relativePath));
        return null;
      case "gateway.call": {
        const gatewayMethod = String(params.method ?? "");
        requirePermission(`gateway:${gatewayMethod}`);
        if (gatewayMethod.startsWith("fs.")) throw new Error("usá ygg.fs.* en vez de gateway.call para métodos fs.*");
        if (!gatewayCall) throw new Error("gateway no disponible");
        return gatewayCall(gatewayMethod, params.params as Record<string, unknown> | undefined);
      }
      case "panes.list":
        requirePermission("panes");
        return window.yggdrasil.panes.list();
      case "panes.create":
        requirePermission("panes");
        return window.yggdrasil.panes.create({
          cwd: typeof params.cwd === "string" ? params.cwd : undefined,
          title: typeof params.title === "string" ? params.title : undefined,
          command: typeof params.command === "string" ? params.command : undefined,
          args: Array.isArray(params.args) ? params.args.map(String) : undefined,
        });
      case "panes.write":
        requirePermission("panes");
        await window.yggdrasil.panes.write(String(params.id ?? ""), String(params.text ?? ""), params.pressEnter !== false);
        return null;
      case "mic.start":
        requirePermission("microphone");
        return micStart();
      case "mic.stop":
        requirePermission("microphone");
        return micStop();
      case "mic.transcribe":
        requirePermission("microphone");
        return micTranscribe();
      case "app.notify":
        try {
          // eslint-disable-next-line no-new -- fire-and-forget, same as a browser page's own Notification() calls
          new Notification(String(params.title ?? plugin.manifest.name), {
            body: typeof params.body === "string" ? params.body : undefined,
          });
        } catch {
          // Notification support/permission varies — non-fatal for the plugin either way.
        }
        return null;
      default:
        throw new Error(`método desconocido: ${method}`);
    }
  }

  return {
    async handleMessage(data, send) {
      lastSend = send;
      if (!data || typeof data !== "object") return;
      const type = (data as { type?: unknown }).type;

      if (type === "ygg:ready") {
        send({
          type: "ygg:event",
          name: "init",
          payload: {
            plugin: pluginInfo(plugin),
            project: { id: window.yggdrasil.projectId, name: window.yggdrasil.projectName },
            theme: themeSnapshot(),
            visible,
          },
        });
        return;
      }

      if (type !== "ygg:req") return;
      const req = data as YggReq;
      try {
        const result = await run(req.method, (req.params as Record<string, unknown>) ?? {});
        send({ type: "ygg:res", id: req.id, ok: true, result });
      } catch (err) {
        send({ type: "ygg:res", id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    },
    setVisible(next) {
      if (visible === next) return;
      visible = next;
      lastSend?.({ type: "ygg:event", name: "visibility", payload: { visible: next } });
    },
    pushEvent(name, payload) {
      lastSend?.({ type: "ygg:event", name, payload });
    },
    dispose() {
      lastSend = null;
      if (mic) {
        window.clearTimeout(mic.timer);
        mic.stream.getTracks().forEach((track) => track.stop());
        if (mic.recorder.state !== "inactive") mic.recorder.stop();
        mic = null;
      }
    },
  };
}
