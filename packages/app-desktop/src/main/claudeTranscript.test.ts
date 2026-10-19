import { describe, it, expect } from "vitest";
import { claudeProjectSlug, parseClaudeTranscript } from "./claudeTranscript.js";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe("claudeProjectSlug", () => {
  it("replaces every non-alphanumeric character with a dash", () => {
    expect(claudeProjectSlug("/Users/dev/projects/harness_pp")).toBe(
      "-Users-dev-projects-harness-pp",
    );
  });
});

describe("parseClaudeTranscript", () => {
  it("extracts a plain user message and an assistant text block", () => {
    const raw = [
      line({ type: "user", timestamp: "t1", message: { role: "user", content: "hi" } }),
      line({
        type: "assistant",
        timestamp: "t2",
        message: { role: "assistant", content: [{ type: "text", text: "hello there" }] },
      }),
    ].join("\n");

    expect(parseClaudeTranscript(raw)).toEqual([
      { kind: "user", text: "hi", timestamp: "t1" },
      { kind: "assistant_text", text: "hello there", timestamp: "t2" },
    ]);
  });

  it("flattens a mixed thinking + tool_use + text assistant turn, in order", () => {
    const raw = line({
      type: "assistant",
      timestamp: "t1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me check the file" },
          { type: "tool_use", id: "tool_1", name: "Read", input: { file_path: "/tmp/x" } },
          { type: "text", text: "done" },
        ],
      },
    });

    expect(parseClaudeTranscript(raw)).toEqual([
      { kind: "thinking", text: "let me check the file", timestamp: "t1" },
      { kind: "tool_use", toolId: "tool_1", name: "Read", input: { file_path: "/tmp/x" }, timestamp: "t1" },
      { kind: "assistant_text", text: "done", timestamp: "t1" },
    ]);
  });

  it("handles tool_result content as a plain string", () => {
    const raw = line({
      type: "user",
      timestamp: "t1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool_1", content: "file contents here" }],
      },
    });

    expect(parseClaudeTranscript(raw)).toEqual([
      { kind: "tool_result", toolUseId: "tool_1", text: "file contents here", isError: false, timestamp: "t1" },
    ]);
  });

  it("handles tool_result content as an array of text blocks, and a reported error", () => {
    const raw = line({
      type: "user",
      timestamp: "t1",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_2",
            is_error: true,
            content: [{ type: "text", text: "boom" }],
          },
        ],
      },
    });

    expect(parseClaudeTranscript(raw)).toEqual([
      { kind: "tool_result", toolUseId: "tool_2", text: "boom", isError: true, timestamp: "t1" },
    ]);
  });

  it("skips isMeta and isSidechain user lines", () => {
    const raw = [
      line({
        type: "user",
        timestamp: "t1",
        isMeta: true,
        message: { role: "user", content: "<local-command-caveat>...</local-command-caveat>" },
      }),
      line({
        type: "user",
        timestamp: "t2",
        isSidechain: true,
        message: { role: "user", content: "subagent chatter" },
      }),
      line({ type: "user", timestamp: "t3", message: { role: "user", content: "real message" } }),
    ].join("\n");

    expect(parseClaudeTranscript(raw)).toEqual([{ kind: "user", text: "real message", timestamp: "t3" }]);
  });

  it("ignores unrecognized line types, blank lines, and malformed JSON", () => {
    const raw = [
      line({ type: "file-history-snapshot", timestamp: "t1" }),
      line({ type: "summary", timestamp: "t2" }),
      "",
      "{not valid json",
      line({ type: "user", timestamp: "t3", message: { role: "user", content: "still works" } }),
    ].join("\n");

    expect(parseClaudeTranscript(raw)).toEqual([{ kind: "user", text: "still works", timestamp: "t3" }]);
  });

  it("omits empty thinking blocks (redacted extended-thinking with only a signature)", () => {
    const raw = line({
      type: "assistant",
      timestamp: "t1",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "ok" }] },
    });

    expect(parseClaudeTranscript(raw)).toEqual([{ kind: "assistant_text", text: "ok", timestamp: "t1" }]);
  });
});
