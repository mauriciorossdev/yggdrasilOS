import { describe, it, expect, vi, afterEach } from "vitest";
import { httpRequestExecutor } from "./http.js";

function mockFetch(body: string, init?: ResponseInit): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function run(params: Record<string, unknown>) {
  return httpRequestExecutor({ node: {} as never, params, exprCtx: {} as never, signal: new AbortController().signal, workflow: {} as never, nodeExecutors: {} });
}

describe("httpRequestExecutor", () => {
  it("defaults to GET and parses a JSON response body", async () => {
    mockFetch(JSON.stringify({ hello: "world" }), { status: 200, headers: { "content-type": "application/json" } });
    const result = await run({ url: "https://example.com/api" });
    expect(result).toEqual({
      handle: "out",
      output: { status: 200, ok: true, headers: { "content-type": "application/json" }, body: { hello: "world" } },
    });
  });

  it("keeps a non-JSON response body as plain text", async () => {
    mockFetch("hello plain text", { status: 200, headers: { "content-type": "text/plain" } });
    const result = await run({ url: "https://example.com/api" });
    expect((result.output as { body: unknown }).body).toBe("hello plain text");
  });

  it("sends an object body as JSON with a Content-Type header, for a non-GET method", async () => {
    const fetchMock = mockFetch("{}", { status: 200 });
    await run({ url: "https://example.com/api", method: "post", body: { a: 1 } });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("does not attach a body for GET even if one is provided", async () => {
    const fetchMock = mockFetch("{}", { status: 200 });
    await run({ url: "https://example.com/api", method: "GET", body: { a: 1 } });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBeUndefined();
  });

  it("reports a non-2xx status without throwing — ok:false, not an error", async () => {
    mockFetch("not found", { status: 404 });
    const result = await run({ url: "https://example.com/missing" });
    expect(result.output).toMatchObject({ status: 404, ok: false });
  });

  it("throws when `url` is missing", async () => {
    await expect(run({})).rejects.toThrow(/url/);
  });

  it("rejects a response body over the 5MB cap", async () => {
    const big = "x".repeat(6 * 1024 * 1024);
    mockFetch(big, { status: 200 });
    await expect(run({ url: "https://example.com/big" })).rejects.toThrow(/exceeded/);
  });
});
