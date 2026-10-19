# Creating plugins

Yggdrasil loads plugins from `packages/`, `extensions/`, and optionally `node_modules/@yggdrasil/*` without modifying the CLI.

## Quick start

```bash
pnpm build
node packages/cli/dist/index.js create-plugin my-tool --kind tool
cd extensions/my-tool
pnpm install
pnpm build
```

Enable discovery in `yggdrasil.config.json` (enabled by default):

```json
{
  "plugins": {
    "load": { "paths": ["extensions"] },
    "discoverNodeModules": true
  }
}
```

Run the platform:

```bash
node packages/cli/dist/index.js run
```

Verify with gateway RPC `plugins.list`.

## Plugin kinds

| `--kind` | Registers |
|----------|-----------|
| `channel` | `api.registerChannel()` |
| `tool` | `api.registerTool(defineTool(...))` |
| `harness` | `api.registerHarness()` |
| `provider` | `api.registerProvider()` |

## Tool plugins

Use `@yggdrasil/tools-sdk`. Prefer **snake_case** tool names (e.g. `my_tool_echo`) — some LLM backends reject names with hyphens.

```typescript
import { defineTool } from "@yggdrasil/tools-sdk";

api.registerTool(
  defineTool({
    name: "my_tool",
    description: "What it does",
    parameters: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    },
    async execute(_ctx, args) {
      return { answer: args.q };
    },
  }),
);
```

The LLM harness resolves tools at runtime and runs the tool loop (default max 8 iterations).

## Channel plugins

Channels receive inbound messages via `gateway.startAccount` and reply via `outbound.sendFinal` / `sendBlock`.

| Pattern | Example |
|---------|---------|
| Long polling | `extensions/channel-telegram` |
| HTTP webhook | `@yggdrasil/channel-http` |
| Terminal | `@yggdrasil/channel-tui` |

Use `buildSessionKey(channelId, accountId, senderId)` for stable sessions. See [telegram-channel.md](./telegram-channel.md).

## Manifest

Each plugin needs `yggdrasil.plugin.json`:

```json
{
  "id": "my-tool",
  "entry": "./dist/index.js",
  "compat": { "pluginApi": ">=0.3.0" }
}
```

Build before running so `dist/index.js` exists.

## Reference

- Builtin tools: `@yggdrasil/tool-builtin` (`datetime`, `echo`)
- Example extension: `extensions/tool-datetime`
- Echo channel: `extensions/echo-channel`
