import { describe, it, expect } from "vitest";
import { tuiReducer, initialState, type TuiState } from "./store.js";

function fresh(): TuiState {
  return initialState();
}

describe("tuiReducer", () => {
  it("ADD_USER_MESSAGE pushes user message and resets scroll", () => {
    const s = tuiReducer(
      { ...fresh(), scrollOffset: 5 },
      { type: "ADD_USER_MESSAGE", text: "hello" },
    );
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.role).toBe("user");
    expect(s.messages[0]!.text).toBe("hello");
    expect(s.scrollOffset).toBe(0);
  });

  it("CHAT_DELTA accumulates streaming text", () => {
    let s = fresh();
    s = tuiReducer(s, {
      type: "CHAT_DELTA",
      payload: { sessionKey: "k", text: "hel", partial: true },
    });
    expect(s.streamingText).toBe("hel");
    expect(s.isStreaming).toBe(true);

    s = tuiReducer(s, {
      type: "CHAT_DELTA",
      payload: { sessionKey: "k", text: "lo", partial: true },
    });
    expect(s.streamingText).toBe("hello");
  });

  it("CHAT_FINAL clears streaming and pushes assistant message", () => {
    let s = { ...fresh(), streamingText: "hello", isStreaming: true };
    s = tuiReducer(s, {
      type: "CHAT_FINAL",
      payload: { sessionKey: "k", text: "hello world", harnessId: "h" },
    });
    expect(s.streamingText).toBe("");
    expect(s.isStreaming).toBe(false);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.role).toBe("assistant");
    expect(s.messages[0]!.text).toBe("hello world");
  });

  it("TURN_START / TURN_END track turn state", () => {
    let s = fresh();
    s = tuiReducer(s, {
      type: "TURN_START",
      payload: { sessionKey: "k", agentId: "a", harnessId: "h", messagePreview: "hi" },
    });
    expect(s.isTurnActive).toBe(true);
    expect(s.turnDurationMs).toBeNull();

    s = tuiReducer(s, {
      type: "TURN_END",
      payload: { sessionKey: "k", harnessId: "h", classification: "ok", durationMs: 250 },
    });
    expect(s.isTurnActive).toBe(false);
    expect(s.turnDurationMs).toBe(250);
  });

  it("TOOL_EXECUTE running does not push message, ok does", () => {
    let s = fresh();
    s = tuiReducer(s, {
      type: "TOOL_EXECUTE",
      payload: { sessionKey: "k", toolName: "read", status: "running" },
    });
    expect(s.messages).toHaveLength(0);
    expect(s.toolCalls.size).toBe(1);

    s = tuiReducer(s, {
      type: "TOOL_EXECUTE",
      payload: { sessionKey: "k", toolName: "read", status: "ok", result: "file content" },
    });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.role).toBe("tool");
    expect(s.messages[0]!.toolStatus).toBe("ok");
  });

  it("TOOL_APPROVAL_REQUESTED / RESOLVED manage pendingApproval", () => {
    let s = fresh();
    s = tuiReducer(s, {
      type: "TOOL_APPROVAL_REQUESTED",
      payload: {
        requestId: "r1",
        sessionKey: "k",
        toolName: "delete",
        args: { path: "/tmp" },
        riskLevel: "destructive",
      },
    });
    expect(s.pendingApproval).not.toBeNull();
    expect(s.pendingApproval!.requestId).toBe("r1");

    s = tuiReducer(s, {
      type: "TOOL_APPROVAL_RESOLVED",
      payload: { requestId: "r1", sessionKey: "k", toolName: "delete", approved: true },
    });
    expect(s.pendingApproval).toBeNull();
  });

  it("SET_AGENTS sets default active agent", () => {
    const s = tuiReducer(fresh(), {
      type: "SET_AGENTS",
      agents: [{ id: "a1", model: "m", provider: "p", systemPrompt: "" }],
      defaultAgent: "a1",
    });
    expect(s.agents).toHaveLength(1);
    expect(s.activeAgentId).toBe("a1");
    expect(s.defaultAgent).toBe("a1");
  });

  it("SET_AGENTS preserves existing activeAgentId", () => {
    const s = tuiReducer({ ...fresh(), activeAgentId: "custom" }, {
      type: "SET_AGENTS",
      agents: [],
      defaultAgent: "a1",
    });
    expect(s.activeAgentId).toBe("custom");
  });

  it("RESET_MESSAGES clears messages and streaming", () => {
    const s = tuiReducer(
      {
        ...fresh(),
        messages: [{ id: "1", role: "user", text: "hi", timestamp: 0 }],
        streamingText: "partial",
        isStreaming: true,
        scrollOffset: 3,
      },
      { type: "RESET_MESSAGES" },
    );
    expect(s.messages).toHaveLength(0);
    expect(s.streamingText).toBe("");
    expect(s.isStreaming).toBe(false);
    expect(s.scrollOffset).toBe(0);
  });

  it("SCROLL clamps at 0", () => {
    let s = fresh();
    s = tuiReducer(s, { type: "SCROLL", delta: -5 });
    expect(s.scrollOffset).toBe(0);

    s = tuiReducer(s, { type: "SCROLL", delta: 10 });
    expect(s.scrollOffset).toBe(10);

    s = tuiReducer(s, { type: "SCROLL", delta: -3 });
    expect(s.scrollOffset).toBe(7);
  });

  it("PUSH_INPUT_HISTORY appends and resets historyIndex", () => {
    let s = { ...fresh(), historyIndex: 2 };
    s = tuiReducer(s, { type: "PUSH_INPUT_HISTORY", text: "cmd1" });
    expect(s.inputHistory).toEqual(["cmd1"]);
    expect(s.historyIndex).toBe(-1);
  });

  it("LOAD_SESSION replaces messages and switches to chat view", () => {
    const msgs = [
      { id: "l1", role: "user" as const, text: "hi", timestamp: 100 },
      { id: "l2", role: "assistant" as const, text: "hello", timestamp: 200 },
    ];
    const s = tuiReducer(
      { ...fresh(), viewMode: "sessions", streamingText: "partial", isStreaming: true, scrollOffset: 5 },
      { type: "LOAD_SESSION", sessionKey: "new-key", messages: msgs },
    );
    expect(s.sessionKey).toBe("new-key");
    expect(s.messages).toEqual(msgs);
    expect(s.viewMode).toBe("chat");
    expect(s.streamingText).toBe("");
    expect(s.isStreaming).toBe(false);
    expect(s.scrollOffset).toBe(0);
  });
});
