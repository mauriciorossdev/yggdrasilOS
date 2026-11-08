import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { initialState, type TuiAction, type TuiState } from "../state/store.js";
import { buildPaletteCommands, findCommand, helpText, parseSlash, runSlash, SLASH_COMMANDS, skillPrompt } from "./index.js";
import type { CommandContext } from "./types.js";

function makeCtx(over: Omit<Partial<CommandContext>, "state"> & { state?: Partial<TuiState>; responses?: Record<string, unknown> } = {}) {
  const actions: TuiAction[] = [];
  const calls: Array<{ method: string; params?: unknown }> = [];
  const responses = over.responses ?? {};
  const ctx: CommandContext = {
    client: {
      call: (async (method: string, params?: unknown) => {
        calls.push({ method, params });
        if (method in responses) {
          const r = responses[method];
          if (r instanceof Error) throw r;
          return r;
        }
        return {};
      }) as never,
      disconnect: vi.fn(),
    },
    state: { ...initialState(), sessionKey: "tui:default:abc12345", ...over.state } as TuiState,
    dispatch: (a) => actions.push(a),
    gatewayUrl: "ws://gw",
    senderIdPrefix: "me",
    cwd: process.cwd(),
    skills: [],
    exit: vi.fn(),
    renameSession: vi.fn(async () => {}),
    showAgentForm: vi.fn(),
    openModelPicker: vi.fn(),
    sendMessage: vi.fn(),
    ...(({ state: _s, responses: _r, ...rest }) => rest)(over),
  };
  return { ctx, actions, calls };
}

describe("parseSlash", () => {
  it("splits the command from its arguments", () => {
    expect(parseSlash("/rename My new title")).toEqual({ name: "rename", args: "My new title" });
    expect(parseSlash("/HELP")).toEqual({ name: "help", args: "" });
    expect(parseSlash("/agent   reviewer ")).toEqual({ name: "agent", args: "reviewer" });
  });
  it("rejects anything that isn't a slash command", () => {
    expect(parseSlash("hello")).toBeNull();
    expect(parseSlash("/")).toBeNull();
    expect(parseSlash("!ls")).toBeNull();
  });
});

describe("registry", () => {
  it("has unique names and aliases", () => {
    const seen = new Set<string>();
    for (const c of SLASH_COMMANDS) {
      for (const n of [c.name, ...(c.aliases ?? [])]) {
        expect(seen.has(n), `duplicate ${n}`).toBe(false);
        seen.add(n);
      }
    }
  });
  it("resolves aliases", () => {
    expect(findCommand("quit")?.name).toBe("exit");
  });
  it("lists every command in /help, with usage where there is one", () => {
    const help = helpText();
    for (const c of SLASH_COMMANDS) expect(help).toContain(`/${c.usage ?? c.name} —`);
    expect(help).toContain("/rename <title>");
  });
  it("lists skills in /help", () => {
    expect(helpText([{ name: "review", description: "Review the diff", prompt: "p" }])).toMatch(/Skills:\n\/review — Review the diff/);
  });
});

