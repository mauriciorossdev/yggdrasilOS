import { describe, expect, it } from "vitest";
import type { AgentFlowNode } from "../types.js";
import { buildLaunchCommand } from "./buildLaunchCommand.js";

const claudeNode = (harness: Partial<Extract<AgentFlowNode["harness"], { type: "claude" }>> = {}): AgentFlowNode =>
  ({ id: "n1", name: "Reviewer", position: { x: 0, y: 0 }, harness: { type: "claude", ...harness } });

describe("buildLaunchCommand — claude", () => {
  it("passes no permission flags by default", () => {
    expect(buildLaunchCommand(claudeNode())).toEqual({ command: "claude", args: [] });
  });

  it("maps permission mode and tool rules to claude's flags", () => {
    const { args } = buildLaunchCommand(
      claudeNode({ permissionMode: "plan", allowedTools: ["Read", "Bash(git log:*)"], disallowedTools: ["Bash(rm:*)"] }),
    );
    expect(args).toEqual([
      "--permission-mode",
      "plan",
      "--allowedTools=Read,Bash(git log:*)",
      "--disallowedTools=Bash(rm:*)",
    ]);
  });

  it("keeps each tool list in a single token so the positional prompt appended later is not swallowed", () => {
    const { args } = buildLaunchCommand(claudeNode({ allowedTools: ["Read", "Edit"] }));
    expect(args).toHaveLength(1);
    expect(args![0]).toBe("--allowedTools=Read,Edit");
  });

  it("omits empty tool lists", () => {
    expect(buildLaunchCommand(claudeNode({ allowedTools: [], disallowedTools: [] })).args).toEqual([]);
  });

  it("does not apply the permission flags to cloud nodes", () => {
    const { command, args, env } = buildLaunchCommand(
      claudeNode({ cloud: true, initialPrompt: "do x", permissionMode: "bypassPermissions", allowedTools: ["Read"] }),
    );
    expect(command).toBe("/bin/sh");
    expect(args!.join(" ")).not.toContain("permission");
    expect(args!.join(" ")).not.toContain("allowedTools");
    expect(env).toEqual({ YGG_CLOUD_DESC: "do x" });
  });
});

describe("buildLaunchCommand — yggdrasil", () => {
  const yggNode = (harness: object = {}): AgentFlowNode =>
    ({ id: "n2", name: "Local", position: { x: 0, y: 0 }, harness: { type: "yggdrasil", agentId: "default", ...harness } }) as AgentFlowNode;

  it("has no command of its own and no extra flags by default", () => {
    expect(buildLaunchCommand(yggNode())).toEqual({ args: [] });
  });

  it("maps approval mode and model to yggdrasil tui flags", () => {
    expect(buildLaunchCommand(yggNode({ approvalMode: "plan", model: "gpt-oss:120b" })).args).toEqual([
      "--mode",
      "plan",
      "--model",
      "gpt-oss:120b",
    ]);
  });
});

describe("buildLaunchCommand — claude sessions", () => {
  it("continues the last conversation", () => {
    expect(buildLaunchCommand(claudeNode({ continueSession: true })).args).toEqual(["--continue"]);
  });

  it("resumes by id or name in one token, and that wins over continue", () => {
    expect(buildLaunchCommand(claudeNode({ resumeSession: "reviewer", continueSession: true })).args).toEqual([
      "--resume=reviewer",
    ]);
  });

  it("names the session, and treats an empty resume target as a new conversation", () => {
    expect(buildLaunchCommand(claudeNode({ sessionName: "reviewer", resumeSession: "" })).args).toEqual([
      "--name",
      "reviewer",
    ]);
  });

  it("does not apply session flags to cloud nodes", () => {
    const { args } = buildLaunchCommand(claudeNode({ cloud: true, continueSession: true, sessionName: "x" }));
    expect(args!.join(" ")).not.toMatch(/continue|--name/);
  });
});
