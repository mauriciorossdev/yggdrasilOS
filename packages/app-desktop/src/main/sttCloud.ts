import type { SttCloudSettings } from "./whisperSettings.js";

/** Data URLs are fine for small inputs; Replicate asks for its Files API above this. */
const REPLICATE_INLINE_MAX_BYTES = 256 * 1024;
const REPLICATE_TIMEOUT_MS = 120_000;
const REPLICATE_POLL_MS = 1000;

/** `language`: ISO-639-1 code such as "es"; omitted or "auto" lets the service detect it. */
export async function transcribeCloud(wav: Buffer, settings: SttCloudSettings, language?: string): Promise<string> {
  if (!settings.apiKey) {
    throw new Error(`No API key set for the ${settings.provider} STT provider — set one in Settings → STT.`);
  }
  if (!settings.baseUrl) {
    throw new Error("No base URL set for the custom STT provider — set one in Settings → STT.");
  }
  const lang = language && language !== "auto" ? language : undefined;
  if (settings.provider === "replicate") return transcribeReplicate(wav, settings, lang);
  return transcribeOpenAiShape(wav, settings, lang);
}

/**
 * OpenAI's /audio/transcriptions multipart shape — OpenAI itself implements
 * it verbatim, and "custom" is any self-hosted server that mimics it.
 */
async function transcribeOpenAiShape(wav: Buffer, settings: SttCloudSettings, language?: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([toBytes(wav)], { type: "audio/wav" }), "audio.wav");
  form.append("model", settings.model);
  if (language) form.append("language", language);

  const res = await fetch(`${trimSlash(settings.baseUrl)}/audio/transcriptions`, {
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

// A plain Buffer is typed Buffer<ArrayBufferLike> (its backing store could in
// principle be a SharedArrayBuffer), which lib.dom's BlobPart rejects —
// copying into a fixed-length Uint8Array guarantees a real ArrayBuffer.
function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return bytes;
}

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

type ReplicatePrediction = {
  status?: string;
  output?: unknown;
  error?: unknown;
  urls?: { get?: string };
};

/** Where to create the prediction: "owner/name" runs the model's latest version, "owner/name:version" a pinned one. */
export function replicatePredictionRequest(
  baseUrl: string,
  model: string,
  input: Record<string, unknown>,
): { url: string; body: Record<string, unknown> } {
  const base = trimSlash(baseUrl);
  const [name, version] = model.trim().split(":");
  if (!name || !/^[\w.-]+\/[\w.-]+$/.test(name)) {
    throw new Error(`Replicate model must look like "owner/name" (got "${model}") — set it in Settings → STT.`);
  }
  if (version) return { url: `${base}/predictions`, body: { version, input } };
  return { url: `${base}/models/${name}/predictions`, body: { input } };
}

/** The transcript in a finished prediction's output: a string, or a list of chunks to join. */
export function replicateOutputText(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) return output.filter((p) => typeof p === "string").join("").trim();
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    for (const key of ["text", "transcription", "transcript"]) {
      if (typeof record[key] === "string") return (record[key] as string).trim();
    }
  }
  return "";
}

/** Seconds to wait before retrying a 429, from the body's retry_after or the Retry-After header. */
export function replicateRetryAfterSeconds(body: string, header: string | null): number {
  try {
    const parsed = JSON.parse(body) as { retry_after?: unknown };
    if (typeof parsed.retry_after === "number" && parsed.retry_after >= 0) return parsed.retry_after;
  } catch {
    // Not JSON: fall back to the header.
  }
  const fromHeader = header?.trim() ? Number(header) : NaN;
  return Number.isFinite(fromHeader) && fromHeader >= 0 ? fromHeader : 5;
}

/**
 * fetch that waits out Replicate's throttling (429) instead of failing. With
 * under $5 of credit an account gets 6 predictions a minute, which a recording
 * cut into short segments hits right away.
 */
async function fetchReplicate(url: string, init: () => RequestInit, deadline: number): Promise<Response> {
  for (;;) {
    const res = await fetch(url, init());
    if (res.status !== 429) return res;
    const body = await res.text();
    const waitMs = (replicateRetryAfterSeconds(body, res.headers.get("retry-after")) + 0.5) * 1000;
    if (Date.now() + waitMs > deadline) throw new Error(`Replicate throttled (429): ${body.slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * Replicate runs the model as a prediction: the audio goes in as a data URL
 * (small segments) or through the Files API (deleted again right after), and
 * `Prefer: wait` usually returns the finished prediction in the same request.
 */
async function transcribeReplicate(wav: Buffer, settings: SttCloudSettings, language?: string): Promise<string> {
  const base = trimSlash(settings.baseUrl);
  const auth = { Authorization: `Bearer ${settings.apiKey}` };
  const deadline = Date.now() + REPLICATE_TIMEOUT_MS;

  let audio: string;
  let uploadedId: string | null = null;
  if (wav.byteLength <= REPLICATE_INLINE_MAX_BYTES) {
    audio = `data:audio/wav;base64,${wav.toString("base64")}`;
  } else {
    const res = await fetchReplicate(
      `${base}/files`,
      () => {
        const form = new FormData();
        form.append("content", new Blob([toBytes(wav)], { type: "audio/wav" }), "audio.wav");
        return { method: "POST", headers: auth, body: form };
      },
      deadline,
    );
    if (!res.ok) throw new Error(`Replicate file upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const file = (await res.json()) as { id?: string; urls?: { get?: string } };
    if (!file.urls?.get) throw new Error("Replicate file upload returned no URL");
    audio = file.urls.get;
    uploadedId = file.id ?? null;
  }

  try {
    const input: Record<string, unknown> = { audio_file: audio };
    if (language) input.language = language;
    const request = replicatePredictionRequest(base, settings.model, input);
    const res = await fetchReplicate(
      request.url,
      () => ({
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json", Prefer: "wait=60" },
        body: JSON.stringify(request.body),
      }),
      deadline,
    );
    if (!res.ok) throw new Error(`Replicate request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    let prediction = (await res.json()) as ReplicatePrediction;

    while (prediction.status === "starting" || prediction.status === "processing") {
      if (Date.now() > deadline || !prediction.urls?.get) throw new Error("Replicate prediction timed out");
      await new Promise((r) => setTimeout(r, REPLICATE_POLL_MS));
      const poll = await fetch(prediction.urls.get, { headers: auth });
      if (!poll.ok) throw new Error(`Replicate poll failed (${poll.status})`);
      prediction = (await poll.json()) as ReplicatePrediction;
    }
    if (prediction.status !== "succeeded") {
      throw new Error(`Replicate prediction ${prediction.status ?? "failed"}: ${String(prediction.error ?? "").slice(0, 300)}`);
    }
    return replicateOutputText(prediction.output);
  } finally {
    if (uploadedId) {
      void fetch(`${base}/files/${uploadedId}`, { method: "DELETE", headers: auth }).catch(() => undefined);
    }
  }
}
