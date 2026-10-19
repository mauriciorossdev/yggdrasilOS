export type SynthesizeOptions = {
  text: string;
  voiceId?: string;
  /** Overridable for tests. */
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

export type SynthesizeResult = {
  audioBase64: string;
  mimeType: string;
};

export const TTS_MAX_CHARS = 2000;
const DEFAULT_MODEL = "minimax/speech-2.8-turbo";
const DEFAULT_VOICE = "Spanish_FrankLady";
const REPLICATE_BASE = "https://api.replicate.com/v1";

type ReplicatePrediction = {
  status?: string;
  output?: string | string[] | null;
  error?: string | null;
};

/**
 * Text-to-speech through Replicate's MiniMax speech model — same call shape
 * as the desktop avatar app (packages/app-avatar/src/main/ttsCloud.ts). The
 * Replicate token lives only in the gateway's environment
 * (REPLICATE_API_TOKEN); phones just ask for audio over the authenticated
 * gateway connection.
 */
export async function synthesizeSpeech(options: SynthesizeOptions): Promise<SynthesizeResult> {
  const env = options.env ?? process.env;
  const fetchFn = options.fetchImpl ?? fetch;
  const token = env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error("TTS not configured: set REPLICATE_API_TOKEN on the gateway");

  const text = options.text.trim();
  if (!text) throw new Error("text required");
  if (text.length > TTS_MAX_CHARS) {
    throw new Error(`text too long for TTS (${text.length} > ${TTS_MAX_CHARS} chars)`);
  }

  const model = env.REPLICATE_TTS_MODEL?.trim() || DEFAULT_MODEL;
  const res = await fetchFn(`${REPLICATE_BASE}/models/${model}/predictions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // Hold the request open until the model finishes (~60s max); audio comes back as a URL.
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
        voice_id: options.voiceId?.trim() || env.REPLICATE_TTS_VOICE?.trim() || DEFAULT_VOICE,
        sample_rate: 32000,
        audio_format: "mp3",
        language_boost: "Spanish",
        subtitle_enable: false,
        english_normalization: false,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`TTS request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const prediction = (await res.json()) as ReplicatePrediction;
  if (prediction.status !== "succeeded") {
    throw new Error(`TTS error: ${prediction.error ?? prediction.status ?? "unknown"}`);
  }

  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!url) throw new Error("TTS returned no audio");

  const audioRes = await fetchFn(url);
  if (!audioRes.ok) throw new Error(`TTS audio download failed (${audioRes.status})`);
  const audio = Buffer.from(await audioRes.arrayBuffer());
  if (audio.byteLength === 0) throw new Error("TTS returned empty audio");

  return { audioBase64: audio.toString("base64"), mimeType: "audio/mpeg" };
}
