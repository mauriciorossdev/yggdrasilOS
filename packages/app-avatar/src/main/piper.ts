import { join, basename } from "node:path";
import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, rename, unlink } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Curated subset of rhasspy/piper-voices (HuggingFace) — medium/high quality
 * tier only (x_low/low sound noticeably worse), and single-speaker only. This
 * is metadata only, no download cost until the user actually clicks Download
 * in Settings → Voice — feel free to add more entries from that repo's
 * `en/`, `es/`, etc. trees, but check the voice's `.onnx.json`'s
 * `num_speakers` first (see the guard in `synthesize()` below for why).
 */
export const PIPER_VOICES = [
  { id: "en_US-lessac-medium", label: "English (US) — Lessac", hfPath: "en/en_US/lessac/medium" },
  { id: "en_US-amy-medium", label: "English (US) — Amy", hfPath: "en/en_US/amy/medium" },
  { id: "en_US-ryan-high", label: "English (US) — Ryan", hfPath: "en/en_US/ryan/high" },
  { id: "en_US-kristin-medium", label: "English (US) — Kristin", hfPath: "en/en_US/kristin/medium" },
  { id: "en_GB-alan-medium", label: "English (UK) — Alan", hfPath: "en/en_GB/alan/medium" },
  {
    id: "en_GB-northern_english_male-medium",
    label: "English (UK, Northern) — Male",
    hfPath: "en/en_GB/northern_english_male/medium",
  },
  { id: "es_ES-davefx-medium", label: "Español (España) — Davefx", hfPath: "es/es_ES/davefx/medium" },
  { id: "es_MX-claude-high", label: "Español (México) — Claude", hfPath: "es/es_MX/claude/high" },
  { id: "es_MX-ald-medium", label: "Español (México) — Ald", hfPath: "es/es_MX/ald/medium" },
  { id: "es_AR-daniela-high", label: "Español (Argentina) — Daniela", hfPath: "es/es_AR/daniela/high" },
] as const;
export type PiperVoiceId = (typeof PIPER_VOICES)[number]["id"];

function voiceHfPath(id: string): string {
  const voice = PIPER_VOICES.find((v) => v.id === id);
  if (!voice) throw new Error(`Unknown Piper voice "${id}"`);
  return voice.hfPath;
}

function voiceFilePaths(voicesDir: string, id: string): { onnx: string; json: string } {
  return { onnx: join(voicesDir, `${id}.onnx`), json: join(voicesDir, `${id}.onnx.json`) };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listDownloadedVoices(voicesDir: string): Promise<string[]> {
  if (!(await fileExists(voicesDir))) return [];
  const entries = await readdir(voicesDir);
  return entries.filter((f) => f.endsWith(".onnx")).map((f) => f.slice(0, -".onnx".length));
}

export async function isVoiceDownloaded(voicesDir: string, id: string): Promise<boolean> {
  const { onnx, json } = voiceFilePaths(voicesDir, id);
  return (await fileExists(onnx)) && (await fileExists(json));
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * HuggingFace echoes an LFS-tracked file's sha256 as `x-linked-etag` on the
 * resolve URL's own (pre-redirect) response — a plain HEAD with manual
 * redirect handling gets it without following through to the CDN. Only
 * trust it as a content sha256 when it's actually 64 hex chars: for
 * non-LFS files (the small .onnx.json configs) this header is instead a
 * 40-char git blob SHA-1, not a hash of raw file content at all — comparing
 * that against a computed sha256 would always mismatch. Those just skip
 * verification (return null) rather than being treated as corrupt.
 */
async function fetchExpectedSha256(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    const etag = res.headers.get("x-linked-etag")?.replaceAll('"', "");
    return etag && /^[0-9a-f]{64}$/.test(etag) ? etag : null;
  } catch {
    return null;
  }
}

async function downloadFileOnce(url: string, dest: string, onProgress?: (fraction: number) => void): Promise<void> {
  const partial = `${dest}.part`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download "${url}": HTTP ${response.status}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  if (total > 0 && onProgress) {
    source.on("data", (chunk: Buffer) => {
      received += chunk.length;
      onProgress(received / total);
    });
  }
  await pipeline(source, createWriteStream(partial));

  const expectedSha256 = await fetchExpectedSha256(url);
  if (expectedSha256) {
    const actualSha256 = await sha256OfFile(partial);
    if (actualSha256 !== expectedSha256) {
      await unlink(partial).catch(() => {});
      throw new Error(`Download of "${basename(dest)}" failed an integrity check (corrupted in transit).`);
    }
  }

  await rename(partial, dest);
}

const DOWNLOAD_ATTEMPTS = 3;

/**
 * Downloads to a `.part` file, verifies its sha256 against HuggingFace's own
 * LFS hash when available, and only then renames it into place — confirmed
 * necessary in practice: a downloaded ~60MB voice model once landed with the
 * exact right byte count (so truncation-only checks wouldn't have caught it)
 * but corrupted content, which made piper.exe crash outright
 * (STATUS_STACK_BUFFER_OVERRUN) instead of failing cleanly. Retries a few
 * times on integrity-check failure specifically (also observed in practice,
 * on a 114MB file) before giving up — real intermittent transfer corruption,
 * not a broken URL, so a retry alone often succeeds.
 */
async function downloadFile(url: string, dest: string, onProgress?: (fraction: number) => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      await downloadFileOnce(url, dest, onProgress);
      return;
    } catch (err) {
      lastError = err;
      const isIntegrityFailure = err instanceof Error && err.message.includes("integrity check");
      if (!isIntegrityFailure || attempt === DOWNLOAD_ATTEMPTS) throw err;
      // else: transient corruption — loop and try again.
    }
  }
  throw lastError;
}

