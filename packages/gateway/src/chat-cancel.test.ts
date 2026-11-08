import { describe, expect, it } from "vitest";
import { mergeConfig } from "@yggdrasil/config";
import { invokeGatewayMethod } from "./server.js";

describe("chat.cancel", () => {
  const config = mergeConfig({}, { agents: [{ id: "default" }] });

  it("reports cancelled:false when the session has no turn in flight", async () => {
    const result = await invokeGatewayMethod("chat.cancel", { sessionKey: "tui:default:nobody" }, config, null, undefined);
    expect(result).toEqual({ sessionKey: "tui:default:nobody", cancelled: false });
  });

  it("requires a sessionKey", async () => {
    await expect(invokeGatewayMethod("chat.cancel", {}, config, null, undefined)).rejects.toThrow(/sessionKey required/);
  });
});
