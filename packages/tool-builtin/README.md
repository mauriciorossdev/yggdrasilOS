# @yggdrasil/tool-builtin

## Purpose

The always-on tool set. Every `AgentToolDefinition` exported from this
package's `builtinTools` array is registered by `@yggdrasil/tools-runtime` on
**every** `resolveTools()` call, regardless of what plugins are installed or
enabled — there's no manifest, no opt-in/opt-out, no plugin loader involved.
It's first-party code bundled directly in the monorepo, not a plugin.

Currently it ships two trivial, side-effect-free tools:

- `datetime` — returns the current time as ISO 8601 (`{ iso: string }`), no parameters.
- `echo` — echoes back whatever `message` argument it's given (`{ echoed: args }`), for testing the tool-call pipeline end to end.

Both are `defineTool(...)` calls in `src/index.ts` with no `riskLevel` set
(so they default to no approval requirement).

## Public API

From `src/index.ts`:

```ts
export const datetimeTool: AgentToolDefinition;
export const echoTool: AgentToolDefinition;
export const builtinTools: AgentToolDefinition[]; // [datetimeTool, echoTool]
```

`builtinTools` is the only export anything else actually consumes.

## Depends on

- `@yggdrasil/tools-sdk` — `defineTool`, for building both tools.

## Used by

- `@yggdrasil/tools-runtime` (`src/resolve.ts`) — the only consumer. It
  imports `builtinTools` and registers each one unconditionally at the start
  of every `resolveTools()` call, before plugin-provided tools are added.

## Configuration

None. These tools take no config and have no environment dependency.

## Extending / what's safe to change

This package is a reference example of the minimal `defineTool` pattern (see
`@yggdrasil/tools-sdk`'s README for the full explanation of the interface,
snake_case naming requirement, and risk levels/approval), but it is **not**
where you should add new tools by default. Because everything here is
registered on every single call with no way to disable it per-installation,
adding a tool to `builtinTools` means every consumer of this monorepo gets it
whether they want it or not.

Add here only if the tool is genuinely universal and safe (`riskLevel: "safe"`
or unset) — think diagnostics/smoke-test tools like `echo`, not anything with
real side effects or external dependencies. For anything else — filesystem
access, shell execution, network calls, third-party APIs — package it as its
own plugin instead, following `@yggdrasil/tool-system` or
`@yggdrasil/tool-weather` as the templates (a `definePlugin(...)` default
export, a `yggdrasil.plugin.json` manifest, `api.registerTool(...)` per
tool). That way it can be disabled via `plugins.disabled` in
`yggdrasil.config.json` without touching this package.

If you do add a tool here: keep it dependency-free (no Node built-ins beyond
what's already used, no network I/O) since it runs unconditionally for every
caller of `resolveTools`, including tests.
