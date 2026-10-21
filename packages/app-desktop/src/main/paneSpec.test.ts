import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { composeSpecContext, composeSpecMessage, resolveSpecFile, SpecPathError } from "./paneSpec.js";

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ygg-spec-"));
  await mkdir(join(dir, "notes", "features"), { recursive: true });
  await writeFile(join(dir, "notes", "features", "x.md"), "# x\n");
  await writeFile(join(dir, "secret.md"), "outside notes");
  return dir;
}

describe("resolveSpecFile", () => {
  it("accepts the project-relative and notes-relative forms (and backslashes)", async () => {
    const dir = await project();
    const expected = resolve(dir, "notes", "features", "x.md");
    for (const input of ["notes/features/x.md", "features/x.md", "./notes/features/x.md", "notes\\features\\x.md"]) {
      const res = await resolveSpecFile(dir, input);
      expect(res.absolutePath).toBe(expected);
      expect(res.projectRelativePath).toBe("notes/features/x.md");
    }
  });

  it("rejects anything that escapes notes/", async () => {
    const dir = await project();
    for (const input of ["../secret.md", "notes/../secret.md", "notes/../../etc/passwd", "/etc/passwd", "C:\\Windows\\win.ini"]) {
      await expect(resolveSpecFile(dir, input)).rejects.toBeInstanceOf(SpecPathError);
    }
  });

  it("rejects empty, bare-folder and directory paths", async () => {
    const dir = await project();
    for (const input of ["", "   ", "notes", "notes/", "notes/features"]) {
      await expect(resolveSpecFile(dir, input)).rejects.toBeInstanceOf(SpecPathError);
    }
  });

  it("tells the agent to write the doc first when it doesn't exist", async () => {
    const dir = await project();
    await expect(resolveSpecFile(dir, "notes/features/missing.md")).rejects.toThrow(/Write the feature doc first/);
  });
});

describe("composeSpecMessage", () => {
  it("reads the doc by absolute path, then follows the caller's text", () => {
    const msg = composeSpecMessage("/p/notes/features/x.md", "  Do task T2  ");
    expect(msg).toBe("Read the feature doc at /p/notes/features/x.md in full before doing anything else. Do task T2");
  });

  it("falls back to the default instruction without text", () => {
    expect(composeSpecMessage("/p/n.md")).toContain("Do the open tasks assigned to you");
    expect(composeSpecMessage("/p/n.md", "   ")).toContain("append what you did to ## Log");
  });
});

describe("composeSpecContext", () => {
  it("names the doc but does not start work", () => {
    const ctx = composeSpecContext("/p/notes/features/x.md");
    expect(ctx).toContain("/p/notes/features/x.md");
    expect(ctx).toContain("Do not start working yet");
  });
});
