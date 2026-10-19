import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "@yggdrasil/tools-sdk";
import { createTranscribeAudioTool, transcribeWithReplicate } from "./transcribe.js";

const env = { REPLICATE_API_TOKEN: "r8_test" } as NodeJS.ProcessEnv;

type Call = { url: string; init?: RequestInit };
function fakeReplicate(transcription: string, opts: { slowFirst?: boolean } = {}) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/files")) return new Response(JSON.stringify({ urls: { get: "https://files.example/a.m4a" } }), { status: 200 });
    if (url === "https://api.replicate.com/v1/models/openai/whisper") {
      return new Response(JSON.stringify({ latest_version: { id: "v-latest-123" } }), { status: 200 });
    }
    if (url.endsWith("/predictions") && init?.method === "POST") {
      return opts.slowFirst
        ? new Response(JSON.stringify({ status: "processing", urls: { get: "https://poll.example/1" } }), { status: 200 })
        : new Response(JSON.stringify({ status: "succeeded", output: { transcription } }), { status: 200 });
    }
    if (url === "https://poll.example/1") return new Response(JSON.stringify({ status: "succeeded", output: { transcription } }), { status: 200 });
    return new Response("unexpected", { status: 500 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("transcribe_audio", () => {
  let root: string;
  let notes: string;
  let ctx: ToolContext;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "transcribe-"));
    notes = join(root, "notes", "assistant");
    mkdirSync(notes, { recursive: true });
    ctx = { sessionKey: "s", config: {}, workspaceRoot: root };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("uploads the audio, runs Whisper and returns the text", async () => {
    const { fn, calls } = fakeReplicate("Hola, esta es una nota de voz.");
    const text = await transcribeWithReplicate(Buffer.from([1, 2, 3]), "nota.m4a", { env, fetchImpl: fn, language: "es" });
    expect(text).toBe("Hola, esta es una nota de voz.");
    expect(calls[0]!.url).toBe("https://api.replicate.com/v1/files");
    const pred = calls.find((c) => c.url === "https://api.replicate.com/v1/predictions")!;
    expect((pred.init?.headers as Record<string, string>).Authorization).toBe("Bearer r8_test");
    const body = JSON.parse(String(pred.init?.body)) as { version: string; input: Record<string, unknown> };
    expect(body.version).toBe("v-latest-123"); // resolved from the model, not hard-coded
    expect(body.input).toMatchObject({ audio: "https://files.example/a.m4a", language: "es", transcription: "plain text" });
  });

  it("uses a pinned version from REPLICATE_STT_MODEL without looking the model up", async () => {
    const { fn, calls } = fakeReplicate("ok");
    await transcribeWithReplicate(Buffer.from([1]), "n.m4a", {
      env: { ...env, REPLICATE_STT_MODEL: "someone/whisper-fast:pinned-9" } as NodeJS.ProcessEnv,
      fetchImpl: fn,
    });
    expect(calls.some((c) => c.url.includes("/models/"))).toBe(false);
    const body = JSON.parse(String(calls.find((c) => c.url.endsWith("/predictions"))!.init?.body)) as { version: string };
    expect(body.version).toBe("pinned-9");
  });

  it("polls when the prediction is still running", async () => {
    const { fn } = fakeReplicate("texto largo", { slowFirst: true });
    const text = await transcribeWithReplicate(Buffer.from([1]), "n.m4a", { env, fetchImpl: fn, sleep: async () => {} });
    expect(text).toBe("texto largo");
  });

  it("requires REPLICATE_API_TOKEN and reports a failed prediction", async () => {
    await expect(transcribeWithReplicate(Buffer.from([1]), "n.m4a", { env: {} as NodeJS.ProcessEnv })).rejects.toThrow(/REPLICATE_API_TOKEN/);
    const failing = (async (url: string) => {
      if (url.endsWith("/files")) return new Response(JSON.stringify({ urls: { get: "u" } }), { status: 200 });
      if (url.includes("/models/")) return new Response(JSON.stringify({ latest_version: { id: "v1" } }), { status: 200 });
      return new Response(JSON.stringify({ status: "failed", error: "bad audio" }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(transcribeWithReplicate(Buffer.from([1]), "n.m4a", { env, fetchImpl: failing })).rejects.toThrow(/bad audio/);
  });

  it("caches the transcript so a second question costs nothing", async () => {
    const { fn, calls } = fakeReplicate("contenido del audio");
    const tool = createTranscribeAudioTool({ env, fetchImpl: fn });
    writeFileSync(join(notes, "nota.m4a"), Buffer.from([1, 2, 3]));

    const first = (await tool.execute(ctx, { path: "assistant/nota.m4a" })) as { text: string; cached: boolean };
    expect(first).toMatchObject({ text: "contenido del audio", cached: false });
    expect(existsSync(join(notes, ".transcripts", "nota.m4a.txt"))).toBe(true);

    const callsAfterFirst = calls.length;
    const second = (await tool.execute(ctx, { path: "assistant/nota.m4a" })) as { text: string; cached: boolean };
    expect(second).toMatchObject({ text: "contenido del audio", cached: true });
    expect(calls.length).toBe(callsAfterFirst);
  });

  it("pages very long transcripts and rejects non-audio files", async () => {
    const tool = createTranscribeAudioTool({ env, fetchImpl: fakeReplicate("x").fn });
    writeFileSync(join(notes, "larga.m4a"), Buffer.from([1]));
    mkdirSync(join(notes, ".transcripts"), { recursive: true });
    writeFileSync(join(notes, ".transcripts", "larga.m4a.txt"), "a".repeat(50_000) + "fin");

    const first = (await tool.execute(ctx, { path: "assistant/larga.m4a" })) as { truncated: boolean; nextOffset?: number; text: string };
    expect(first.truncated).toBe(true);
    expect(first.nextOffset).toBe(50_000);
    const second = (await tool.execute(ctx, { path: "assistant/larga.m4a", offset: first.nextOffset })) as { text: string; truncated: boolean };
    expect(second.text).toBe("fin");
    expect(second.truncated).toBe(false);

    writeFileSync(join(notes, "doc.txt"), "hola");
    await expect(tool.execute(ctx, { path: "assistant/doc.txt" })).rejects.toThrow(/not a supported audio/);
    expect(readFileSync(join(notes, "doc.txt"), "utf8")).toBe("hola");
  });
});
