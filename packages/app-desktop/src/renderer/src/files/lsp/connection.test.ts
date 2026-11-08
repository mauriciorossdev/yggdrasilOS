import { describe, expect, it, vi } from "vitest";
import { LspConnection } from "./connection.js";

function setup() {
  const sent: Array<Record<string, unknown>> = [];
  return { sent, conn: new LspConnection((m) => sent.push(m as Record<string, unknown>)) };
}

describe("LspConnection", () => {
  it("matches responses to requests", async () => {
    const { conn, sent } = setup();
    const a = conn.request("a");
    const b = conn.request("b");
    conn.receive({ id: sent[1]!.id, result: 2 });
    conn.receive({ id: sent[0]!.id, result: 1 });
    expect(await a).toBe(1);
    expect(await b).toBe(2);
  });

  it("rejects on an error response", async () => {
    const { conn, sent } = setup();
    const a = conn.request("a");
    conn.receive({ id: sent[0]!.id, error: { message: "nope" } });
    await expect(a).rejects.toThrow("nope");
  });

  it("marks cancellations so Monaco ignores them", async () => {
    const { conn, sent } = setup();
    const a = conn.request("a");
    conn.receive({ id: sent[0]!.id, error: { code: -32800, message: "request was cancelled by client" } });
    await expect(a).rejects.toMatchObject({ name: "Canceled", message: "Canceled" });
  });

  it("cancels through the token", () => {
    const { conn, sent } = setup();
    let cancel = () => {};
    void conn.request("a", undefined, { onCancellationRequested: (l) => void (cancel = l) }).catch(() => {});
    cancel();
    expect(sent[1]).toMatchObject({ method: "$/cancelRequest", params: { id: sent[0]!.id } });
  });

  it("answers server requests, including ones it can't handle", async () => {
    const { conn, sent } = setup();
    conn.onRequest("ok", async () => 5);
    conn.onRequest("bad", () => {
      throw new Error("boom");
    });
    conn.receive({ id: "s1", method: "ok" });
    conn.receive({ id: "s2", method: "bad" });
    conn.receive({ id: "s3", method: "unknown" });
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.find((m) => m.id === "s1")).toMatchObject({ result: 5 });
    expect(sent.find((m) => m.id === "s2")).toMatchObject({ error: { message: "boom" } });
    expect(sent.find((m) => m.id === "s3")).toMatchObject({ error: { code: -32601 } });
  });

  it("dispatches notifications", () => {
    const { conn } = setup();
    const handler = vi.fn();
    conn.onNotification("n", handler);
    conn.receive({ method: "n", params: 1 });
    expect(handler).toHaveBeenCalledWith(1);
  });

  it("fails pending requests and sends nothing after close", async () => {
    const { conn, sent } = setup();
    const a = conn.request("a");
    conn.close();
    await expect(a).rejects.toThrow("closed");
    await expect(conn.request("b")).rejects.toThrow("closed");
    conn.notify("c");
    expect(sent).toHaveLength(1);
  });
});
