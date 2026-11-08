import { describe, expect, it } from "vitest";
import type { TerminalPaneSummary } from "../terminal/terminalPanesStore.js";
import { buildSendTargets, quotePathForShell } from "./sendTargets.js";

const pane = (id: string, title: string, minimized = false): TerminalPaneSummary => ({ id, title, minimized, docked: false });

describe("buildSendTargets", () => {
  const panes = [pane("a", "claude"), pane("b", "shell"), pane("c", "worker", true)];

  it("lists the chat first, then every open terminal", () => {
    const t = buildSendTargets(panes, "a", "terminal");
    expect(t.map((x) => x.label)).toEqual(["Chat", "claude", "shell", "worker (minimizada)"]);
  });

  it("marks the focused pane while the Terminal tab is showing", () => {
    const t = buildSendTargets(panes, "b", "terminal");
    expect(t.filter((x) => x.focused).map((x) => x.label)).toEqual(["shell"]);
  });

  it("marks the chat, and no terminal, while the Chat tab is showing", () => {
    const t = buildSendTargets(panes, "b", "chat");
    expect(t.filter((x) => x.focused).map((x) => x.label)).toEqual(["Chat"]);
  });

  it("marks nothing on any other tab, and still offers the chat when there are no terminals", () => {
    expect(buildSendTargets(panes, "a", "documents").some((x) => x.focused)).toBe(false);
    expect(buildSendTargets([], null, "terminal")).toEqual([{ kind: "chat", label: "Chat", focused: false }]);
  });
});

describe("quotePathForShell", () => {
  it("leaves plain POSIX paths alone", () => {
    expect(quotePathForShell("/Users/me/proj/src/a.ts", false)).toBe("/Users/me/proj/src/a.ts");
  });

  it("single-quotes paths with spaces or shell characters, closing and reopening around a quote", () => {
    expect(quotePathForShell("/Users/me/My Docs/a.md", false)).toBe("'/Users/me/My Docs/a.md'");
    expect(quotePathForShell("/p/$HOME/a;b", false)).toBe("'/p/$HOME/a;b'");
    expect(quotePathForShell("/p/it's.txt", false)).toBe("'/p/it'\\''s.txt'");
  });

  it("double-quotes Windows paths only when they need it", () => {
    expect(quotePathForShell("C:\\Users\\me\\a.txt", true)).toBe("C:\\Users\\me\\a.txt");
    expect(quotePathForShell("C:\\Users\\me\\My Docs\\a.txt", true)).toBe('"C:\\Users\\me\\My Docs\\a.txt"');
  });
});
