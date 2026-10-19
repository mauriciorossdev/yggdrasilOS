import type { TtsCloudSettings } from "./piperSettings.js";

export type TtsCloudResult = {
  audio: Buffer;
  mimeType: string;
};

type MinimaxT2aResponse = {
  data?: { audio?: string };
  base_resp?: { status_code: number; status_msg: string };
};

function assertConfigured(settings: TtsCloudSettings): void {
  if (!settings.apiKey) {
    throw new Error(`No API key set for the ${settings.provider} TTS provider — set one in Settings → TTS.`);
  }
  if (!settings.baseUrl) {
    throw new Error("No base URL set for the custom TTS provider — set one in Settings → TTS.");
  }
  if (!settings.voiceId && settings.provider !== "replicate") {
    throw new Error("No voice ID set for the cloud TTS provider — set one in Settings → TTS.");
  }
}

/**
 * MiniMax's t2a_v2 endpoint — bespoke JSON shape (not OpenAI-compatible),
 * audio comes back hex-encoded inside the JSON body, not as raw bytes.
 */
async function synthesizeMinimax(text: string, settings: TtsCloudSettings): Promise<TtsCloudResult> {
  const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/t2a_v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      text,
      output_format: "hex",
      voice_setting: { voice_id: settings.voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
    }),
  });

  if (!res.ok) {
    throw new Error(`TTS cloud request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as MinimaxT2aResponse;
  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`TTS cloud error: ${data.base_resp.status_msg}`);
  }

  const hex = data.data?.audio ?? "";
  if (!hex) throw new Error("TTS cloud request returned no audio.");

  return { audio: Buffer.from(hex, "hex"), mimeType: "audio/mpeg" };
}

/**
 * OpenAI's /audio/speech shape — Groq implements it verbatim (model/input/
 * voice/response_format JSON in, raw binary audio bytes out, not wrapped in
 * JSON), and "custom" is any self-hosted server that mimics it.
 */
async function synthesizeOpenAiCompatible(text: string, settings: TtsCloudSettings): Promise<TtsCloudResult> {
  const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      input: text,
      voice: settings.voiceId,
      response_format: "wav",
    }),
  });

  if (!res.ok) {
    throw new Error(`TTS cloud request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.byteLength === 0) throw new Error("TTS cloud request returned no audio.");

  return { audio, mimeType: "audio/wav" };
}

type ReplicatePrediction = {
  status?: string;
  output?: string | string[] | null;
  error?: string | null;
};

/**
 * Replicate predictions API. `Prefer: wait` holds the request open until the
 * model finishes (up to ~60s); the audio comes back as a URL to download.
 */
async function synthesizeReplicate(text: string, settings: TtsCloudSettings): Promise<TtsCloudResult> {
  const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/models/${settings.model}/predictions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
      Prefer: "wait",
    },
    body: JSON.stringify({
      input: {
        text,
        pitch: 0,
        speed: 1,
        volume: 1,
        bitrate: 128000,
        channel: "mono",
        emotion: "neutral",
        voice_id: settings.voiceId || "Spanish_FrankLady",
        sample_rate: 32000,
        audio_format: "mp3",
        language_boost: "Spanish",
        subtitle_enable: false,
        english_normalization: false,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`TTS cloud request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const prediction = (await res.json()) as ReplicatePrediction;
  if (prediction.status !== "succeeded") {
    throw new Error(`TTS cloud error: ${prediction.error ?? prediction.status ?? "unknown"}`);
  }

  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!url) throw new Error("TTS cloud request returned no audio.");

  const audioRes = await fetch(url);
  if (!audioRes.ok) throw new Error(`TTS audio download failed (${audioRes.status})`);
  return { audio: Buffer.from(await audioRes.arrayBuffer()), mimeType: "audio/mpeg" };
}

export async function synthesizeCloud(text: string, settings: TtsCloudSettings): Promise<TtsCloudResult> {
  assertConfigured(settings);
  if (settings.provider === "replicate") return synthesizeReplicate(text, settings);
  return settings.provider === "minimax"
    ? synthesizeMinimax(text, settings)
    : synthesizeOpenAiCompatible(text, settings);
}
