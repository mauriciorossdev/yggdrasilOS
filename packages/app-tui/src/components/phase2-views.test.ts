import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { SessionList } from "./SessionList.js";
import { ToolsList } from "./ToolsList.js";
import { TurnsList } from "./TurnsList.js";
import { projectName } from "./StatusBar.js";

const tick = () => new Promise((r) => setTimeout(r, 80));
const ENTER = "\r";
const ESC = "\u001B";

const sessions = [
  { sessionKey: "tui:default:aaa", title: "Alpha", messageCount: 2, createdAt: 1, updatedAt: 1 },
  { sessionKey: "tui:default:bbb", messageCount: 5, createdAt: 2, updatedAt: 2 },
];

describe("SessionList rename", () => {
  it("renames the selected session with r, typing and enter", async () => {
    const onRename = vi.fn();
    const { stdin, lastFrame } = render(React.createElement(SessionList, { sessions, onSelect: vi.fn(), onRename, onClose: vi.fn() }));
    await tick();
    stdin.write("r");
    await tick();
    expect(lastFrame()).toContain("enter save");
    stdin.write("!");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(onRename).toHaveBeenCalledWith("tui:default:aaa", "Alpha!");
  });

  it("esc cancels the rename without closing the list", async () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    const { stdin } = render(React.createElement(SessionList, { sessions, onSelect: vi.fn(), onRename, onClose }));
    await tick();
    stdin.write("r");
    await tick();
    stdin.write(ESC);
    await tick();
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not offer rename when no handler is given", () => {
    const { lastFrame } = render(React.createElement(SessionList, { sessions, onSelect: vi.fn(), onClose: vi.fn() }));
    expect(lastFrame()).not.toContain("r rename");
  });
});

describe("ToolsList", () => {
  const tools = Array.from({ length: 30 }, (_, i) => ({
    name: `tool_${String(i).padStart(2, "0")}`,
    description: `does thing ${i}`,
    kind: "builtin",
    riskLevel: (i === 0 ? "destructive" : "safe") as "safe" | "destructive",
    parameters: { properties: { path: {}, mode: {} } },
  }));

  it("windows a long list and shows the selected tool's details", () => {
    const frame = render(React.createElement(ToolsList, { tools, onClose: vi.fn(), pageSize: 5 })).lastFrame() ?? "";
    expect(frame).toContain("tool_00");
    expect(frame).not.toContain("tool_10");
    expect(frame).toContain("25 more");
    expect(frame).toContain("does thing 0");
    expect(frame).toContain("params: path, mode");
  });

  it("closes on esc", async () => {
    const onClose = vi.fn();
    const { stdin } = render(React.createElement(ToolsList, { tools, onClose }));
    await tick();
    stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("TurnsList", () => {
  it("lists newest first and marks the current session", () => {
    const turns = [
      { sessionKey: "tui:default:old-one", classification: "ok", durationMs: 10, timestamp: 1 },
      { sessionKey: "tui:default:mine", classification: "cancelled", durationMs: 20, timestamp: 2 },
    ];
    const frame = render(React.createElement(TurnsList, { turns, currentSessionKey: "tui:default:mine", onClose: vi.fn() })).lastFrame() ?? "";
    expect(frame.indexOf("this session")).toBeLessThan(frame.indexOf("old-one"));
    expect(frame).toContain("cancelled");
  });

  it("says so when there is nothing yet", () => {
    const frame = render(React.createElement(TurnsList, { turns: [], currentSessionKey: null, onClose: vi.fn() })).lastFrame() ?? "";
    expect(frame).toContain("No turns recorded");
  });
});

describe("projectName", () => {
  it("takes the last path segment on any platform", () => {
    expect(projectName("/Users/me/code/my-app")).toBe("my-app");
    expect(projectName("C:\\Users\\me\\my-app\\")).toBe("my-app");
    expect(projectName(null)).toBeNull();
    expect(projectName("")).toBeNull();
  });
});
