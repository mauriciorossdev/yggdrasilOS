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
    expect(sanitizeWorkspaceState(null)).toEqual({ links: {}, trust: [], audit: [], layout: {}, zones: [] });
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
  let notify: ReturnType<typeof vi.fn<(projectId: string, notice: { fromName: string; action: string; paneTitle: string }) => void>>;
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
  describe("Workspaces canvas", () => {
    it("connect links both directions without granting trust, so reads still ask", async () => {
      const b = await broker();
      await b.connect("lib", "app");
      const g = await b.graph();
      expect(g.links).toEqual({ lib: ["app"], app: ["lib"] });
      expect(g.trust).toEqual([]);
      await b.readPane("lib", "app", "Artist");
      expect(ask).toHaveBeenCalledTimes(1);
    });

    it("setTrust grants per direction + action, and lets that action through without asking", async () => {
      const b = await broker();
      await b.connect("lib", "app");
      await b.setTrust("lib", "app", "read", true);
      await b.readPane("lib", "app", "Artist");
      expect(ask).not.toHaveBeenCalled();
      expect((await b.graph()).trust).toEqual([trustKey("lib", "app", "read")]);
      await b.setTrust("lib", "app", "read", false);
      expect((await b.graph()).trust).toEqual([]);
    });

    it("setTrust refuses to grant without the link in that direction", async () => {
      const b = await broker();
      await b.setLink("app", "lib", true);
      await expect(b.setTrust("lib", "app", "write", true)).rejects.toMatchObject({ status: 409 });
    });

    it("disconnect removes both directions and every trust between the two", async () => {
      const b = await broker();
      await b.connect("lib", "app");
      await b.setTrust("lib", "app", "write", true);
      await b.setTrust("app", "lib", "read", true);
      await b.disconnect("app", "lib");
      const g = await b.graph();
      expect(g.links).toEqual({});
      expect(g.trust).toEqual([]);
    });

    it("keeps positions, and survives a reload", async () => {
      const b = await broker();
      await b.setPosition("lib", { x: 10, y: 20 });
      await b.setPosition("app", { x: Number.NaN, y: 1 });
      expect((await (await broker()).graph()).layout).toEqual({ lib: { x: 10, y: 20 } });
    });

    it("forgetProject drops a removed project's links, trust and position", async () => {
      const b = await broker();
      await b.connect("lib", "app");
      await b.setTrust("app", "lib", "read", true);
      await b.setPosition("app", { x: 1, y: 1 });
      await b.forgetProject("app");
      const g = await b.graph();
      expect(g.links).toEqual({});
      expect(g.trust).toEqual([]);
      expect(g.layout).toEqual({});
    });

    it("graph reports which project windows are open and calls onChange after each change", async () => {
      const onChange = vi.fn();
      const b = await createWorkspaceBroker({ userDataDir: dir, listProjects: async () => projects, paneApi: (id) => (open.has(id) ? appApi : undefined), ask, notify, onChange });
      expect((await b.graph()).projects).toEqual([
        { id: "lib", name: "lib", color: null, open: false },
        { id: "app", name: "app", color: null, open: true },
      ]);
      await b.connect("lib", "app");
      await b.setPosition("lib", { x: 0, y: 0 });
      expect(onChange).toHaveBeenCalledTimes(2);
    });
  });
  describe("zones", () => {
    const zone = { id: "z1", name: "Acme", color: "#22c55e", x: 0, y: 0, width: 400, height: 300, locked: true };

    it("saves, updates and deletes zones, surviving a reload", async () => {
      const b = await broker();
      await b.saveZone(zone);
      await b.saveZone({ ...zone, name: "Acme CL", x: 50 });
      expect((await (await broker()).graph()).zones).toEqual([{ ...zone, name: "Acme CL", x: 50 }]);
      await b.deleteZone("z1");
      expect((await b.graph()).zones).toEqual([]);
    });

    it("moves the carried projects in the same save", async () => {
      const b = await broker();
      await b.saveZone(zone, { lib: { x: 10, y: 20 }, app: { x: Number.NaN, y: 0 } });
      expect((await b.graph()).layout).toEqual({ lib: { x: 10, y: 20 } });
    });

    it("rejects malformed zones and fixes bad colors and tiny sizes", async () => {
      const b = await broker();
      await expect(b.saveZone({ ...zone, id: "" })).rejects.toMatchObject({ status: 400 });
      await b.saveZone({ ...zone, color: "red", width: 5 });
      const [saved] = (await b.graph()).zones;
      expect(saved).toMatchObject({ color: "#6b7280", width: 80 });
    });

    it("is locked unless explicitly unlocked (older files have no flag)", async () => {
      const b = await broker();
      const { locked: _omit, ...legacy } = zone;
      await b.saveZone(legacy as typeof zone);
      expect((await b.graph()).zones[0]!.locked).toBe(true);
      await b.saveZone({ ...zone, locked: false });
      expect((await b.graph()).zones[0]!.locked).toBe(false);
    });

    it("are visual only: links and trust are untouched", async () => {
      const b = await broker();
      await b.saveZone(zone);
      const g = await b.graph();
      expect(g.links).toEqual({});
      expect(g.trust).toEqual([]);
    });
  });
});