describe("runSlash", () => {
  it("ignores text that is not a command", async () => {
    const { ctx, actions } = makeCtx();
    expect(await runSlash("hello", ctx)).toBe(false);
    expect(actions).toEqual([]);
  });

  it("says so for an unknown command instead of silently doing nothing", async () => {
    const { ctx, actions } = makeCtx();
    expect(await runSlash("/nope", ctx)).toBe(true);
    expect(actions[0]).toMatchObject({ type: "ADD_SYSTEM_MESSAGE", text: expect.stringContaining("Unknown command /nope") });
  });

  it("runs a skill typed as a slash command, filling {{args}}", async () => {
    const { ctx } = makeCtx({ skills: [{ name: "review", description: "d", prompt: "Review {{args}} carefully" }] });
    await runSlash("/review the auth module", ctx);
    expect(ctx.sendMessage).toHaveBeenCalledWith("Review the auth module carefully");
  });

  it("prefers a built-in over a skill of the same name", async () => {
    const { ctx } = makeCtx({ skills: [{ name: "help", description: "d", prompt: "x" }] });
    await runSlash("/help", ctx);
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  it("reports a command that throws", async () => {
    const { ctx, actions } = makeCtx({ responses: { "sessions.reset": new Error("boom") } });
    await runSlash("/reset", ctx);
    expect(actions.at(-1)).toMatchObject({ type: "ADD_SYSTEM_MESSAGE", text: expect.stringContaining("boom") });
  });
});

describe("individual commands", () => {
  it("/reset clears the gateway session then the transcript", async () => {
    const { ctx, actions, calls } = makeCtx();
    await runSlash("/reset", ctx);
    expect(calls[0]).toEqual({ method: "sessions.reset", params: { sessionKey: "tui:default:abc12345" } });
    expect(actions).toEqual([{ type: "RESET_MESSAGES" }]);
  });

  it("/new mints a tui session key and resets the mode", async () => {
    const { ctx, actions } = makeCtx();
    await runSlash("/new", ctx);
    expect(actions[0]).toMatchObject({ type: "SET_SESSION_KEY", sessionKey: expect.stringMatching(/^tui:default:me-/) });
    expect(actions).toContainEqual({ type: "SET_MODE", mode: "auto" });
  });

  it("/rename needs a title", async () => {
    const { ctx, actions } = makeCtx();
    await runSlash("/rename", ctx);
    expect(actions[0]).toMatchObject({ text: "Usage: /rename <title>" });
    await runSlash("/rename  Bug hunt ", ctx);
    expect(ctx.renameSession).toHaveBeenCalledWith("tui:default:abc12345", "Bug hunt");
  });

  it("/agent switches by id", async () => {
    const { ctx, actions } = makeCtx();
    await runSlash("/agent reviewer", ctx);
    expect(actions).toEqual([{ type: "SET_ACTIVE_AGENT", agentId: "reviewer" }]);
  });

  it("/model opens the picker on the active agent's provider", async () => {
    const { ctx, actions } = makeCtx({
      state: { agents: [{ id: "a", provider: "ollama" }], activeAgentId: "a" },
    });
    await runSlash("/model", ctx);
    expect(ctx.openModelPicker).toHaveBeenCalledWith("ollama");
    expect(actions).toEqual([{ type: "PUSH_VIEW", mode: "config" }]);
  });

  it("/tools sorts by name and opens the view; a failure becomes a message", async () => {
    const ok = makeCtx({ responses: { "tools.list": { tools: [{ name: "b", description: "" }, { name: "a", description: "" }] } } });
    await runSlash("/tools", ok.ctx);
    expect(ok.actions[0]).toMatchObject({ type: "SET_TOOLS", tools: [{ name: "a" }, { name: "b" }] });
    expect(ok.actions[1]).toEqual({ type: "PUSH_VIEW", mode: "tools" });

    const bad = makeCtx({ responses: { "tools.list": new Error("nope") } });
    await runSlash("/tools", bad.ctx);
    expect(bad.actions[0]).toMatchObject({ text: "Failed to list tools: nope" });
  });

  it("/compact reports what changed", async () => {
    const { ctx, actions } = makeCtx({ responses: { "sessions.compact": { compacted: true, before: 40, after: 12 } } });
    await runSlash("/compact", ctx);
    expect(actions[0]).toMatchObject({ text: "✓ Compacted: 40 → 12 messages" });
  });

  it("/export writes the transcript into cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ygg-export-"));
    const { ctx, actions } = makeCtx({
      cwd,
      responses: { "sessions.get": { session: { messages: [{ role: "user", content: "hi" }] } } },
    });
    await runSlash("/export", ctx);
    const [file] = await readdir(cwd);
    expect(file).toMatch(/^yggdrasil-session-abc12345-\d+\.md$/);
    expect(await readFile(join(cwd, file!), "utf8")).toBe("## user\n\nhi\n");
    expect(actions[0]).toMatchObject({ text: expect.stringContaining("✓ Exported") });
  });

  it("/status and /exit", async () => {
    const { ctx, actions } = makeCtx();
    await runSlash("/status", ctx);
    expect(actions[0]).toMatchObject({ text: expect.stringContaining("gateway: ws://gw") });
    await runSlash("/quit", ctx);
    expect(ctx.client.disconnect).toHaveBeenCalled();
    expect(ctx.exit).toHaveBeenCalled();
  });
});

describe("buildPaletteCommands", () => {
  it("lists commands that work without an argument, per-agent switches and skills", () => {
    const { ctx } = makeCtx({
      state: { agents: [{ id: "reviewer", provider: "p", model: "m" }] },
      skills: [{ name: "review", description: "d", prompt: "go" }],
    });
    const names = buildPaletteCommands(ctx).map((c) => c.name);
    expect(names).toContain("tools");
    expect(names).toContain("agent reviewer");
    expect(names).toContain("review");
    expect(names).not.toContain("rename");
    expect(names).not.toContain("agent");
  });

  it("runs the command when a palette entry is chosen", async () => {
    const { ctx, actions } = makeCtx();
    buildPaletteCommands(ctx).find((c) => c.name === "status")!.action();
    await new Promise((r) => setTimeout(r, 0));
    expect(actions[0]).toMatchObject({ type: "ADD_SYSTEM_MESSAGE" });
  });
});

describe("skillPrompt", () => {
  it("drops an unused placeholder cleanly", () => {
    expect(skillPrompt({ name: "x", description: "", prompt: "Summarize {{args}}" }, "")).toBe("Summarize");
  });
});
