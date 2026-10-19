# @yggdrasil/tool-weather

## Purpose

A minimal demo plugin: one tool, `get_weather`, that returns hardcoded mock
weather data (`{ city, tempC: 22, condition: "sunny" }`) for any city name
given to it. There is no real weather API call — it's explicitly a
demo/reference plugin (see `package.json`'s `"description": "Demo weather
tool plugin for Yggdrasil"`), intended as the simplest possible complete
example of "a tool packaged as an installable plugin," as opposed to
`@yggdrasil/tool-system` which shows a plugin with several real,
side-effecting tools.

## Public API

`src/index.ts` default-exports a `definePlugin(...)` object (id
`"tool-weather"`); `getWeatherTool` itself is not exported for external
import — nothing outside this package uses it directly.

`yggdrasil.plugin.json`:
```json
{ "id": "tool-weather", "kind": ["service"], "entry": "./dist/index.js", "compat": { "pluginApi": ">=0.3.0" } }
```

The tool itself:
```ts
defineTool({
  name: "get_weather",
  description: "Returns mock weather for a city (demo plugin).",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  async execute(_ctx, args) { return { city, tempC: 22, condition: "sunny" }; },
});
```
No `riskLevel` is set (read-only, no approval needed).

## Depends on

- `@yggdrasil/sdk` — `definePlugin`.
- `@yggdrasil/tools-sdk` — `defineTool`.

No other runtime dependencies.

## Used by

Nobody imports this package's code directly. Like `tool-system`, it is
discovered and loaded dynamically by the kernel's plugin loader (scans
`packages/*` and `extensions/*` for `yggdrasil.plugin.json`), and its one
tool becomes available through `@yggdrasil/tools-runtime`'s registry once
loaded.

## Configuration

None. No `configSchema`, `register(api)` ignores `api.config`. Disable via
`plugins.disabled: ["tool-weather"]` in `yggdrasil.config.json` if you don't
want the demo tool cluttering the model's tool list.

## Extending / what's safe to change

Treat this package as the "hello world" reference for the plugin-tool
pattern, not as a real integration to build on top of blindly — if you want
actual weather data, replace the hardcoded `execute` body with a real HTTP
call (and then reconsider `riskLevel`: outbound network calls to a
third-party API are still arguably `safe` from an approval standpoint since
they're read-only and non-destructive to the user's system, but you'd want
to add error handling for network failures, timeouts, and invalid API
responses that the current mock trivially doesn't need).

This is the pattern to copy when someone asks "how do I add a single new
tool as its own plugin":

1. `src/index.ts`: one or more `defineTool(...)` calls, each with a
   snake_case `name` (see `@yggdrasil/tools-sdk`'s README for why hyphens are
   disallowed), a `description` the model uses to decide when to call it, a
   `parameters` JSON-schema-like object, and `execute`.
2. Wrap them in `definePlugin({ id, name, version, register(api) { for (const
   tool of tools) api.registerTool(tool); } })` and default-export it.
3. Add `yggdrasil.plugin.json` with matching `id`, `entry: "./dist/index.js"`,
   and a `compat.pluginApi` range.
4. Add `dist` and `yggdrasil.plugin.json` to `package.json`'s `files` array so
   the manifest ships when published (see this package's `package.json`).

For anything beyond a single trivial tool — multiple related tools, real I/O,
platform-specific logic, tools that need approval — use
`@yggdrasil/tool-system` as the template instead; it demonstrates
`riskLevel: "destructive"` and shared helper modules that this package is too
small to need.
