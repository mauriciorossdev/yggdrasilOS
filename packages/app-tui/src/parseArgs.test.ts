import { describe, expect, it } from "vitest";
import { parseArgs } from "./parseArgs.js";

describe("parseArgs", () => {
  it("defaults to the local gateway", () => {
    expect(parseArgs([])).toEqual({ gatewayUrl: "ws://127.0.0.1:18789", continueSession: false, alternateScreen: true });
  });
  it("reads space- and equals-separated values", () => {
    expect(parseArgs(["--connect", "ws://h:1", "--api-key=k", "--agent", "reviewer", "--continue"])).toEqual({
      gatewayUrl: "ws://h:1",
      apiKey: "k",
      agentId: "reviewer",
      continueSession: true,
      alternateScreen: true,
    });
  });
  it("ignores unknown flags and a flag missing its value", () => {
    expect(parseArgs(["--nope", "--connect"])).toEqual({ gatewayUrl: "ws://127.0.0.1:18789", continueSession: false, alternateScreen: true });
  });
  it("can opt out of the alternate screen", () => {
    expect(parseArgs(["--no-alt-screen"]).alternateScreen).toBe(false);
  });
});
