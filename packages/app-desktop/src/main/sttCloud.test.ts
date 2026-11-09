import { describe, expect, it } from "vitest";
import { replicateOutputText, replicatePredictionRequest, replicateRetryAfterSeconds } from "./sttCloud.js";

describe("replicateRetryAfterSeconds", () => {
  it("reads retry_after from Replicate's 429 body", () => {
    expect(replicateRetryAfterSeconds('{"detail":"Request was throttled.","status":429,"retry_after":7}', null)).toBe(7);
  });

  it("falls back to the Retry-After header, then to 5 s", () => {
    expect(replicateRetryAfterSeconds("throttled", "12")).toBe(12);
    expect(replicateRetryAfterSeconds("", null)).toBe(5);
  });
});

describe("replicatePredictionRequest", () => {
  const input = { audio_file: "data:audio/wav;base64,AAAA", language: "es" };

  it("runs the latest version of an owner/name model", () => {
    expect(replicatePredictionRequest("https://api.replicate.com/v1/", "openai/gpt-4o-transcribe", input)).toEqual({
      url: "https://api.replicate.com/v1/models/openai/gpt-4o-transcribe/predictions",
      body: { input },
    });
  });

  it("pins a version after a colon", () => {
    expect(replicatePredictionRequest("https://api.replicate.com/v1", "vaibhavs10/incredibly-fast-whisper:3ab8", input)).toEqual({
      url: "https://api.replicate.com/v1/predictions",
      body: { version: "3ab8", input },
    });
  });

  it("rejects a model that isn't owner/name", () => {
    expect(() => replicatePredictionRequest("https://api.replicate.com/v1", "", input)).toThrow(/owner\/name/);
    expect(() => replicatePredictionRequest("https://api.replicate.com/v1", "gpt-4o-transcribe", input)).toThrow(/owner\/name/);
  });
});

describe("replicateOutputText", () => {
  it("joins streamed chunks", () => {
    expect(replicateOutputText(["Las órdenes ", "llegan por correo."])).toBe("Las órdenes llegan por correo.");
  });

  it("accepts a plain string or a { text } object", () => {
    expect(replicateOutputText(" hola ")).toBe("hola");
    expect(replicateOutputText({ text: "hola" })).toBe("hola");
    expect(replicateOutputText({ transcription: "hola" })).toBe("hola");
  });

  it("is empty for anything else", () => {
    expect(replicateOutputText(null)).toBe("");
    expect(replicateOutputText({ segments: [] })).toBe("");
  });
});
