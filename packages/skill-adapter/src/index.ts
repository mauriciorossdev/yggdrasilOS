import { readFile, readdir } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { definePlugin, type YggdrasilPlugin } from "@yggdrasil/sdk";
import { parseSkillMd, parseCommandToml } from "./parse.js";

export type { SkillMd, SkillCommand } from "./parse.js";
export { parseSkillMd, parseCommandToml };

async function tryReadDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Adapt a Claude Code skill directory into a Yggdrasil plugin.
 * Reads skills/*.md → context providers, commands/*.toml → skill commands.
 * Hooks and MCP servers are ignored (no Yggdrasil equivalent).
 */
export async function adaptClaudeSkill(
  skillDir: string,
  pluginId: string,
): Promise<YggdrasilPlugin> {
  // Collect all SKILL.md files
  const skillsDir = join(skillDir, "skills");
  const skillDirs = await tryReadDir(skillsDir);

  type SkillEntry = { name: string; instructions: string };
  const skills: SkillEntry[] = [];

  for (const entry of skillDirs) {
    const mdPath = join(skillsDir, entry, "SKILL.md");
    const raw = await tryReadFile(mdPath);
    if (!raw) continue;
    const parsed = parseSkillMd(raw, entry);
    if (parsed.instructions) {
      skills.push({ name: parsed.name, instructions: parsed.instructions });
    }
  }

  // Collect all commands/*.toml files
  const commandsDir = join(skillDir, "commands");
  const commandFiles = (await tryReadDir(commandsDir)).filter((f) => f.endsWith(".toml"));

  type CmdEntry = { name: string; description: string; prompt: string };
  const commands: CmdEntry[] = [];

  for (const file of commandFiles) {
    const raw = await tryReadFile(join(commandsDir, file));
    if (!raw) continue;
    const fallbackName = basename(file, extname(file));
    const parsed = parseCommandToml(raw, fallbackName);
    if (parsed.prompt) {
      commands.push({ name: parsed.name || fallbackName, description: parsed.description, prompt: parsed.prompt });
    }
  }

  // Build combined instructions from all skills
  const combinedInstructions = skills
    .map((s) => s.instructions)
    .join("\n\n---\n\n");

  return definePlugin({
    id: pluginId,
    name: pluginId,
    version: "0.1.0",
    register(api) {
      if (combinedInstructions.trim()) {
        api.registerContextProvider({
          id: `${pluginId}:instructions`,
          label: `${pluginId} skill instructions`,
          priority: 5,
          assemble() {
            return Promise.resolve([
              {
                role: "system" as const,
                content: combinedInstructions.trim(),
                source: pluginId,
                priority: 5,
                cacheable: true,
                ttlMs: 300_000,
              },
            ]);
          },
        });
      }

      for (const cmd of commands) {
        api.registerSkillCommand({
          name: cmd.name,
          description: cmd.description,
          prompt: cmd.prompt,
        });
      }

      api.logger.info("registered claude-compat skill", {
        id: pluginId,
        skills: skills.map((s) => s.name),
        commands: commands.map((c) => c.name),
      });
    },
  });
}
