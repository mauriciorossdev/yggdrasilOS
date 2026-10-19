import { describe, it, expect } from "vitest";
import { listModels } from "./client.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("Ollama client listModels", () => {
  it("returns the model list on success", async () => {
    const fetchImpl = (async () => jsonResponse({ models: [{ name: "llama3", model: "llama3", size: 1 }] })) as typeof fetch;

    const result = await listModels({ baseUrl: "http://127.0.0.1:11434", fetchImpl });
    expect(result.models).toEqual([{ name: "llama3", model: "llama3", size: 1 }]);
  });

  it("wraps a fetch failure (dead/unreachable host) in a clear error instead of hanging or throwing the raw cause", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    await expect(listModels({ baseUrl: "http://192.168.100.255:11434", fetchImpl })).rejects.toThrow(
      /http:\/\/192\.168\.100\.255:11434 is unreachable/,
    );
  });

  it("wraps an AbortSignal timeout with a distinct 'timed out' message", async () => {
    const fetchImpl = (async () => {
      const err = new Error("The operation was aborted");
      err.name = "TimeoutError";
      throw err;
    }) as typeof fetch;

    await expect(listModels({ baseUrl: "http://192.168.100.255:11434", fetchImpl })).rejects.toThrow(
      /http:\/\/192\.168\.100\.255:11434 is timed out/,
    );
  });

  it("passes an AbortSignal to fetch so a hung connection is actually bounded, not left open indefinitely", async () => {
    let receivedInit: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      receivedInit = init;
      return jsonResponse({ models: [] });
    }) as typeof fetch;

    await listModels({ baseUrl: "http://127.0.0.1:11434", fetchImpl });
    expect(receivedInit?.signal).toBeInstanceOf(AbortSignal);
  });
});
