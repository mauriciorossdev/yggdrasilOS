import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { defineTool } from "@yggdrasil/tools-sdk";
import { resolveWithinNotes } from "./scope.js";

export const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".ogg", ".opus", ".flac", ".webm", ".aac", ".mp4"]);

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 50_000;
const REPLICATE_BASE = "https://api.replicate.com/v1";
const DEFAULT_MODEL = "openai/whisper";
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 300_000;

export type TranscribeEnv = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

type Prediction = { status?: string; output?: unknown; error?: string | null; urls?: { get?: string } };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Where the transcript of notes/<relPath> is cached, so asking again never pays twice. */
export function transcriptCachePath(audioAbsolutePath: string): string {
  return join(dirname(audioAbsolutePath), ".transcripts", `${basename(audioAbsolutePath)}.txt`);
}

/**
 * Whisper on Replicate: the audio is uploaded to Replicate's Files API (inline
 * data loses the file type) and the model gets that URL; same recipe the avatar
 * app already uses for cloud speech-to-text.
 */
export async function transcribeWithReplicate(
  audio: Buffer,
  fileName: string,
  options: { language?: string } & TranscribeEnv = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const fetchFn = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const token = env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error("Transcription not configured: set REPLICATE_API_TOKEN on the gateway");
  const auth = { Authorization: `Bearer ${token}` };

  const form = new FormData();
  form.append("content", new Blob([new Uint8Array(audio)]), fileName);
  const up = await fetchFn(`${REPLICATE_BASE}/files`, { method: "POST", headers: auth, body: form });
  if (!up.ok) throw new Error(`Audio upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
  const fileUrl = ((await up.json()) as { urls?: { get?: string } }).urls?.get;
  if (!fileUrl) throw new Error("Audio upload returned no URL");

  // Community models (openai/whisper) can't be run through /models/<name>/predictions: the
  // API wants a pinned version. "owner/name:version" pins one; otherwise use the latest.
  const spec = env.REPLICATE_STT_MODEL?.trim() || DEFAULT_MODEL;
  let [model, version] = spec.split(":") as [string, string | undefined];
  if (!version) {
    const info = await fetchFn(`${REPLICATE_BASE}/models/${model}`, { headers: auth });
    if (!info.ok) throw new Error(`Could not look up ${model} on Replicate (${info.status})`);
    version = ((await info.json()) as { latest_version?: { id?: string } }).latest_version?.id;
    if (!version) throw new Error(`${model} has no published version on Replicate`);
  }
  const res = await fetchFn(`${REPLICATE_BASE}/predictions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", Prefer: "wait" },
    body: JSON.stringify({
      version,
      input: {
        audio: fileUrl,
        language: options.language?.trim() || "auto",
        translate: false,
        temperature: 0,
        transcription: "plain text",
      },
    }),
  });
  if (!res.ok) throw new Error(`Transcription request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);

  let prediction = (await res.json()) as Prediction;
  // `Prefer: wait` gives up after ~60 s; a long recording or a cold model keeps running, so poll.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while ((prediction.status === "starting" || prediction.status === "processing") && prediction.urls?.get && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await fetchFn(prediction.urls.get, { headers: auth });
    if (!poll.ok) throw new Error(`Transcription poll failed (${poll.status})`);
    prediction = (await poll.json()) as Prediction;
  }
  if (prediction.status !== "succeeded") {
    throw new Error(`Transcription error: ${prediction.error ?? prediction.status ?? "unknown"}`);
  }
  const text = ((prediction.output as { transcription?: string } | null)?.transcription ?? "").trim();
  if (!text) throw new Error("No speech detected in the audio");
  return text;
}

export function createTranscribeAudioTool(deps: TranscribeEnv = {}) {
  return defineTool({
    name: "transcribe_audio",
    description:
      'Transcribes an audio file (voice note, recording, meeting) inside the Documents folder (notes/) to text. Use it for any audio the user attached ("[Audio adjunto: assistant/nota.m4a]") — audio cannot be read with read_document. The transcript is cached, so asking again about the same audio is free. Long transcripts are paged: pass nextOffset as offset to continue.',
    riskLevel: "safe",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: 'Audio path relative to the Documents folder, e.g. "assistant/nota.m4a"' },
        language: { type: "string", description: 'Optional language code like "es" or "en"; default is auto-detect.' },
        offset: { type: "number", description: "Character offset to continue a long transcript (nextOffset from the previous call)." },
      },
      required: ["path"],
    },
    async execute(ctx, args) {
      const relPath = String(args.path ?? "");
      const target = resolveWithinNotes(ctx, "transcribe_audio", relPath);
      const ext = extname(relPath).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) throw new Error(`transcribe_audio: "${ext || relPath}" is not a supported audio file`);

      const cachePath = transcriptCachePath(target);
      let text: string;
      let cached = false;
      try {
        text = await readFile(cachePath, "utf8");
        cached = true;
      } catch {
        const info = await stat(target);
        if (info.size > MAX_AUDIO_BYTES) throw new Error(`Audio too large (${Math.round(info.size / 1024 / 1024)} MB, max 25 MB)`);
        text = await transcribeWithReplicate(await readFile(target), basename(target), {
          ...deps,
          language: typeof args.language === "string" ? args.language : undefined,
        });
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, text, "utf8");
      }

      const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
      const end = offset + MAX_TRANSCRIPT_CHARS;
      const truncated = end < text.length;
      return {
        path: relPath,
        cached,
        text: text.slice(offset, end),
        totalLength: text.length,
        truncated,
        ...(offset > 0 ? { offset } : {}),
        ...(truncated ? { nextOffset: end } : {}),
      };
    },
  });
}

export const transcribeAudioTool = createTranscribeAudioTool();
