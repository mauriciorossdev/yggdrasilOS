# @yggdrasil/tools-runtime

## Purpose

The runtime side of the tools system: builds the list of tools available for
a given call, converts that list into the OpenAI function-calling wire
format, and executes a tool by name. This is what `harness-llm` and the
gateway actually call at request time — it's the glue between "tools that
exist" (`@yggdrasil/tools-sdk` definitions registered by plugins) and "tools
the model can see and invoke right now."

It maintains an in-memory registry (a `Map<string, AgentToolDefinition>`)
that gets rebuilt on every `resolveTools()` call, not persisted across calls.

## Public API

From `src/index.ts`:

```ts
// registry.ts
export function registerToolDefinition(def: AgentToolDefinition): void;
export function clearToolRegistry(): void;
export function listTools(): AgentToolDefinition[];
export function getTool(name: string): AgentToolDefinition | undefined;
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown>;

// resolve.ts
export async function resolveTools(ctx: ToolContext): Promise<AgentToolDefinition[]>;

// to-openai.ts
export function toolsToOpenAI(tools: AgentToolDefinition[]): ChatToolDefinition[];
```

`resolveTools(ctx)` (`src/resolve.ts`) is the entry point most callers use.
Each call:

1. Clears the registry (`clearToolRegistry()`).
2. Registers every tool in `@yggdrasil/tool-builtin`'s `builtinTools` array
   unconditionally.
3. Reads `getRegistry().tools` from `@yggdrasil/kernel` — this is the set of
   tools/tool-factories that plugins registered via `api.registerTool(...)`
   during plugin load — and registers each one:
   - If the entry already looks like an `AgentToolDefinition` (has `name`,
     `execute`, `parameters`), it's registered as-is.
   - Otherwise it's treated as a legacy `ToolFactory` (`@yggdrasil/sdk`): it's
     called with `{ config: ctx.config }` to get an array of legacy
     `AgentTool` objects, each of which is adapted into an
     `AgentToolDefinition` via `legacyToToolDefinition` (parameters default to
     an empty object schema — legacy tools didn't carry JSON-schema
     parameters).
4. Returns `listTools()`.

`toolsToOpenAI(tools)` (`src/to-openai.ts`) maps `AgentToolDefinition[]` to
`ChatToolDefinition[]` (the `{ type: "function", function: { name,
description, parameters } }` shape providers expect). `requiresApproval` and
`riskLevel` are intentionally dropped here — they're server-side-only
metadata, never sent to the model.

`executeTool(name, args, ctx)` looks the tool up in the registry and calls
`tool.execute(ctx, args)`, throwing `Unknown tool: <name>` if it isn't
registered. It does **not** check `requiresApproval`/`riskLevel` — approval
gating is the caller's responsibility (see harness-llm below).

## Depends on

- `@yggdrasil/tools-sdk` — `AgentToolDefinition`, `ToolContext` types.
- `@yggdrasil/tool-builtin` — always-on baseline tools registered by every `resolveTools()` call.
- `@yggdrasil/kernel` — `getRegistry()`, the live registry of tools contributed by loaded plugins.
- `@yggdrasil/sdk` — `AgentTool`, `ToolFactory` types (for the legacy adapter path).

## Used by

- `@yggdrasil/harness-llm` (`src/harness.ts`) — calls `resolveTools`,
  `toolsToOpenAI`, `executeTool`, and `getTool` to build the tool list sent to
  the model and to execute whatever the model calls, including checking
  `def.requiresApproval || def.riskLevel === "destructive"` before running a
  tool (in `src/tool-loop.ts`) and invoking `approveTool` if so.
- `@yggdrasil/gateway` (`src/methods.ts`) — the `tools.list` gateway method
  calls `resolveTools` then `listTools` to report the currently available
  tools over the wire (e.g. to a UI/console).

## Configuration

None directly. `ToolContext.config` is forwarded to tool `execute()` calls
and to legacy `ToolFactory` calls, but its shape is opaque to this package —
it's whatever the caller (harness, gateway) passes in, ultimately derived
from `yggdrasil.config.json`.

## Extending / what's safe to change

You will rarely need to modify this package to add a tool — see
`@yggdrasil/tools-sdk`'s README for the `defineTool` pattern and
`@yggdrasil/tool-system` / `@yggdrasil/tool-weather` for two different
concrete ways to get a tool into the registry:

- **Always-on tool**: add it to `@yggdrasil/tool-builtin`'s `builtinTools`
  array. Every `resolveTools()` call registers these unconditionally,
  independent of plugin configuration — reserve this for tools that should
  exist in every installation (see `tool-builtin`'s README before adding
  something here; it's meant to stay minimal).
- **Plugin-provided tool** (the normal path): package it as a plugin — see
  `tool-system`/`tool-weather` — that calls `api.registerTool(myTool)` in its
  `register(api)` function. The kernel's plugin loader puts these into
  `getRegistry().tools`, and `resolveTools()` picks them up automatically on
  the next call. No change to this package required.

Things worth knowing if you do touch this package:

- `resolveTools` clears and rebuilds the whole registry on every call — it is
  not incremental. If you're adding caching, be careful: callers currently
  rely on getting a fresh view of whatever plugins are currently loaded.
- The legacy `ToolFactory` adaptation path (`isToolDefinition` /
  `legacyToolToDefinition` in `resolve.ts`) exists for backward compatibility
  with an older `AgentTool`/`ToolFactory` shape from `@yggdrasil/sdk`. New
  tools should just export an `AgentToolDefinition` via `defineTool` directly
  — don't write new code against the legacy path.
- Tool name collisions: `registerToolDefinition` is a plain `Map.set`, so a
  later registration with the same `name` silently overwrites an earlier one.
  Registration order is: builtin tools first, then plugin registry tools in
  `getRegistry().tools` order. If you need a plugin tool to override a
  builtin one, this is how it happens today (silently) — be deliberate about
  naming to avoid unintentional collisions.
- Approval enforcement lives in the harness, not here. If you add a new
  caller of `executeTool`, remember to replicate the
  `requiresApproval`/`riskLevel` check yourself (via `getTool(name)`) —
  `executeTool` will happily run a destructive tool with no gate if you don't.
