import { createReadStream, existsSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export function resolveUiRoot(): string {
  const fromEnv = process.env.YGGDRASIL_UI_DIR?.trim();
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../ui");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function contentType(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function sendFile(res: ServerResponse, filePath: string): void {
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  createReadStream(filePath).pipe(res);
}

export async function tryServeUi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!url.pathname.startsWith("/ui")) {
    return false;
  }

  const uiRoot = resolveUiRoot();
  if (!existsSync(uiRoot)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Web console not built. Run: pnpm build");
    return true;
  }

  let rel = url.pathname.slice("/ui".length) || "/";
  if (rel === "/") rel = "/index.html";

  const filePath = normalize(join(uiRoot, rel));
  if (!filePath.startsWith(normalize(uiRoot))) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (await fileExists(filePath)) {
    const info = await stat(filePath);
    if (info.isFile()) {
      sendFile(res, filePath);
      return true;
    }
  }

  const indexPath = join(uiRoot, "index.html");
  if (await fileExists(indexPath)) {
    sendFile(res, indexPath);
    return true;
  }

  res.writeHead(404);
  res.end("Not found");
  return true;
}
