import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore } from "./store.js";

describe("SessionStore", () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "yggdrasil-sessions-"));
    store = new SessionStore(dir, 4);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends user and assistant messages", async () => {
    await store.appendUser("test:default:user", "hola");
    await store.appendAssistant("test:default:user", "hola de vuelta");

    const record = await store.get("test:default:user");
    expect(record?.messages).toHaveLength(2);
    expect(record?.messages[0]?.role).toBe("user");
    expect(record?.messages[1]?.role).toBe("assistant");
  });

  it("truncates to maxMessages", async () => {
    for (let i = 0; i < 6; i++) {
      await store.appendUser("s1", `u${i}`);
      await store.appendAssistant("s1", `a${i}`);
    }
    const record = await store.get("s1");
    expect(record?.messages.length).toBeLessThanOrEqual(4);
  });

  it("getHistoryBeforeLastUser excludes trailing user message", async () => {
    await store.appendUser("s2", "first");
    await store.appendAssistant("s2", "reply");
    await store.appendUser("s2", "second");

    const history = await store.getHistoryBeforeLastUser("s2");
    expect(history).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
    ]);
  });

  it("reset removes session file", async () => {
    await store.appendUser("s3", "msg");
    await store.reset("s3");
    expect(await store.get("s3")).toBeNull();
  });

  it("lists session summaries", async () => {
    await store.appendUser("s4", "a");
    const list = await store.list();
    expect(list.some((s) => s.sessionKey === "s4")).toBe(true);
  });

  it("session summary carries a lastMessage preview of the most recent user/assistant text", async () => {
    await store.appendUser("s5", "hola, como estas?");
    await store.appendAssistant("s5", "todo bien, y vos?");

    const list = await store.list();
    const summary = list.find((s) => s.sessionKey === "s5");
    expect(summary?.lastMessage).toEqual({
      role: "assistant",
      preview: "todo bien, y vos?",
      timestamp: expect.any(Number),
    });
  });

  it("lastMessage preview skips a trailing tool-result and picks the last user/assistant text instead", async () => {
    await store.appendUser("s6", "run echo");
    await store.appendMessages("s6", [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", name: "echo", arguments: "{}" }] },
      { role: "tool", content: '{"ok":true}', tool_call_id: "c1", name: "echo" },
    ]);

    const list = await store.list();
    const summary = list.find((s) => s.sessionKey === "s6");
    expect(summary?.lastMessage).toEqual({
      role: "user",
      preview: "run echo",
      timestamp: expect.any(Number),
    });
  });

  it("lastMessage preview collapses whitespace and truncates long content", async () => {
    const long = "x".repeat(250);
    await store.appendUser("s7", `line one\nline   two\n${long}`);

    const list = await store.list();
    const summary = list.find((s) => s.sessionKey === "s7");
    expect(summary?.lastMessage?.preview.length).toBe(200);
    expect(summary?.lastMessage?.preview.endsWith("…")).toBe(true);
    expect(summary?.lastMessage?.preview).not.toContain("\n");
  });

  it("has no lastMessage when no message has any user/assistant text yet", async () => {
    await store.appendMessages("s8", [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", name: "echo", arguments: "{}" }] },
      { role: "tool", content: '{"ok":true}', tool_call_id: "c1", name: "echo" },
    ]);

    const list = await store.list();
    const summary = list.find((s) => s.sessionKey === "s8");
    expect(summary?.lastMessage).toBeUndefined();
  });

  it("appendMessages persists tool_calls and tool results", async () => {
    await store.appendUser("tools", "run echo");
    await store.appendMessages("tools", [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", name: "echo", arguments: '{"message":"hi"}' }],
      },
      { role: "tool", content: '{"ok":true}', tool_call_id: "c1", name: "echo" },
    ]);
    await store.appendAssistant("tools", "done");

    const history = await store.getHistory("tools");
    expect(history).toHaveLength(4);
    expect(history[1]?.tool_calls?.[0]?.name).toBe("echo");
    expect(history[2]?.role).toBe("tool");
  });

  it("patch persists title metadata and agentId", async () => {
    await store.appendUser("patch-test", "hi");
    const updated = await store.patch("patch-test", {
      title: "Demo",
      agentId: "agent-1",
      metadata: { topic: "tools" },
    });
    expect(updated.title).toBe("Demo");
    expect(updated.agentId).toBe("agent-1");
    expect(updated.metadata).toEqual({ topic: "tools" });

    const reloaded = await store.get("patch-test");
    expect(reloaded?.title).toBe("Demo");
  });
});
