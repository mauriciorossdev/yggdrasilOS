import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  seedDocumentsGuidance,
  seedPaneControlGuidance,
  trustPaneControlMcpServer,
  trustWorkflowsMcpServer,
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

describe("trustMcpServer → .claude/settings.local.json", () => {
  it("creates the file for a brand-new project", async () => {
    const dir = await project();
    await trustPaneControlMcpServer(dir);
    expect((await read(dir)).enabledMcpjsonServers).toEqual(["panes"]);
  });

  it("adds to an existing list without touching other keys or duplicating", async () => {
    const dir = await project();
    await mkdir(join(dir, ".claude"));
    await writeFile(
      join(dir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, enabledMcpjsonServers: ["documents"] }),
    );
    await trustPaneControlMcpServer(dir);
    await trustPaneControlMcpServer(dir);
    await trustWorkflowsMcpServer(dir);
    const settings = await read(dir);
    expect(settings.enabledMcpjsonServers).toEqual(["documents", "panes", "workflows"]);
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
  });

  it("removes the server from disabledMcpjsonServers", async () => {
    const dir = await project();
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "settings.local.json"), JSON.stringify({ disabledMcpjsonServers: ["panes", "x"] }));
    await trustPaneControlMcpServer(dir);
    const settings = await read(dir);
    expect(settings.enabledMcpjsonServers).toEqual(["panes"]);
    expect(settings.disabledMcpjsonServers).toEqual(["x"]);
  });

  it("leaves an unparseable settings file alone", async () => {
    const dir = await project();
    await mkdir(join(dir, ".claude"));
    await writeFile(join(dir, ".claude", "settings.local.json"), "{ not json");
    await trustPaneControlMcpServer(dir);
    expect(await readFile(join(dir, ".claude", "settings.local.json"), "utf8")).toBe("{ not json");
  });
});
