import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { SttCloudSettings } from "./whisperSettings.js";

const AGY_TIMEOUT_MS = 180_000;

function runAgy(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // The app's PATH misses ~/.local/bin, where the agy CLI is installed.
    const child = spawn("agy", args, {
      env: { ...process.env, PATH: `${join(homedir(), ".local", "bin")}:/opt/homebrew/bin:${process.env.PATH ?? ""}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("agy superó el tiempo de espera"));
    }, AGY_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`agy terminó con código ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/** Saves the WAV to a temp file and asks the agy CLI to transcribe that path. */
async function transcribeAgy(wav: Buffer, settings: SttCloudSettings): Promise<string> {
  const dir = join(tmpdir(), "yggdrasil-avatar-stt");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${randomUUID()}.wav`);
  await writeFile(file, wav);
  try {
    const prompt = `Transcribe el archivo de audio ${file}. Responde solo con la transcripción, sin comentarios.`;
    const args = ["-p", prompt];
    if (settings.model) args.push("--model", settings.model);
    const text = await runAgy(args);
    if (!text) throw new Error("agy no devolvió transcripción");
    return text;
  } finally {
    await unlink(file).catch(() => undefined);
  }
}

/**
 * Replicate doesn't accept inline data for audio (the model loses the file type),
 * so the WAV is uploaded to Replicate's Files API and the model gets that URL.
 */
async function uploadToReplicate(wav: Buffer, settings: SttCloudSettings): Promise<string> {
  const upload = new FormData();
  upload.append("content", new Blob([wav], { type: "audio/wav" }), "audio.wav");
  const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: upload,
  });
  if (!res.ok) {
    throw new Error(`STT file upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const file = (await res.json()) as { urls?: { get?: string } };
  if (!file.urls?.get) throw new Error("STT file upload returned no URL.");
  return file.urls.get;
}

type ReplicatePrediction = {
  status?: string;
  output?: unknown;
  error?: string | null;
  urls?: { get?: string };
};

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 300_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Replicate predictions API. `Prefer: wait` holds the request until the model finishes (~60s max). */
async function runReplicatePrediction(settings: SttCloudSettings, input: Record<string, unknown>): Promise<unknown> {
  // Community models need a pinned version: "owner/name:version" goes to /predictions, official "owner/name" to /models/.../predictions.
  const [model, version] = settings.model.split(":");
  const url = version
    ? `${settings.baseUrl.replace(/\/$/, "")}/predictions`
    : `${settings.baseUrl.replace(/\/$/, "")}/models/${model}/predictions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
      Prefer: "wait",
    },
    body: JSON.stringify(version ? { version, input } : { input }),
  });
  if (!res.ok) {
    throw new Error(`STT cloud request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  let prediction = (await res.json()) as ReplicatePrediction;
  // Prefer: wait gives up after ~60s; a cold model keeps "starting" longer, so poll the prediction until it settles.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (
    (prediction.status === "starting" || prediction.status === "processing") &&
    prediction.urls?.get &&
    Date.now() < deadline
  ) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await fetch(prediction.urls.get, { headers: { Authorization: `Bearer ${settings.apiKey}` } });
    if (!poll.ok) throw new Error(`STT poll failed (${poll.status}): ${(await poll.text()).slice(0, 300)}`);
    prediction = (await poll.json()) as ReplicatePrediction;
  }
  if (prediction.status !== "succeeded") {
    throw new Error(`STT cloud error: ${prediction.error ?? prediction.status ?? "unknown"}`);
  }
  return prediction.output;
}

const GEMINI_TRANSCRIBE_PROMPT =
  "Transcribe this audio exactly as spoken, in the language it is spoken in. Output only the transcription text, with no commentary.";

async function transcribeReplicateGemini(wav: Buffer, settings: SttCloudSettings): Promise<string> {
  const audio = await uploadToReplicate(wav, settings);
  const output = await runReplicatePrediction(settings, {
    audio,
    mime_type: "audio/wav",
    prompt: GEMINI_TRANSCRIBE_PROMPT,
    images: [],
    videos: [],
    temperature: 0,
    top_p: 1,
    thinking_level: "low",
    max_output_tokens: 8192,
  });
  return (Array.isArray(output) ? output.join("") : String(output ?? "")).trim();
}

async function transcribeReplicateWhisper(wav: Buffer, settings: SttCloudSettings): Promise<string> {
  const audio = await uploadToReplicate(wav, settings);
  const output = await runReplicatePrediction(settings, {
    audio,
    language: "auto",
    translate: false,
    temperature: 0,
    transcription: "plain text",
    suppress_tokens: "-1",
    logprob_threshold: -1,
    no_speech_threshold: 0.6,
    condition_on_previous_text: true,
    compression_ratio_threshold: 2.4,
    temperature_increment_on_fallback: 0.2,
  });
  return ((output as { transcription?: string } | null)?.transcription ?? "").trim();
}

/**
 * OpenAI's /audio/transcriptions multipart shape — Groq and OpenAI itself
 * both implement it verbatim, and "custom" is any self-hosted server that
 * mimics it, so one implementation covers those three providers.
 */
export async function transcribeCloud(wav: Buffer, settings: SttCloudSettings): Promise<string> {
  if (settings.provider === "agy") return transcribeAgy(wav, settings);
  if (!settings.apiKey) {
    throw new Error(`No API key set for the ${settings.provider} STT provider — set one in Settings → STT.`);
  }
  if (!settings.baseUrl) {
    throw new Error("No base URL set for the custom STT provider — set one in Settings → STT.");
  }
  if (settings.provider === "replicate") return transcribeReplicateGemini(wav, settings);
  if (settings.provider === "replicate-whisper") return transcribeReplicateWhisper(wav, settings);

  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
  form.append("model", settings.model);

  const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`STT cloud request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
