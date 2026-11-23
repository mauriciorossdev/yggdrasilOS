import { describe, expect, it } from "vitest";
import {
  attentionHooks,
  claudeLaunchOverrides,
  deniedUserMcp,
  sanitizeUserMcpChoice,
  userMcpServersFrom,
  defaultClaudePaneSettings,
  parseExtraSettings,
  sanitizeClaudePaneSettings,
} from "./claudePaneSettings.js";

describe("sanitizeClaudePaneSettings", () => {
  it("falls back to inherit-everything for missing or malformed input", () => {
    expect(sanitizeClaudePaneSettings(undefined)).toEqual(defaultClaudePaneSettings());
    expect(sanitizeClaudePaneSettings({ caveman: "loud", advisor: 3, promptSuggestions: true })).toEqual(
      defaultClaudePaneSettings(),
    );
  });

  it("keeps valid values and trims the advisor model", () => {
    expect(
      sanitizeClaudePaneSettings({
        caveman: "ultra",
        advisor: "model",
        advisorModel: "  sonnet ",
        promptSuggestions: "off",
        extraSettings: '{"a":1}',
      }),
    ).toEqual({
      caveman: "ultra",
      advisor: "model",
      advisorModel: "sonnet",
      promptSuggestions: "off",
      extraSettings: '{"a":1}',
      userMcp: { mode: "all", allowed: [] },
      attention: { enabled: true, notifyWaiting: true, notifyDone: true, holdMessages: true },
    });
  });

  it("treats advisor 'model' without a model as inherit", () => {
    expect(sanitizeClaudePaneSettings({ advisor: "model", advisorModel: " " }).advisor).toBe("inherit");
  });

  it("drops extra settings that aren't a JSON object", () => {
    expect(sanitizeClaudePaneSettings({ extraSettings: "[1]" }).extraSettings).toBe("");
    expect(sanitizeClaudePaneSettings({ extraSettings: "{nope" }).extraSettings).toBe("");
  });
});

describe("parseExtraSettings", () => {
  it("accepts empty text and objects, rejects anything else", () => {
    expect(parseExtraSettings("  ")).toEqual({ value: {} });
    expect(parseExtraSettings('{"x": true}')).toEqual({ value: { x: true } });
    expect(parseExtraSettings("null")).toHaveProperty("error");
    expect(parseExtraSettings('"str"')).toHaveProperty("error");
    expect(parseExtraSettings("{")).toHaveProperty("error");
  });
});

describe("claudeLaunchOverrides", () => {
  it("passes nothing when everything is inherit", () => {
    expect(claudeLaunchOverrides(defaultClaudePaneSettings())).toEqual({ settings: null, env: {} });
  });

  it("maps each option to its Claude setting or env var", () => {
    const base = defaultClaudePaneSettings();
    expect(claudeLaunchOverrides({ ...base, caveman: "off" })).toEqual({ settings: null, env: { CAVEMAN_DEFAULT_MODE: "off" } });
    expect(claudeLaunchOverrides({ ...base, advisor: "off" }).settings).toEqual({ advisorModel: "" });
    expect(claudeLaunchOverrides({ ...base, advisor: "model", advisorModel: "sonnet" }).settings).toEqual({ advisorModel: "sonnet" });
    expect(claudeLaunchOverrides({ ...base, promptSuggestions: "off" }).settings).toEqual({ promptSuggestionEnabled: false });
    expect(claudeLaunchOverrides({ ...base, promptSuggestions: "on" }).settings).toEqual({ promptSuggestionEnabled: true });
  });

  it("merges extra settings, with the explicit options winning on conflicts", () => {
    const overrides = claudeLaunchOverrides({
      ...defaultClaudePaneSettings(),
      advisor: "off",
      extraSettings: '{"advisorModel":"opus","theme":"dark"}',
    });
    expect(overrides.settings).toEqual({ advisorModel: "", theme: "dark" });
  });
});

