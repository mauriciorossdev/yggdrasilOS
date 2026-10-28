import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceBroker,
  markRead,
  markWrite,
  resolvePane,
  sanitizeWorkspaceState,
  trustKey,
  WorkspaceError,
  type AskAnswer,
  type AskRequest,
  type TargetPaneApi,
} from "./workspace.js";

describe("sanitizeWorkspaceState", () => {
  it("keeps valid links and trust, drops junk and self-links", () => {
    const state = sanitizeWorkspaceState({
      links: { a: ["b", "a", 7, "b"], c: "nope", d: [] },
      trust: ["a>b:read", "bad", "a>b:read", "a>b:delete"],
      audit: [{ at: 1, from: "A", to: "B", pane: "p", action: "read", via: "ask" }, { nope: true }],
    });
    expect(state.links).toEqual({ a: ["b"] });
    expect(state.trust).toEqual(["a>b:read"]);
    expect(state.audit).toHaveLength(1);
  });

  it("returns an empty state for garbage", () => {
    expect(sanitizeWorkspaceState(null)).toEqual({ links: {}, trust: [], audit: [] });
  });
});

describe("resolvePane", () => {
  const panes = [
    { id: "p1", title: "Technical Artist" },
    { id: "p2", title: "Reviewer" },
    { id: "p3", title: "reviewer" },
  ];

  it("matches by id, then by case-insensitive title", () => {
    expect(resolvePane(panes, "p1").id).toBe("p1");
    expect(resolvePane(panes, "technical artist").id).toBe("p1");
  });

  it("refuses to guess between duplicate titles", () => {
    expect(() => resolvePane(panes, "reviewer")).toThrow(/more than one pane/);
  });

  it("404s on a missing pane", () => {
    expect(() => resolvePane(panes, "ghost")).toThrow(WorkspaceError);
  });
});

describe("marking", () => {
  it("labels writes with their origin and reads as untrusted data", () => {
    expect(markWrite("lib", "Dev", "hola")).toContain('project lib, pane "Dev"');
    expect(markWrite("lib", undefined, "hola")).toContain("project lib —");
    expect(markRead("app", "Artist", "salida")).toContain("untrusted data");
  });
});

describe("workspace broker", () => {
  let dir: string;
  const projects = [
    { id: "lib", name: "lib" },
    { id: "app", name: "app" },
  ];
  let written: Array<{ id: string; text: string }>;
  let answer: AskAnswer;
  let ask: ReturnType<typeof vi.fn<(r: AskRequest) => Promise<AskAnswer>>>;
  let notify: ReturnType<typeof vi.fn<Parameters<typeof createWorkspaceBroker>[0]["notify"]>>;
  let open: Set<string>;
  let clock: number;

  const appApi: TargetPaneApi = {
    listPanes: async () => ({ panes: [{ id: "p1", title: "Artist" }] }),
    readPane: (id) => (id === "p1" ? "hallazgo X" : undefined),
    writePane: async (id, text) => {
      written.push({ id, text });
    },
  };

  async function broker() {
    return createWorkspaceBroker({
      userDataDir: dir,
      listProjects: async () => projects,
      paneApi: (id) => (id === "app" && open.has(id) ? appApi : undefined),
      ask,
      notify,
      now: () => clock,
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ygg-workspace-"));
    written = [];
    answer = { allow: true, trust: false };
    ask = vi.fn(async () => answer);
    notify = vi.fn();
    open = new Set(["app"]);
    clock = 1_000_000;
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("refuses everything until the projects are linked", async () => {
    const b = await broker();
    await expect(b.readPane("lib", "app", "Artist")).rejects.toMatchObject({ status: 403 });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks on every read until the user trusts the link", async () => {
    const b = await broker();
    await b.setLink("lib", "app", true);

    const first = await b.readPane("lib", "app", "Artist");
    expect(first).toContain("hallazgo X");
    expect(ask).toHaveBeenCalledTimes(1);

    answer = { allow: true, trust: true };
    await b.readPane("lib", "app", "Artist");
    expect(ask).toHaveBeenCalledTimes(2);
    expect(notify).not.toHaveBeenCalled();

    await b.readPane("lib", "app", "Artist");
    expect(ask).toHaveBeenCalledTimes(2); // trusted now: no prompt
    expect(notify).toHaveBeenCalledWith("app", { fromName: "lib", action: "read", paneTitle: "Artist" });
  });

  it("keeps read and write trust separate", async () => {
    const b = await broker();
    await b.setLink("lib", "app", true);
    answer = { allow: true, trust: true };
    await b.readPane("lib", "app", "Artist");
    answer = { allow: true, trust: false };
    await b.writePane("lib", "app", "Artist", "revisa esto", "Dev");
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1]![0].action).toBe("write");
    expect(written[0]!.text).toContain("revisa esto");
    expect(written[0]!.text).toContain("Message from project lib");
  });

  it("types nothing and records a denial when the user says no", async () => {
    const b = await broker();
    await b.setLink("lib", "app", true);
    answer = { allow: false, trust: true };
    await expect(b.writePane("lib", "app", "Artist", "hola")).rejects.toMatchObject({ status: 403 });
    expect(written).toEqual([]);
    expect(b.getState().trust).toEqual([]); // a denial never stores trust
    expect(b.getState().audit.at(-1)).toMatchObject({ via: "denied", action: "write" });
  });

  it("says plainly when the target window is closed", async () => {
    const b = await broker();
    await b.setLink("lib", "app", true);
    open.delete("app");
    await expect(b.readPane("lib", "app", "Artist")).rejects.toThrow(/not open/);
  });

  it("rate-limits writes between two projects", async () => {
    const b = await broker();
    await b.setLink("lib", "app", true);
    answer = { allow: true, trust: true };
    for (let i = 0; i < 10; i++) await b.writePane("lib", "app", "Artist", `m${i}`);
    await expect(b.writePane("lib", "app", "Artist", "m10")).rejects.toMatchObject({ status: 429 });
    clock += 61_000;
    await expect(b.writePane("lib", "app", "Artist", "m11")).resolves.toBeUndefined();
  });

  it("unlinking drops the trust that depended on the link", async () => {
    const b = await broker();
    await b.setLink("lib", "app", true);
    answer = { allow: true, trust: true };
    await b.readPane("lib", "app", "Artist");
    expect(b.getState().trust).toContain(trustKey("lib", "app", "read"));
    await b.setLink("lib", "app", false);
    expect(b.getState().trust).toEqual([]);
  });

  it("persists links and trust across restarts", async () => {
    const b = await broker();
    await b.setLink("lib", "app", true);
    answer = { allow: true, trust: true };
    await b.readPane("lib", "app", "Artist");
    const again = await broker();
    expect(again.getState().links).toEqual({ lib: ["app"] });
    expect(again.getState().trust).toEqual(["lib>app:read"]);
  });

  it("revokes a trust", async () => {
    const b = await broker();
    await b.setLink("lib", "app", true);
    answer = { allow: true, trust: true };
    await b.readPane("lib", "app", "Artist");
    await b.revokeTrust("lib>app:read");
    answer = { allow: true, trust: false };
    await b.readPane("lib", "app", "Artist");
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
