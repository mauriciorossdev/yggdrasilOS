import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ollamaModelCapabilities, ollamaReachable } from "./platform.js";

// A stand-in for Ollama Cloud: every endpoint wants the bearer token.
const KEY = "test-key-abcdef123456";
let server: Server;
let url = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags") res.end(JSON.stringify({ models: [{ name: "m1" }] }));
    else if (req.url === "/api/show") res.end(JSON.stringify({ capabilities: ["completion", "tools"] }));
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("Ollama preflight with an API key", () => {
  it("reaches a server that requires the key", async () => {
    expect(await ollamaReachable(url, KEY)).toEqual({ ok: true, status: 200 });
    expect(await ollamaModelCapabilities(url, "m1", KEY)).toEqual(["completion", "tools"]);
  });

  it("reports a missing or wrong key as 401, not as 'unreachable'", async () => {
    expect(await ollamaReachable(url)).toEqual({ ok: false, status: 401 });
    expect(await ollamaReachable(url, "wrong")).toEqual({ ok: false, status: 401 });
    expect(await ollamaModelCapabilities(url, "m1", "wrong")).toBeNull();
  });

  it("says unreachable (no status) when nothing is listening", async () => {
    expect(await ollamaReachable("http://127.0.0.1:1")).toEqual({ ok: false });
  });
});
