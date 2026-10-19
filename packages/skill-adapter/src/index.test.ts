import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextProviderRegistration, SkillCommand, YggdrasilPluginApi } from "@yggdrasil/sdk";
import { adaptClaudeSkill } from "./index.js";

function noop(): void {}

function makeFakeApi(): {
  api: YggdrasilPluginApi;
  providers: ContextProviderRegistration[];
  commands: SkillCommand[];
} {
  const providers: ContextProviderRegistration[] = [];
  const commands: SkillCommand[] = [];
  const api: YggdrasilPluginApi = {
    pluginId: "test",
    config: {},
    globalConfig: {},
    logger: { info: noop, warn: noop, error: noop, debug: noop } as unknown as YggdrasilPluginApi["logger"],
    events: { emit: noop, on: noop, off: noop } as unknown as YggdrasilPluginApi["events"],
    registerHarness: noop,
    registerChannel: noop,
    registerProvider: noop,
    registerTool: noop,
    registerGatewayMethod: noop,
    registerService: noop,
    registerContextProvider(provider) {
      providers.push(provider);
    },
    registerSkillCommand(cmd) {
      commands.push(cmd);
    },
  };
  return { api, providers, commands };
}

describe("adaptClaudeSkill", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "claude-skill-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("registers no context provider or commands for an empty directory", async () => {
    const plugin = await adaptClaudeSkill(root, "empty-plugin");
    const { api, providers, commands } = makeFakeApi();
    await plugin.register(api);
    expect(providers).toHaveLength(0);
    expect(commands).toHaveLength(0);
  });

  it("reads SKILL.md files into a combined context provider", async () => {
    const skillsDir = join(root, "skills", "greeting");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "SKILL.md"),
      `---\nname: greeting\ndescription: greets people\n---\nAlways greet the user warmly.`,
    );

    const plugin = await adaptClaudeSkill(root, "greeting-plugin");
    const { api, providers } = makeFakeApi();
    await plugin.register(api);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.id).toBe("greeting-plugin:instructions");
    const blocks = await providers[0]!.assemble({} as never);
    expect(blocks[0]!.content).toContain("Always greet the user warmly.");
  });

  it("reads commands/*.toml files into skill commands", async () => {
    const commandsDir = join(root, "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, "deploy.toml"),
      `name = "deploy"\ndescription = "deploys the app"\nprompt = "Deploy to production"`,
    );

    const plugin = await adaptClaudeSkill(root, "deploy-plugin");
    const { api, commands } = makeFakeApi();
    await plugin.register(api);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      name: "deploy",
      description: "deploys the app",
      prompt: "Deploy to production",
    });
  });

  it("skips commands with no prompt and skills with no instructions", async () => {
    const skillsDir = join(root, "skills", "empty-skill");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "SKILL.md"), `---\nname: empty\n---\n`);

    const commandsDir = join(root, "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "noop.toml"), `name = "noop"\ndescription = "does nothing"`);

    const plugin = await adaptClaudeSkill(root, "sparse-plugin");
    const { api, providers, commands } = makeFakeApi();
    await plugin.register(api);

    expect(providers).toHaveLength(0);
    expect(commands).toHaveLength(0);
  });
});
