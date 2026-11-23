import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  seedDocumentsGuidance,
  seedPaneControlGuidance,
  trustYggdrasilMcpServer,
  writeYggdrasilMcpConfig,
} from "./mcpConfig.js";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ygg-mcp-"));
}

const read = async (dir: string) =>
  JSON.parse(await readFile(join(dir, ".claude", "settings.local.json"), "utf8")) as Record<string, unknown>;

describe("feature-doc handoff guidance", () => {
  it("panes guide teaches handing work off by path, and seeding is idempotent", async () => {
    const dir = await project();
    await seedPaneControlGuidance(dir);
    await seedPaneControlGuidance(dir);
    const guide = await readFile(join(dir, ".claude", "yggdrasil-panes-guide.md"), "utf8");
    expect(guide).toContain("Handing off work by reference");
    expect(guide).toContain("notes/features/");
    expect(guide).toContain("specPath");
    expect(guide).toContain("show_pane");
    expect(guide).toContain("pass `specPath` to `create_pane`");
    expect(guide).toContain("worktree: true");
    expect(guide).toContain(".yggdrasil/worktrees/<name>");
    const claudeMd = await readFile(join(dir, "CLAUDE.md"), "utf8");
    expect(claudeMd.match(/yggdrasil-panes-guide\.md/g)?.length).toBe(2); // description line + @import, once
  });

  it("documents guide defines the feature doc layout with real code fences", async () => {
    const dir = await project();
    await seedDocumentsGuidance(dir);
    const guide = await readFile(join(dir, ".claude", "yggdrasil-documents-guide.md"), "utf8");
    expect(guide).toContain("## Feature docs");
    for (const heading of ["## Specs", "## Tasks", "## Log"]) expect(guide).toContain(heading);
    expect(guide).toContain("features/<slug>.md"); // documents-tool path convention (notes-relative)
    expect(guide).toContain("notes/notes/features/");
    expect(guide).toMatch(/^```$/m);
    expect(guide).not.toContain("\\`");
  });
});

describe("trustYggdrasilMcpServer → .claude/settings.local.json", () => {
  it("creates the file for a brand-new project", async () => {
    const dir = await project();
    await trustYggdrasilMcpServer(dir);
    expect((await read(dir)).enabledMcpjsonServers).toEqual(["yggdrasil"]);
  });

  it("adds to an existing list without touching other keys or duplicating", async () => {
    const dir = await project();
    await mkdir(join(dir, ".claude"));
    await writeFile(
      join(dir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, enabledMcpjsonServers: ["mine"] }),
    );
    await trustYggdrasilMcpServer(dir);
    await trustYggdrasilMcpServer(dir);
    const settings = await read(dir);
    expect(settings.enabledMcpjsonServers).toEqual(["mine", "yggdrasil"]);
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
  });

  it("drops the migrated legacy ids from the enabled list, keeping everything else", async () => {
    const dir = await project();
    await mkdir(join(dir, ".claude"));
    await writeFile(
      join(dir, ".claude", "settings.local.json"),
      JSON.stringify({ enabledMcpjsonServers: ["panes", "documents", "mine", "memory"] }),
    );
    await trustYggdrasilMcpServer(dir, ["panes", "documents", "memory"]);
    expect((await read(dir)).enabledMcpjsonServers).toEqual(["mine", "yggdrasil"]);
  });

  it("removes the server from disabledMcpjsonServers", async () => {
    const dir = await project();
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "settings.local.json"), JSON.stringify({ disabledMcpjsonServers: ["yggdrasil", "x"] }));
    await trustYggdrasilMcpServer(dir);
    const settings = await read(dir);
    expect(settings.enabledMcpjsonServers).toEqual(["yggdrasil"]);
    expect(settings.disabledMcpjsonServers).toEqual(["x"]);
  });

  it("leaves an unparseable settings file alone", async () => {
    const dir = await project();
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "settings.local.json"), "{ not json");
    await trustYggdrasilMcpServer(dir);
    expect(await readFile(join(dir, ".claude", "settings.local.json"), "utf8")).toBe("{ not json");
  });
});

describe("writeYggdrasilMcpConfig → .mcp.json", () => {
  const readMcp = async (dir: string) =>
    JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8")) as { mcpServers: Record<string, { args?: string[]; env?: Record<string, string> }> };

  it("writes a single yggdrasil server carrying every env the five families need", async () => {
    const dir = await project();
    const { removedLegacy } = await writeYggdrasilMcpConfig(dir, "/app/yggdrasilMcpShim.js", "http://127.0.0.1:1", "tok", "ws://127.0.0.1:2");
    const { mcpServers } = await readMcp(dir);
    expect(removedLegacy).toEqual([]);
    expect(Object.keys(mcpServers)).toEqual(["yggdrasil"]);
    expect(mcpServers.yggdrasil.args).toEqual(["/app/yggdrasilMcpShim.js"]);
    expect(mcpServers.yggdrasil.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      PANE_CONTROL_URL: "http://127.0.0.1:1",
      PANE_CONTROL_TOKEN: "tok",
      YGGDRASIL_PROJECT_ROOT: dir,
      WORKFLOWS_GATEWAY_URL: "ws://127.0.0.1:2",
    });
  });

  it("migrates the five legacy entries away but keeps hand-authored servers, even ones named like a legacy id", async () => {
    const dir = await project();
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          panes: { command: "node", args: ["/old/dist/main/paneControlMcpShim.js"] },
          documents: { command: "node", args: ["/old/dist/main/documentsControlMcpShim.js"] },
          plugins: { command: "node", args: ["/old/dist/main/pluginsControlMcpShim.js"] },
          memory: { command: "my-own-memory-server", args: ["--serve"] },
          workflows: { command: "node", args: ["C:\\old\\dist\\main\\workflowsMcpShim.js"] },
          other: { command: "x" },
        },
      }),
    );
    const { removedLegacy, staleApprovals } = await writeYggdrasilMcpConfig(dir, "/app/yggdrasilMcpShim.js", "u", "t", "g");
    expect(removedLegacy.sort()).toEqual(["documents", "panes", "plugins", "workflows"]);
    // The hand-authored "memory" is still defined, so it isn't stale.
    expect(staleApprovals.sort()).toEqual(["documents", "panes", "plugins", "workflows"]);
    expect(Object.keys((await readMcp(dir)).mcpServers).sort()).toEqual(["memory", "other", "yggdrasil"]);
  });

  it("drops approvals an earlier migration left behind, on every later open", async () => {
    const dir = await project();
    // Already migrated: .mcp.json only has yggdrasil, but the old names are still approved.
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { yggdrasil: { command: "x", args: ["/a/yggdrasilMcpShim.js"] } } }));
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.local.json"),
      JSON.stringify({ enabledMcpjsonServers: ["yggdrasil", "panes", "documents", "plugins", "memory", "workflows", "mine"], other: 1 }),
    );
    const { removedLegacy, staleApprovals } = await writeYggdrasilMcpConfig(dir, "/app/yggdrasilMcpShim.js", "u", "t", "g");
    expect(removedLegacy).toEqual([]);
    await trustYggdrasilMcpServer(dir, staleApprovals);
    const local = JSON.parse(await readFile(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(local.enabledMcpjsonServers).toEqual(["yggdrasil", "mine"]);
    expect(local.other).toBe(1);
  });
});
