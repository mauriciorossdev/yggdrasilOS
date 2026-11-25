import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "ygg-open-gateways-"));
vi.mock("electron", () => ({ app: { getPath: () => dir } }));

const { registerOpenGateway, resetOpenGateways, unregisterOpenGateway } = await import("./openGateways.js");

describe("openGateways", () => {
  it("keeps every entry when several windows register at the same time", async () => {
    await resetOpenGateways();
    await Promise.all([registerOpenGateway("a", 1), registerOpenGateway("b", 2), registerOpenGateway("c", 3)]);
    expect(JSON.parse(readFileSync(join(dir, "open-gateways.json"), "utf8"))).toEqual({ a: { port: 1 }, b: { port: 2 }, c: { port: 3 } });
  });

  it("orders a register and an unregister issued together", async () => {
    await resetOpenGateways();
    await Promise.all([registerOpenGateway("a", 1), unregisterOpenGateway("a"), registerOpenGateway("b", 2)]);
    expect(JSON.parse(readFileSync(join(dir, "open-gateways.json"), "utf8"))).toEqual({ b: { port: 2 } });
  });
});
