import type { Command } from "../components/CommandPalette.js";
import { agentCommands } from "./agent.js";
import { infoCommands } from "./info.js";
import { sessionCommands } from "./session.js";
import type { CommandContext, SkillCommand, SlashCommand } from "./types.js";

export type { CommandContext, SkillCommand, SlashCommand } from "./types.js";

const helpCommand: SlashCommand = {
  name: "help",
  description: "Show this list",
  run(ctx) {
    ctx.dispatch({ type: "ADD_SYSTEM_MESSAGE", text: helpText(ctx.skills) });
  },
};

const exitCommand: SlashCommand = {
  name: "exit",
  aliases: ["quit"],
  description: "Quit TUI",
  run({ client, exit }) {
    client.disconnect();
    exit();
  },
};

/** In the order /help lists them. */
export const SLASH_COMMANDS: SlashCommand[] = [
  ...sessionCommands,
  ...agentCommands,
  ...infoCommands,
  helpCommand,
  exitCommand,
];

export function parseSlash(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/")) return null;
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim());
  if (!match) return null;
  return { name: match[1]!.toLowerCase(), args: match[2]!.trim() };
}

export function findCommand(name: string): SlashCommand | undefined {
  const lower = name.toLowerCase();
  return SLASH_COMMANDS.find((c) => c.name === lower || c.aliases?.includes(lower));
}

export function helpText(skills: SkillCommand[] = []): string {
  const lines = SLASH_COMMANDS.map((c) => `/${c.usage ?? c.name} — ${c.description}`);
  if (skills.length > 0) {
    lines.push("", "Skills:", ...skills.map((s) => `/${s.name} — ${s.description}`));
  }
  return lines.join("\n");
}

/** Skill prompts may carry a {{args}} placeholder for whatever the user typed after the command. */
export function skillPrompt(skill: SkillCommand, args: string): string {
  return skill.prompt.replace(/\{\{args\}\}/g, args).trim();
}

/** Runs a typed "/…" line. Resolves to false when the text isn't a slash command at all. */
export async function runSlash(text: string, ctx: CommandContext): Promise<boolean> {
  const parsed = parseSlash(text);
  if (!parsed) return false;

  const command = findCommand(parsed.name);
  if (command) {
    try {
      await command.run(ctx, parsed.args);
    } catch (err) {
      ctx.dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `✗ /${command.name} failed: ${err instanceof Error ? err.message : String(err)}` });
    }
    return true;
  }

  const skill = ctx.skills.find((s) => s.name.toLowerCase() === parsed.name);
  if (skill) {
    ctx.sendMessage(skillPrompt(skill, parsed.args));
    return true;
  }

  ctx.dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `Unknown command /${parsed.name}. Type /help for the list.` });
  return true;
}

/** Entries for the command palette and the slash autocomplete: the registry, one switch per agent, and the skills. */
export function buildPaletteCommands(ctx: CommandContext): Command[] {
  return [
    ...SLASH_COMMANDS.filter((c) => !c.noPalette).map((c) => ({
      name: c.name,
      description: c.description,
      action: () => void runSlash(`/${c.name}`, ctx),
    })),
    ...ctx.state.agents.map((a) => ({
      name: `agent ${a.id}`,
      description: `Switch to ${a.id} (${a.provider}/${a.model})`,
      action: () => ctx.dispatch({ type: "SET_ACTIVE_AGENT", agentId: a.id }),
    })),
    ...ctx.skills.map((s) => ({
      name: s.name,
      description: s.description,
      action: () => ctx.sendMessage(skillPrompt(s, "")),
    })),
  ];
}
