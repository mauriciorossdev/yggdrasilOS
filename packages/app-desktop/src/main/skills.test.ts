import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectSkill, listSkills, parseSkillFrontmatter, SkillCreateError } from "./skills.js";

describe("parseSkillFrontmatter", () => {
  it("reads plain and quoted scalars", () => {
    expect(parseSkillFrontmatter("---\nname: a-b\ndescription: Does a thing\n---\nbody", "x")).toEqual({
      name: "a-b",
      description: "Does a thing",
    });
    expect(parseSkillFrontmatter(`---\nname: "q"\ndescription: 'quoted: yes'\n---\n`, "x")).toEqual({
      name: "q",
      description: "quoted: yes",
    });
  });

  it("joins folded and literal block scalars instead of returning the indicator", () => {
    const folded = "---\nname: use-railway\ndescription: >\n  Operate Railway\n  infrastructure.\n\n  More.\nlicense: MIT\n---\n";
    expect(parseSkillFrontmatter(folded, "x").description).toBe("Operate Railway infrastructure. More.");
    expect(parseSkillFrontmatter("---\ndescription: >-\n  strip me\n---\n", "x").description).toBe("strip me");
    expect(parseSkillFrontmatter("---\ndescription: |\n  line one\n  line two\n---\n", "x").description).toBe(
      "line one line two",
    );
  });

  it("handles CRLF and falls back to the folder name", () => {
    expect(parseSkillFrontmatter("---\r\nname: crlf\r\ndescription: ok\r\n---\r\n", "x")).toEqual({
      name: "crlf",
      description: "ok",
    });
    expect(parseSkillFrontmatter("no frontmatter here", "fallback")).toEqual({ name: "fallback", description: "" });
    expect(parseSkillFrontmatter("---\ndescription: only\n---\n", "fallback").name).toBe("fallback");
  });
});

async function skill(root: string, ...segments: string[]): Promise<void> {
  const dir = join(root, ...segments);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${segments.at(-1)}\ndescription: d\n---\n`);
}

describe("listSkills", () => {
  it("finds project, user and installed-plugin skills, ignoring non-skill folders and stale versions", async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-"));
    const project = await mkdtemp(join(tmpdir(), "ygg-proj-"));
    await skill(project, ".claude", "skills", "p-skill");
    await skill(home, ".claude", "skills", "u-skill");
    await mkdir(join(home, ".claude", "skills", "not-a-skill"), { recursive: true });
    const live = join(home, ".claude", "plugins", "cache", "m", "plug", "2");
    await skill(live, "skills", "plug-skill");
    await skill(join(home, ".claude", "plugins", "cache", "m", "plug", "1"), "skills", "stale-skill");
    const elsewhere = join(home, ".claude", "plugins", "cache", "m", "other", "1");
    await skill(elsewhere, "skills", "other-project-skill");
    await mkdir(join(home, ".claude", "plugins"), { recursive: true });
    await writeFile(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "plug@m": [{ scope: "user", installPath: live }],
          "other@m": [{ scope: "project", projectPath: "C:\\somewhere\\else", installPath: elsewhere }],
        },
      }),
    );

    const skills = await listSkills(project, home);
    expect(skills.map((s) => [s.scope, s.name, s.plugin])).toEqual([
      ["project", "p-skill", undefined],
      ["user", "u-skill", undefined],
      ["plugin", "plug-skill", "plug@m"],
    ]);
    expect(skills[0]!.path.endsWith("SKILL.md")).toBe(true);
  });

  it("returns an empty list when nothing is installed", async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-"));
    const project = await mkdtemp(join(tmpdir(), "ygg-proj-"));
    expect(await listSkills(project, home)).toEqual([]);
  });
});

describe("createProjectSkill", () => {
  it("writes a SKILL.md that listSkills can read back", async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-"));
    const project = await mkdtemp(join(tmpdir(), "ygg-proj-"));
    const { path } = await createProjectSkill(project, "code-review", "Reviews diffs\nfor risk.");
    expect(await readFile(path, "utf8")).toContain("# code-review");
    expect(await listSkills(project, home)).toMatchObject([
      { name: "code-review", description: "Reviews diffs for risk.", scope: "project" },
    ]);
  });

  it("rejects bad names (path traversal included) and never overwrites", async () => {
    const project = await mkdtemp(join(tmpdir(), "ygg-proj-"));
    for (const bad of ["", "Has Caps", "../escape", "a/b", "-lead", "x".repeat(65)]) {
      await expect(createProjectSkill(project, bad, "")).rejects.toBeInstanceOf(SkillCreateError);
    }
    await createProjectSkill(project, "dup", "");
    await expect(createProjectSkill(project, "dup", "")).rejects.toThrow(/already exists/);
  });
});
