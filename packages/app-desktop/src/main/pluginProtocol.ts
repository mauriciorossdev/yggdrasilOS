import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { protocol, type WebContents } from "electron";
import type { ProjectRecord } from "./projects.js";
import { globalPluginsDir, projectPluginsDir } from "./plugins.js";
import { PLUGIN_SDK_SOURCE } from "./pluginSdk.js";

const MIME: Record<string, string> = {
  html: "text/html",
  js: "text/javascript",
  mjs: "text/javascript",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain",
  md: "text/markdown",
  wasm: "application/wasm",
};

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

// The plugin document's own origin is opaque (no allow-same-origin on its
// iframe, see PluginFrame.tsx) — a scheme-source ("ygg-plugin:"), not
// 'self', is what actually matches it. connect-src 'none': a v1 plugin talks
// to the host exclusively through postMessage (ygg.*), never fetch/XHR —
// this also means a plugin can't quietly phone out to a third-party URL.
const PLUGIN_DOC_CSP =
  "default-src ygg-plugin:; script-src ygg-plugin: 'unsafe-inline'; style-src ygg-plugin: 'unsafe-inline'; img-src ygg-plugin: data: blob:; font-src ygg-plugin: data:; connect-src 'none'";

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function forbidden(): Response {
  return new Response("Forbidden", { status: 403 });
}

/** Resolves `restPath` inside `dir` and serves it, refusing anything that escapes `dir` (a "../../etc/passwd"-style manifest.entry or crafted URL). */
async function serveFile(dir: string, restPath: string): Promise<Response> {
  const target = resolve(dir, restPath || "index.html");
  const rel = relative(dir, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return forbidden();
  let raw: Buffer;
  try {
    const st = await stat(target);
    if (st.isDirectory()) return notFound();
    raw = await readFile(target);
  } catch {
    return notFound();
  }
  // A plain Buffer is typed Buffer<ArrayBufferLike> (its backing store could
  // in principle be a SharedArrayBuffer), which lib.dom's BodyInit rejects —
  // copying into a fixed-length Uint8Array guarantees a real, non-shared
  // ArrayBuffer underneath and satisfies Response's constructor.
  const body = new Uint8Array(raw.byteLength);
  body.set(raw);
  const mime = mimeFor(target);
  const headers: Record<string, string> = {
    "Content-Type": mime,
    // Hot reload (plugins.ts's watcher) relies on every request hitting
    // disk fresh — a cached response would keep showing stale content after
    // an agent edits a file until a hard refresh.
    "Cache-Control": "no-store",
  };
  if (mime === "text/html") headers["Content-Security-Policy"] = PLUGIN_DOC_CSP;
  return new Response(body, { status: 200, headers });
}

/**
 * Registers the `ygg-plugin://` scheme's content handler. Must run inside
 * `app.whenReady` (unlike `protocol.registerSchemesAsPrivileged`, called at
 * module load in main/index.ts — Electron requires that one before
 * `ready`). URL shapes:
 *   ygg-plugin://sdk/ygg.js
 *   ygg-plugin://plugin/global/<pluginId>/<file>
 *   ygg-plugin://plugin/project/<projectId>/<pluginId>/<file>
 */
export function registerPluginProtocol(getProject: (id: string) => Promise<ProjectRecord | undefined>): void {
  protocol.handle("ygg-plugin", async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return notFound();
    }
    const host = url.hostname;
    const parts = url.pathname.split("/").filter(Boolean);

    if (host === "sdk") {
      return new Response(PLUGIN_SDK_SOURCE, {
        status: 200,
        headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" },
      });
    }

    if (host !== "plugin") return notFound();

    const scope = parts[0];
    if (scope === "global") {
      const id = parts[1];
      if (!id) return notFound();
      return serveFile(join(globalPluginsDir(), id), parts.slice(2).join("/"));
    }
    if (scope === "project") {
      const projectId = parts[1];
      const id = parts[2];
      if (!projectId || !id) return notFound();
      const project = await getProject(projectId);
      if (!project) return notFound();
      return serveFile(join(projectPluginsDir(project.path), id), parts.slice(3).join("/"));
    }
    return notFound();
  });
}

/** Payload of the `plugins:frameError` IPC event — see forwardPluginFrameErrors. */
export type PluginFrameErrorPayload = {
  /** URL of the plugin frame that threw (its `?ygg-frame=` param identifies the exact iframe). */
  frameUrl: string;
  /** Chromium's own console text, e.g. "Uncaught Error: boom" or "Uncaught (in promise) Error: boom". */
  message: string;
  sourceId: string;
  lineNumber: number;
};

/**
 * A complemento's own scripts (`ygg-plugin://plugin/.../app.js`) are
 * cross-origin to its document, whose origin is opaque (sandboxed iframe
 * without allow-same-origin). So Chromium mutes their errors for the page:
 * the SDK's window.onerror only ever sees "Script error.", with no message
 * or stack, and unhandledrejection doesn't fire at all.
 *
 * The embedder still gets the real text, file and line through
 * `console-message`, so this forwards every uncaught error/rejection from a
 * plugin frame back to the window that hosts it. PluginFrame.tsx matches
 * the payload to its iframe and merges it with what the SDK reported.
 */
export function forwardPluginFrameErrors(wc: WebContents): void {
  wc.on("console-message", (event) => {
    if (event.level !== "error") return;
    const frameUrl = event.frame?.url ?? "";
    if (!frameUrl.startsWith("ygg-plugin://plugin/")) return;
    // Only uncaught errors/rejections; a plugin's own console.error already
    // reaches the host through the SDK's console capture.
    if (!event.message.startsWith("Uncaught")) return;
    if (wc.isDestroyed()) return;
    const payload: PluginFrameErrorPayload = {
      frameUrl,
      message: event.message,
      sourceId: event.sourceId,
      lineNumber: event.lineNumber,
    };
    wc.send("plugins:frameError", payload);
  });
}
