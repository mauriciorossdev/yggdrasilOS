import { afterEach, describe, expect, it } from "vitest";
import { createTestPlatform } from "../../../../test/helpers/index.js";
import { mountTui, type TuiHandle } from "./mountTui.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("mountTui", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;
  let tui: TuiHandle | undefined;

  afterEach(async () => {
    tui?.unmount();
    tui = undefined;
    await platform?.close();
  });

  it("lets a driver type into the real TUI and read the screen back", async () => {
    platform = await createTestPlatform({
      startServer: true,
      configOverride: { agents: [{ id: "default", provider: "builtin", model: "echo" }] },
    });
    tui = mountTui({ gatewayUrl: `ws://127.0.0.1:${platform.gatewayPort}`, sessionKey: "tui:default:mount-test" });

    await until(() => tui!.screen().join("\n").includes("agent:default"), "the TUI to connect");
    await tui.submit("hola mount");
    await until(() => tui!.screen().join("\n").includes("echo: hola mount"), "the echo reply on screen");
    expect(tui.screen().join("\n")).toContain("hola mount");
  });
});
