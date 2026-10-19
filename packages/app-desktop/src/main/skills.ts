import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SkillScope = "project" | "user" | "plugin";

export type SkillInfo = {
  name: string;
  description: string;
  scope: SkillScope;
  /** Plugin id (`name@marketplace`) for scope "plugin". */
  plugin?: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
};

/** Claude Code skill names: lowercase letters, digits and hyphens. */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Reads `name` and `description` from a SKILL.md's YAML frontmatter. Handles
 * plain and quoted scalars plus folded/literal block scalars (`>`, `>-`, `|`),
 * which is how most real skills write a long description — skill-adapter's
 * parseSkillMd returns the literal ">" for those, so it isn't reused here.
 */
export function parseSkillFrontmatter(raw: string, fallbackName: string): { name: string; description: string } {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!fm) return { name: fallbackName, description: "" };
  const lines = fm[1]!.split(/\r?\n/);

  const read = (key: string): string => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i === -1) return "";
    const value = lines[i]!.slice(key.length + 1).trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      for (const line of lines.slice(i + 1)) {
        if (line.trim() !== "" && !/^\s/.test(line)) break; // next top-level key
        block.push(line.trim());
      }
      return block.filter(Boolean).join(" ");
    }
    return value.replace(/^(["'])(.*)\1$/, "$2");
  };

  return { name: read("name") || fallbackName, description: read("description") };
}

async function scanSkillsDir(
  dir: string,
  scope: SkillScope,
  plugin?: string,
): Promise<SkillInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const found: SkillInfo[] = [];
  for (const entry of entries) {
    const path = join(dir, entry, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      continue; // not a skill folder (or unreadable)
    }
    const { name, description } = parseSkillFrontmatter(raw, entry);
    found.push({ name, description, scope, ...(plugin ? { plugin } : {}), path });
  }
  return found;
}

type InstalledPlugins = {
  plugins?: Record<string, Array<{ scope?: string; projectPath?: string; installPath?: string }>>;
};

async function installedPluginDirs(homeDir: string, projectPath: string): Promise<Array<{ id: string; dir: string }>> {
  let parsed: InstalledPlugins;
  try {
    parsed = JSON.parse(await readFile(join(homeDir, ".claude", "plugins", "installed_plugins.json"), "utf8")) as InstalledPlugins;
  } catch {
    return [];
  }
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const out: Array<{ id: string; dir: string }> = [];
  for (const [id, installs] of Object.entries(parsed.plugins ?? {})) {
    for (const install of installs) {
      if (!install.installPath) continue;
      // A project-scoped install only applies to its own project.
      if (install.scope === "project" && (!install.projectPath || norm(install.projectPath) !== norm(projectPath))) continue;
      out.push({ id, dir: install.installPath });
    }
  }
  return out;
}

/**
 * Every skill Claude Code would see in this project: the project's own
 * (.claude/skills), the user's (~/.claude/skills) and those shipped by
 * installed plugins (resolved through installed_plugins.json, so stale cached
 * versions aren't listed).
 */
export async function listSkills(projectPath: string, homeDir: string): Promise<SkillInfo[]> {
  const groups = await Promise.all([
    scanSkillsDir(join(projectPath, ".claude", "skills"), "project"),
    scanSkillsDir(join(homeDir, ".claude", "skills"), "user"),
    installedPluginDirs(homeDir, projectPath).then((dirs) =>
      Promise.all(dirs.map((d) => scanSkillsDir(join(d.dir, "skills"), "plugin", d.id))),
    ),
  ]);
  const seen = new Set<string>();
  const all: SkillInfo[] = [];
  for (const skill of [...groups[0], ...groups[1], ...groups[2].flat()]) {
    if (seen.has(skill.path)) continue;
    seen.add(skill.path);
    all.push(skill);
  }
  const order: Record<SkillScope, number> = { project: 0, user: 1, plugin: 2 };
  return all.sort(
    (a, b) => order[a.scope] - order[b.scope] || (a.plugin ?? "").localeCompare(b.plugin ?? "") || a.name.localeCompare(b.name),
  );
}

export class SkillCreateError extends Error {}

/** Creates `<project>/.claude/skills/<name>/SKILL.md` from a starter template; never overwrites. */
export async function createProjectSkill(
  projectPath: string,
  name: string,
  description: string,
): Promise<{ path: string }> {
  if (!SKILL_NAME_RE.test(name)) {
    throw new SkillCreateError("Skill name must be lowercase letters, digits and hyphens (max 64), e.g. code-review.");
  }
  const dir = join(projectPath, ".claude", "skills", name);
  const path = join(dir, "SKILL.md");
  const exists = await stat(path).then(
    () => true,
    () => false,
  );
  if (exists) throw new SkillCreateError(`A skill named "${name}" already exists in this project.`);
  const summary = description.replace(/\s+/g, " ").trim() || "Describe what this skill does and when Claude should use it.";
  await mkdir(dir, { recursive: true });
  await writeFile(
    path,
    `---
name: ${name}
description: >
  ${summary}
---

# ${name}

Write the instructions Claude should follow when this skill applies.
`,
    { encoding: "utf8", flag: "wx" },
  );
  return { path };
}
