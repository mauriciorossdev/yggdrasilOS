import { describe, it, expect } from "vitest";
import { synthesizeSpeech, TTS_MAX_CHARS } from "./tts.js";

const env = { REPLICATE_API_TOKEN: "r8_test" } as NodeJS.ProcessEnv;

describe("synthesizeSpeech", () => {
  it("requires REPLICATE_API_TOKEN", async () => {
    await expect(synthesizeSpeech({ text: "hola", env: {} as NodeJS.ProcessEnv })).rejects.toThrow(/REPLICATE_API_TOKEN/);
  });

  it("rejects empty and oversized text before calling Replicate", async () => {
    const fetchImpl = (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    await expect(synthesizeSpeech({ text: "  ", env, fetchImpl })).rejects.toThrow(/text required/);
    await expect(
      synthesizeSpeech({ text: "x".repeat(TTS_MAX_CHARS + 1), env, fetchImpl }),
    ).rejects.toThrow(/too long/);
  });

  it("calls the MiniMax model on Replicate and returns base64 mp3", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/predictions")) {
        return new Response(
          JSON.stringify({ status: "succeeded", output: "https://cdn.example/a.mp3" }),
          { status: 200 },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await synthesizeSpeech({ text: "Hola", voiceId: "Spanish_Test", env, fetchImpl });

    expect(calls[0]!.url).toBe("https://api.replicate.com/v1/models/minimax/speech-2.8-turbo/predictions");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer r8_test");
    expect(headers.Prefer).toBe("wait");
    const body = JSON.parse(String(calls[0]!.init?.body)) as { input: { text: string; voice_id: string } };
    expect(body.input.text).toBe("Hola");
    expect(body.input.voice_id).toBe("Spanish_Test");
    expect(result).toEqual({ audioBase64: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "audio/mpeg" });
  });

  it("surfaces a failed prediction", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "failed", error: "bad voice" }), { status: 200 })) as unknown as typeof fetch;
    await expect(synthesizeSpeech({ text: "hola", env, fetchImpl })).rejects.toThrow(/bad voice/);
  });
});
