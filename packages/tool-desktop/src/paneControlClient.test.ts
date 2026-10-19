import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { callDesktopControl, DesktopControlError, DesktopControlUnavailableError } from "./paneControlClient.js";

function mockFetchOnce(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.YGGDRASIL_PANE_CONTROL_URL = "http://127.0.0.1:12345";
  process.env.YGGDRASIL_PANE_CONTROL_TOKEN = "secret-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.YGGDRASIL_PANE_CONTROL_URL;
  delete process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
});

describe("callDesktopControl", () => {
  it("throws DesktopControlUnavailableError when the env vars are missing", async () => {
    delete process.env.YGGDRASIL_PANE_CONTROL_URL;
    delete process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    await expect(callDesktopControl("GET", "/desktop/frontmost")).rejects.toBeInstanceOf(DesktopControlUnavailableError);
  });

  it("sends the bearer token and returns the parsed body on success", async () => {
    const fetchMock = mockFetchOnce({ app: "Microsoft Teams" });
    const result = await callDesktopControl<{ app: string }>("GET", "/desktop/frontmost");
    expect(result).toEqual({ app: "Microsoft Teams" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:12345/desktop/frontmost",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }),
    );
  });

  it("sends a JSON body on POST", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    await callDesktopControl("POST", "/desktop/notify", { title: "Hi", body: "there" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe(JSON.stringify({ title: "Hi", body: "there" }));
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("throws DesktopControlError with the route's error code on a non-ok response", async () => {
    mockFetchOnce({ error: "permission_required" }, false, 403);
    const err = await callDesktopControl("POST", "/desktop/screenshot", { mode: "screen" }).catch((e) => e);
    expect(err).toBeInstanceOf(DesktopControlError);
    expect((err as DesktopControlError).code).toBe("permission_required");
  });
});
