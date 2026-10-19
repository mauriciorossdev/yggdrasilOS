# AGENTS.md

## Monorepo structure

- **pnpm workspace**: `packages/*` + `extensions/*`
- **Node >=22** required, ESM only (`"type": "module"`)
- Package prefix: `@yggdrasil/*`
- All packages use `tsc -p tsconfig.json` to build (extends `tsconfig.base.json`)
- **web-console** is the exception: Vite + React, `postbuild` copies dist into gateway

## Commands

```bash
pnpm install
pnpm build              # pnpm -r run build — compiles all packages
pnpm test               # unit + integration + e2e mock (no API key needed)
pnpm test:unit          # packages/**/*.test.ts + extensions/**/*.test.ts
pnpm test:integration   # test/integration/
pnpm test:e2e           # test/e2e/ (mock only, excludes live/)
pnpm test:live          # test/e2e/live/ — requires OLLAMA_API_KEY
pnpm test:all           # test + test:live
pnpm typecheck          # pnpm -r run typecheck
```

Pre-PR checklist: `pnpm build` → `pnpm test` → `pnpm test:live` (with key).

## Test architecture

- **Vitest** with path aliases: `@yggdrasil/*` → `packages/*/src/index.ts` (source, not dist)
- E2E tests run in a **single fork** (`pool: forks, singleFork: true`)
- Live tests skip automatically if `OLLAMA_API_KEY` is unset (`describe.skip`)
- Live tests: 60s timeout, 1 retry
- Helpers in `test/helpers/`: `createTestPlatform()`, `GatewayWsClient`, `postInbound()`, mock providers
- New E2E scenario: copy template from `test/e2e/TEMPLATE.md`

## Plugin development

- `node packages/cli/dist/index.js create-plugin <name> --kind tool|channel|harness|provider`
- Creates scaffold under `extensions/`
- Each plugin needs `yggdrasil.plugin.json` manifest (`id`, `entry`, `compat`)
- **Tool names must use snake_case** — some LLM backends reject hyphens
- Plugins load from `extensions/` and `node_modules/@yggdrasil/*`
- Reference examples: `extensions/echo-channel/` (channel), `extensions/tool-datetime/` (tool)

## Bundled extensions

| Extension | Kind | ID | Notes |
|-----------|------|----|-------|
| `extensions/tool-datetime` | tool | `local_datetime` | Returns current date/time with optional IANA timezone |
| `extensions/tool-destructive-demo` | tool | `delete_file` | Demo of destructive tool + approval flow |
| `extensions/echo-channel` | channel | `echo` | Loopback channel for testing |
| `extensions/my-tool` | tool | `my-tool_echo` | Scaffold example |
| `extensions/channel-telegram` | channel | `telegram` | Telegram bot via long-polling; needs `botToken` in config or `TELEGRAM_BOT_TOKEN` env |
| `extensions/channel-discord` | channel | `discord` | Discord bot via discord.js v14; needs `botToken` in config or `DISCORD_BOT_TOKEN` env; requires **MESSAGE CONTENT INTENT** in Discord Developer Portal |
| `extensions/tool-browser` | tool + service | `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_fill`, `browser_extract` | Playwright headless Chromium; run `pnpm exec playwright install chromium` after first install |
| `extensions/tool-fs` | tool | `fs_read_file`, `fs_write_file`, `fs_list_dir`, `fs_delete`, `fs_move` | File system tools; write/delete/move are destructive (approval flow) |
| `extensions/tool-search` | tool | `web_search` | Brave Search API or SearXNG; needs `BRAVE_SEARCH_API_KEY` or `SEARXNG_URL` |
| `extensions/tool-fetch` | tool | `http_fetch` | Native Node fetch; no browser/JS; auto-converts HTML to text; supports POST/PUT with body |
| `extensions/tool-image` | tool | `image_view`, `image_view_url` | Load local or remote images for vision-capable models; requires `__ygg_image__` sentinel support in tool-loop |
| `extensions/service-cron` | service | — | Scheduled jobs via node-cron; configure `pluginConfig["service-cron"].jobs` with cron expression + sessionKey + message |
| `packages/context-memory-db` | context-provider + tool | `memory_add`, `memory_list`, `memory_search`, `memory_update`, `memory_remove` | SQLite long-term memory; context provider auto-injects memories + tools for explicit CRUD |

### tool-browser setup

```bash
pnpm exec playwright install chromium   # one-time, downloads ~94MB
```

Tools: `browser_navigate(url)` · `browser_screenshot()` · `browser_click(selector)` · `browser_fill(selector, value)` · `browser_extract(selector, attribute?, limit?)`  
Risk levels: navigate/screenshot/extract = safe · click/fill = moderate (approval prompt)

### channel-discord setup

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "...",
          "allowedChannelIds": [],
          "prefix": ""
        }
      }
    }
  }
}
```

Discord Developer Portal requirements: `bot` scope · `Send Messages` + `Read Messages` permissions · **MESSAGE CONTENT INTENT** privileged intent enabled.

### channel-telegram setup

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "default": { "botToken": "..." }
      }
    }
  }
}
```

## Publishing

- `node scripts/prepare-publish.mjs` syncs version + publishConfig across all publishable packages
- CLI package also ships `templates/` directory

## Key paths

- Config: `yggdrasil.config.json` (repo root)
- Gateway default: `127.0.0.1:18789`
- HTTP channel default port: `18790`
- Entry point: `packages/cli/src/index.ts` → `yggdrasil` bin command

## Vitest alias gotcha

The vitest configs (root, e2e, live) all resolve `@yggdrasil/*` to **source** (`src/index.ts`), not compiled dist. This means vitest runs against TypeScript directly — no pre-build needed for tests, but `pnpm build` is still required before running the CLI or e2e tests that spawn the gateway.