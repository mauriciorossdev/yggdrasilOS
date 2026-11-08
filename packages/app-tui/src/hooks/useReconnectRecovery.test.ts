import { describe, expect, it, vi } from "vitest";
import { recoverSession } from "./useReconnectRecovery.js";

describe("recoverSession", () => {
  it("re-sends the approval mode and rebuilds messages from the session record", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "sessions.get") return { session: { messages: [{ role: "assistant", content: "done", timestamp: 9 }] } };
      return { ok: true };
    });
    const out = await recoverSession({ call } as never, "tui:default:x", "plan");
    expect(call).toHaveBeenCalledWith("tools.setApprovalMode", { sessionKey: "tui:default:x", mode: "plan" });
    expect(out?.messages).toMatchObject([{ role: "assistant", text: "done", timestamp: 9 }]);
  });

  it("returns null when the gateway has no such session", async () => {
    const call = vi.fn(async (method: string) => (method === "sessions.get" ? { session: null } : {}));
    expect(await recoverSession({ call } as never, "k", "auto")).toBeNull();
  });

  it("still resolves when the mode re-send fails", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "tools.setApprovalMode") throw new Error("nope");
      return { session: null };
    });
    expect(await recoverSession({ call } as never, "k", "auto")).toBeNull();
  });
});
