import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";

const HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 30_000; // model load (small/medium) can take a few seconds on first start
const READY_POLL_INTERVAL_MS = 250;

type ServerHandle = {
  proc: ChildProcess;
  port: number;
  binaryPath: string;
  modelPath: string;
};

/**
 * Module-level singleton: one whisper-server child process for the whole
 * app, restarted only when the binary/model actually changes — loads the
 * model into RAM once and keeps it warm instead of reloading it on every
 * dictation.
 */
let current: ServerHandle | null = null;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("failed to allocate a free port"));
      }
    });
  });
}

async function probeReady(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${HOST}:${port}/`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function stopWhisperServer(): void {
  current?.proc.kill();
  current = null;
}

/**
 * Starts (or reuses) a whisper-server process for the given binary+model.
 * Restarts only when binaryPath/modelPath actually change. `-nf`
 * (no temperature-fallback retries) and `-nfa` (no flash attention — assumes
 * tensor cores a GPU may not have) are load-bearing latency fixes ported
 * from app-avatar's own tuning; beam/best-of are left at whisper.cpp's
 * default of 5 for accuracy.
 */
export async function ensureWhisperServer(binaryPath: string, modelPath: string): Promise<ServerHandle> {
  if (
    current &&
    current.binaryPath === binaryPath &&
    current.modelPath === modelPath &&
    current.proc.exitCode === null &&
    current.proc.signalCode === null
  ) {
    return current;
  }
  stopWhisperServer();

  const port = await getFreePort();
  const threads = Math.max(1, Math.min(8, cpus().length - 1));
  const proc = spawn(
    binaryPath,
    [
      "-m",
      modelPath,
      "--host",
      HOST,
      "--port",
      String(port),
      "-bs",
      "5",
      "-bo",
      "5",
      "-nf",
      "-nfa",
      "-t",
      String(threads),
      "-nt",
      "-l",
      "auto",
    ],
    { cwd: join(binaryPath, ".."), stdio: ["ignore", "pipe", "pipe"] },
  );
  proc.stdout.on("data", (chunk) => console.log(`[whisper-server] ${chunk.toString().trimEnd()}`));
  proc.stderr.on("data", (chunk) => console.error(`[whisper-server] ${chunk.toString().trimEnd()}`));

  const handle: ServerHandle = { proc, port, binaryPath, modelPath };
  current = handle;

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proc.killed || proc.exitCode !== null) {
      throw new Error("whisper-server exited before becoming ready — check the binary/model path in Settings.");
    }
    if (await probeReady(port)) return handle;
    await sleep(READY_POLL_INTERVAL_MS);
  }

  proc.kill();
  if (current === handle) current = null;
  throw new Error(`whisper-server did not become ready within ${READY_TIMEOUT_MS}ms`);
}

export async function transcribeViaServer(port: number, wavPath: string, language: string): Promise<string> {
  const bytes = await readFile(wavPath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "audio.wav");
  form.append("response_format", "json");
  if (language && language !== "auto") form.append("language", language);

  const res = await fetch(`http://${HOST}:${port}/inference`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`whisper-server HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").trim();
}
