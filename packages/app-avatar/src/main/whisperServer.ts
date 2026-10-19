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
 * app, restarted only when the binary/model actually changes. This is what
 * turns "reload a ~500MB model from disk on every push-to-talk" (the v1
 * one-shot-spawn design) into "load it once, keep it warm in RAM" — the
 * dominant fixed cost per utterance before this was model load, not decode.
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
 * Restarts only when binaryPath/modelPath actually change — beam size,
 * no-fallback, and thread count are fixed at server startup (not
 * per-request). `-nf` (no temperature-fallback retries) is the load-bearing
 * latency fix — default fallback retries dominated per-utterance latency far
 * more than beam width did (~10.5s → ~3.5s for a 4.6s clip going from
 * defaults to -nf alone). Beam/best-of are kept at whisper.cpp's own default
 * of 5 for accuracy — trimming them to 2 measurably hurt transcription
 * quality on real speech without meaningfully improving latency once -nf
 * was already removing the fallback cost.
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
      // Flash attention is on by default and assumes tensor cores. On a GPU
      // that doesn't have them (e.g. GTX 16-series, Turing without tensor
      // cores — this build even prints a warning about it on startup), that
      // default made a 4.6s clip take ~56s instead of ~1.6-2.5s. -nfa forces
      // the plain matmul path, which is what's actually fast here. Harmless
      // on CPU-only builds (no GPU backend to matter for).
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