/** Downloads both the .onnx model and its .onnx.json config — a voice is unusable without both. */
export async function downloadVoice(
  voicesDir: string,
  id: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  await mkdir(voicesDir, { recursive: true });
  const hfPath = voiceHfPath(id);
  const base = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${hfPath}/${id}`;
  const { onnx, json } = voiceFilePaths(voicesDir, id);
  // The .onnx is ~60MB, the .json a few KB — progress only tracks the model.
  await downloadFile(`${base}.onnx.json`, json);
  await downloadFile(`${base}.onnx`, onnx, onProgress);
}

export async function deleteVoice(voicesDir: string, id: string): Promise<void> {
  const { onnx, json } = voiceFilePaths(voicesDir, id);
  if (await fileExists(onnx)) await unlink(onnx);
  if (await fileExists(json)) await unlink(json);
}

/** Locates the bundled piper.exe (resources/piper/win/) if present — otherwise the user must set a binary path in Settings. */
export async function findBundledBinary(resourcesDir: string): Promise<string | null> {
  const path = join(resourcesDir, "piper", "win", "piper.exe");
  return (await fileExists(path)) ? path : null;
}

export type SynthesizeOptions = {
  binaryPath: string;
  voiceOnnxPath: string;
  text: string;
  outWavPath: string;
};

/**
 * Spawns piper.exe for a single utterance — no persistent server needed
 * unlike whisper: Piper's own reported real-time factor here is ~0.08 (12x
 * faster than real-time on CPU) with ~0.4-0.6s voice-load overhead, so
 * per-call spawn cost is small relative to whisper's multi-second model load.
 */
export async function synthesize(opts: SynthesizeOptions): Promise<void> {
  if (!(await fileExists(opts.binaryPath))) {
    throw new Error(`piper.exe not found at "${opts.binaryPath}". Set it in Settings → Voice.`);
  }
  if (!(await fileExists(opts.voiceOnnxPath))) {
    throw new Error(`Piper voice not found at "${opts.voiceOnnxPath}". Download it in Settings → Voice.`);
  }

  // The archived native piper.exe build this app uses (see README) crashes
  // outright (STATUS_STACK_BUFFER_OVERRUN, exit code 0xC0000409) on
  // multi-speaker voices — confirmed on es_ES-sharvard-medium, both with and
  // without an explicit -s speaker id. Fail with a clear message instead of
  // that cryptic native crash; PIPER_VOICES itself is curated to avoid this,
  // but a manually-set voicePath could still hit it.
  const configPath = `${opts.voiceOnnxPath}.json`;
  if (await fileExists(configPath)) {
    try {
      const config = JSON.parse(await readFile(configPath, "utf8")) as { num_speakers?: number };
      if ((config.num_speakers ?? 1) > 1) {
        throw new Error(
          `"${basename(opts.voiceOnnxPath)}" is a multi-speaker voice (${config.num_speakers} speakers) — the bundled piper.exe build crashes on these. Pick a single-speaker voice instead.`,
        );
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        // Malformed config JSON — let piper.exe itself report that, rather
        // than masking it behind this guard.
      } else {
        throw err;
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(opts.binaryPath, ["-m", opts.voiceOnnxPath, "-f", opts.outWavPath], {
      cwd: join(opts.binaryPath, ".."),
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${basename(opts.binaryPath)} exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve();
    });
    child.stdin.write(opts.text);
    child.stdin.end();
  });
}
