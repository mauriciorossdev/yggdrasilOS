import type { SttCloudSettings } from "./whisperSettings.js";

/**
 * OpenAI's /audio/transcriptions multipart shape — OpenAI itself implements
 * it verbatim, and "custom" is any self-hosted server that mimics it, so one
 * implementation covers both providers.
 */
export async function transcribeCloud(wav: Buffer, settings: SttCloudSettings): Promise<string> {
  if (!settings.apiKey) {
    throw new Error(`No API key set for the ${settings.provider} STT provider — set one in Settings → STT.`);
  }
  if (!settings.baseUrl) {
    throw new Error("No base URL set for the custom STT provider — set one in Settings → STT.");
  }

  // A plain Buffer is typed Buffer<ArrayBufferLike> (its backing store could
  // in principle be a SharedArrayBuffer), which lib.dom's BlobPart rejects —
  // copying into a fixed-length Uint8Array guarantees a real, non-shared
  // ArrayBuffer underneath and satisfies Blob's constructor.
  const wavBytes = new Uint8Array(wav.byteLength);
  wavBytes.set(wav);
  const form = new FormData();
  form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "audio.wav");
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