describe("user MCP servers", () => {
  it("reads user-scope servers from ~/.claude.json, local (command) vs remote (url)", () => {
    expect(
      userMcpServersFrom({ mcpServers: { playwright: { command: "npx", args: [] }, docs: { type: "http", url: "https://x" } } }),
    ).toEqual([
      { name: "playwright", kind: "local" },
      { name: "docs", kind: "remote" },
    ]);
    expect(userMcpServersFrom({})).toEqual([]);
    expect(userMcpServersFrom(null)).toEqual([]);
  });

  it("sanitizes a choice and rejects anything that isn't one", () => {
    expect(sanitizeUserMcpChoice({ mode: "pick", allowed: ["a", "a", 3], known: ["a", "b"] })).toEqual({
      mode: "pick",
      allowed: ["a"],
      known: ["a", "b"],
    });
    expect(sanitizeUserMcpChoice({ mode: "some" })).toBeUndefined();
    expect(sanitizeUserMcpChoice(undefined)).toBeUndefined();
  });

  it("denies the right servers per mode — a server added later stays out under pick", () => {
    const servers = ["playwright", "aws-mcp", "added-later"];
    expect(deniedUserMcp({ mode: "all", allowed: [] }, servers)).toEqual([]);
    expect(deniedUserMcp({ mode: "none", allowed: ["playwright"] }, servers)).toEqual(servers);
    expect(deniedUserMcp({ mode: "pick", allowed: ["playwright"], known: ["playwright", "aws-mcp"] }, servers)).toEqual([
      "aws-mcp",
      "added-later",
    ]);
  });

  it("passes denied servers as deniedMcpServers, merged with any in the extra JSON", () => {
    const base = defaultClaudePaneSettings();
    expect(claudeLaunchOverrides(base, ["aws-mcp"]).settings).toEqual({ deniedMcpServers: [{ serverName: "aws-mcp" }] });
    const merged = claudeLaunchOverrides(
      { ...base, extraSettings: '{"deniedMcpServers":[{"serverName":"aws-mcp"},{"serverName":"other"}]}' },
      ["aws-mcp", "playwright"],
    );
    expect(merged.settings).toEqual({
      deniedMcpServers: [{ serverName: "aws-mcp" }, { serverName: "other" }, { serverName: "playwright" }],
    });
    expect(claudeLaunchOverrides(base, []).settings).toBeNull();
  });
});

describe("attention hooks", () => {
  const cmd = 'node "/app/attentionBridge.js"';

  it("adds the hooks only with a bridge command and attention enabled", () => {
    const base = defaultClaudePaneSettings();
    expect(claudeLaunchOverrides(base).settings).toBeNull();
    expect(claudeLaunchOverrides(base, [], cmd).settings).toEqual({ hooks: attentionHooks(cmd) });
    expect(claudeLaunchOverrides({ ...base, attention: { ...base.attention, enabled: false } }, [], cmd).settings).toBeNull();
  });

  it("runs the bridge with each event and matches only AskUserQuestion among tools", () => {
    const hooks = attentionHooks(cmd) as Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    expect(Object.keys(hooks).sort()).toEqual(["Notification", "PreToolUse", "SessionEnd", "Stop", "UserPromptSubmit"]);
    expect(hooks.PreToolUse![0]!.matcher).toBe("AskUserQuestion");
    expect(hooks.Stop![0]!.hooks[0]!.command).toBe(`${cmd} stop`);
  });

  it("keeps hooks from the extra JSON, ours after them", () => {
    const mine = { type: "command", command: "echo mine" };
    const overrides = claudeLaunchOverrides(
      { ...defaultClaudePaneSettings(), extraSettings: JSON.stringify({ hooks: { Stop: [{ hooks: [mine] }] } }) },
      [],
      cmd,
    );
    const stop = (overrides.settings!.hooks as Record<string, unknown[]>).Stop!;
    expect(stop).toHaveLength(2);
    expect(stop[0]).toEqual({ hooks: [mine] });
  });

  it("sanitizes attention settings from old or bad files", () => {
    expect(sanitizeClaudePaneSettings({}).attention).toEqual({ enabled: true, notifyWaiting: true, notifyDone: true, holdMessages: true });
    expect(sanitizeClaudePaneSettings({ attention: { enabled: false, notifyDone: "no", holdMessages: false } }).attention).toEqual({
      enabled: false,
      notifyWaiting: true,
      notifyDone: true,
      holdMessages: false,
    });
  });
});
