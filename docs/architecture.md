# Yggdrasil — Architecture Document

> Plug-and-play agent platform — the world tree spine for channels, harnesses, and providers.

## What is Yggdrasil?

Yggdrasil is a modular agent orchestration platform that unifies multiple communication channels, LLM providers, and extensible tools into a single composable system. It takes user messages from any input (terminal, HTTP, Telegram), routes them through a configurable harness that orchestrates LLM calls and tool execution, and delivers responses back through the originating channel.

Everything is a plugin: channels, harnesses, providers, tools, and context sources are discovered, loaded, and composed at runtime via a kernel-based registry.

## Architecture Overview

```
                    ┌──────────────────────────────────────┐
                    │            CLI (yggdrasil)            │
                    │  init · run · tui · gateway · plugin │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────┐
                    │         Kernel (Plugin System)        │
                    │  discover → load → register → start  │
                    │                                      │
                    │  Registry:                           │
                    │   channels · harnesses · providers   │
                    │   tools · services · contextProviders│
                    │   gatewayMethods                     │
                    └──────────────┬───────────────────────┘
                                   │
          ┌────────────────────────▼─────────────────────────────┐
          │                    Gateway                           │
          │  HTTP Server (port 18789) + WebSocket RPC Bus        │
          │  Event broadcasting · Auth · Static UI serving       │
          ├─────────┬───────────┬───────────┬───────────────────┤
          │         │           │           │                   │
    ┌─────▼──┐ ┌────▼───┐ ┌────▼────┐ ┌────▼─────┐      ┌─────▼──────┐
    │  TUI   │ │  HTTP  │ │Telegram │ │  Custom  │      │Web Console │
    │Channel │ │Channel │ │Channel  │ │ Channel  │      │  (React)   │
    └────┬───┘ └────┬───┘ └────┬────┘ └────┬─────┘      └────────────┘
         │          │          │           │
         └──────────┴──────────┴───────────┘
                         │
              ┌──────────▼──────────┐
              │      Pipeline       │
              │    (turn-kernel)    │
              │                    │
              │ 1. Session history │
              │ 2. Context assembly│
              │ 3. Harness select  │
              │ 4. LLM + tools    │
              │ 5. Store reply    │
              └──────────┬─────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
   ┌─────▼─────┐  ┌─────▼─────┐  ┌──────▼──────┐
   │  Harness   │  │  Context  │  │  Sessions   │
   │  Runtime   │  │  Runtime  │  │  (persist)  │
   │            │  │           │  │             │
   │ echo · llm │  │ files·mem │  │ compact·trim│
   └─────┬──────┘  │ db·project│  └─────────────┘
         │         └───────────┘
   ┌─────▼──────┐
   │  Provider  │
   │            │
   │ openai-compat │
   │ ollama        │
   └──────┬────┘
          │
    ┌─────▼─────┐
    │    LLM    │
    │  (API)    │
    └───────────┘
```

## Core Concepts

### Channels

A channel is an input/output adapter. It receives messages from an external source, normalizes them, and delivers responses back. Channels are plugins that implement the `ChannelPlugin` interface.

```typescript
type ChannelPlugin = {
  id: string;
  meta: { label: string; description?: string };
  capabilities: { inbound: boolean; outbound: boolean; streaming?: boolean; interactive?: boolean };
  config: { listAccountIds(); resolveAccount(id) };
  gateway?: { startAccount(ctx); stopAccount(ctx) };
  outbound?: { sendText(ctx, text); sendBlock(ctx, block); sendFinal(ctx, final) };
};
```

**Built-in channels:**

| Channel | Transport | Streaming | Interactive |
|---------|-----------|-----------|-------------|
| TUI v1 | readline + ANSI | Yes | Yes |
| TUI v2 (Ink) | React terminal UI via WebSocket | Yes | Yes |
| HTTP | REST + SSE | Yes | No |
| Telegram | Webhook + Bot API | No | Yes |

Each channel can have multiple **accounts** (e.g., multiple Telegram bots, multiple HTTP ports).

### Harnesses

A harness is a strategy for processing messages. It takes user text + history + context, calls an external system (or builtin logic), and returns a response. Harnesses support streaming, tool loops, and classification.

```typescript
type AgentHarness = {
  id: string;
  supports(ctx): { supported: boolean; priority: number };
  runAttempt(params): Promise<{ text: string; usage?; classification?; sessionAppend? }>;
  classify?(result, ctx): "ok" | "error" | "retry" | "fallback";
  compact?(params): Promise<CompactResult>;
};
```

**Built-in harnesses:**

| Harness | ID | Priority | Purpose |
|---------|----|----------|---------|
| Echo | `builtin-echo` | 0 | Returns "echo: {message}". Always available. |
| LLM | `llm` | 100 | Full LLM orchestration with tool loops, streaming, parallel tool calls. |

**Selection policy** (`config.harness.policy`):
- `pinned`: always use `harness.pinnedId`
- `auto`: evaluate all harnesses via `supports()`, pick highest priority

### Providers

A provider is an LLM API backend. It translates Yggdrasil's `ChatMessage[]` into vendor-specific API calls.

```typescript
type ProviderPlugin = {
  id: string;
  listModels(ctx): ProviderModel[];
  chatComplete(ctx, params): Promise<ChatCompleteResult>;
  chatCompleteStream?(ctx, params, onEvent): Promise<ChatCompleteResult>;
};
```

**Built-in providers:**

| Provider | ID | API |
|----------|----|-----|
| OpenAI Compatible | `openai-compat` | Any OpenAI-compatible endpoint (OpenAI, Ollama, vLLM, etc.) |
| Ollama | `ollama` | Ollama-specific wrapper |

API key resolution order: `OLLAMA_API_KEY` → `OPENAI_API_KEY` → `YGGDRASIL_OPENAI_API_KEY` → `config.providers[id].apiKey`.

### Tools

Tools are functions the LLM can call during a conversation. They follow the OpenAI function calling schema.

```typescript
const myTool = defineTool({
  name: "get_weather",
  description: "Get current weather for a city",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
  async execute(ctx, args) {
    return { temperature: 22, condition: "sunny" };
  },
});
```

**Tool execution loop** (in LLM harness):
1. Send messages + tool definitions to LLM
2. If LLM returns `tool_calls`: execute each tool, append results, loop
3. If LLM returns text: done
4. Max iterations: `config.harness.maxToolIterations` (default 8)

**Approval flow** for destructive tools:
- LLM requests tool → check `riskLevel` / `requiresApproval`
- If destructive: emit `tool.approval.requested` event → wait for `tools.approve` RPC
- TUI shows interactive y/n prompt; web console shows approval dialog
- Timeout (60s) → auto-deny

### Context Assembly

The context assembly pipeline replaces static system prompts with composable, plugin-based context sources. Each `ContextProvider` contributes content that's injected into the LLM conversation as system messages.

```typescript
type ContextProvider = {
  id: string;
  priority?: number;
  supports?(ctx): boolean;
  assemble(ctx): Promise<ContextBlock[]>;
};
```

**Built-in context providers:**

| Provider | ID | Priority | Source |
|----------|----|----------|--------|
| Prompt Files | `prompt-files` | 0 | `.md` files from `prompts/` directory |
| Memory Local | `memory-local` | 10 | `YGGDRASIL.md` + `.yggdrasil/memory/*.md` |
| Memory DB | `memory-db` | 20 | SQLite database with CRUD RPC |
| Project Context | `project-context` | 30 | Git branch, languages, file structure |

Providers execute in parallel with 2s timeout, results are cached (TTL per provider), sorted by priority, and trimmed to `config.context.tokenBudget`.

### Sessions

Sessions persist conversation history to disk as JSON files. They support compaction to manage context window limits.

**Storage:** `.yggdrasil/sessions/{session-key}.json`

**Compaction policies:**
- `truncate`: keep last N messages, discard old
- `summarize`: LLM-powered summary of old messages, keep recent

**Token budgeting:** `config.sessions.maxTokens` limits total tokens sent to LLM. History is trimmed from oldest messages first.

## Plugin System

### How Plugins Work

Every component in Yggdrasil is a plugin. Plugins are discovered, loaded, and registered through the Kernel.

**Plugin structure:**
```
my-plugin/
  package.json
  yggdrasil.plugin.json    # Manifest: id, kind, entry, compat
  src/
    index.ts               # Exports YggdrasilPlugin via definePlugin()
```

**Manifest** (`yggdrasil.plugin.json`):
```json
{
  "id": "my-plugin",
  "kind": ["tool"],
  "entry": "./dist/index.js",
  "name": "My Plugin",
  "version": "0.1.0",
  "compat": { "pluginApi": ">=0.3.0" }
}
```

**Plugin code:**
```typescript
import { definePlugin } from "@yggdrasil/sdk";

export default definePlugin({
  id: "my-plugin",
  register(api) {
    api.registerTool(myTool);
    api.registerContextProvider(myProvider);
    api.registerGatewayMethod("my.method", handler);
    api.registerService(myService);
    // Also: registerHarness, registerChannel, registerProvider
  },
});
```

### Plugin Discovery

Plugins are discovered from:
1. `packages/` directory (workspace packages)
2. `extensions/` directory (local extensions)
3. `node_modules/@yggdrasil/*` (if `config.plugins.discoverNodeModules`)
4. Custom paths in `config.plugins.load.paths`

### Plugin Lifecycle

```
Bootstrap                Start              Stop                Dispose
   │                       │                  │                    │
   ├─ discover plugins     ├─ service.start() ├─ channel.onStop() ├─ harness.dispose()
   ├─ import modules       ├─ channel.onStart()├─ service.stop()  │
   ├─ plugin.register(api) │                  │                    │
   └─ populate registry    │                  │                    │
```

### Creating a Plugin

```bash
yggdrasil create-plugin my-tool --kind tool
# Creates extensions/my-tool/ with scaffold
cd extensions/my-tool && pnpm install && pnpm build
```

Plugin kinds: `channel`, `tool`, `harness`, `provider`, `service`.

## Gateway

The gateway is the central communication hub. It runs an HTTP server with WebSocket support, dispatches RPC calls, and broadcasts events.

### Endpoints

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `GET /` | HTTP | Health check |
| `GET /ui` | HTTP | Web console (React SPA) |
| `POST /inbound` | HTTP | HTTP channel message ingestion |
| `ws://host:port` | WebSocket | RPC + event streaming |

### WebSocket RPC Protocol

**Request:** `{ id: number, method: string, params: object }`
**Response:** `{ id: number, result: object }` or `{ id: number, error: { code, message } }`
**Event:** `{ type: "event", event: string, payload: object }`

### RPC Methods

| Category | Methods |
|----------|---------|
| Chat | `chat.send`, `chat.subscribe` |
| Sessions | `sessions.list`, `sessions.get`, `sessions.patch`, `sessions.reset` |
| Agents | `agents.list` |
| Providers | `providers.list` |
| Tools | `tools.list`, `tools.approve` |
| Config | `config.get`, `config.patch` |
| Memory | `memory.add`, `memory.list`, `memory.remove`, `memory.update` |
| System | `health`, `plugins.list`, `harnesses.list`, `channels.status` |

### Events (pushed to all WebSocket clients)

| Event | Payload | When |
|-------|---------|------|
| `chat.delta` | `{sessionKey, text, partial}` | Each streaming token |
| `chat.final` | `{sessionKey, text, harnessId}` | Turn complete |
| `turn.start` | `{sessionKey, agentId, harnessId}` | Turn begins |
| `turn.end` | `{sessionKey, harnessId, classification, durationMs}` | Turn ends |
| `tool.execute` | `{toolName, status, args, result}` | Tool called |
| `tool.approval.requested` | `{requestId, toolName, args, riskLevel}` | Destructive tool needs approval |
| `tool.approval.resolved` | `{requestId, toolName, approved}` | Approval decision made |

## Message Flow (Complete Path)

A user message follows this path from input to LLM response:

```
1. User types "hello" in TUI
   │
2. Channel normalizes → NormalizedInboundMessage
   │  { channelId: "tui", sessionKey: "tui:default:local-user", body: "hello" }
   │
3. Gateway dispatches → runChannelTurn()
   │
4. Pipeline (turn-kernel.ts):
   │
   ├─ 4a. Append user message to SessionStore
   │
   ├─ 4b. Get session history (with optional compaction)
   │       └─ If history exceeds compactThreshold → summarize or truncate
   │
   ├─ 4c. Trim history to token budget
   │
   ├─ 4d. Select harness (auto/pinned policy)
   │
   ├─ 4e. Assemble context:
   │       ├─ Inline systemPrompt (if set)
   │       └─ resolveContext() → parallel providers → sort → trim → ChatMessage[]
   │
   ├─ 4f. Build messages: [context] + [history] + [user message]
   │
   ├─ 4g. Call harness.runAttempt()
   │       │
   │       ├─ Resolve tools → OpenAI schema
   │       ├─ Call provider.chatComplete() / chatCompleteStream()
   │       ├─ If tool_calls → execute tools → loop
   │       └─ Return { text, usage, sessionAppend }
   │
   ├─ 4h. Store assistant reply in SessionStore
   │
   └─ 4i. Emit events: turn.start → chat.delta* → chat.final → turn.end
          │
5. Channel delivers response back to user
   │
6. TUI renders markdown + syntax highlighting
```

## Configuration

All configuration lives in `yggdrasil.config.json` at the workspace root.

```json
{
  "agents": [
    {
      "id": "default",
      "label": "Default Agent",
      "provider": "openai-compat",
      "model": "gpt-4o",
      "systemPrompt": "You are a helpful assistant.",
      "contextProviders": ["prompt-files", "memory-local", "memory-db", "project-context"]
    }
  ],
  "defaultAgent": "default",

  "harness": {
    "policy": "pinned",
    "pinnedId": "llm",
    "streaming": true,
    "maxToolIterations": 8,
    "compactBeforeTurn": true,
    "toolApproval": "destructive-only",
    "parallelToolCalls": true
  },

  "providers": {
    "openai-compat": {
      "baseUrl": "https://api.openai.com/v1",
      "defaultModel": "gpt-4o"
    }
  },

  "sessions": {
    "maxMessages": 50,
    "maxTokens": 12000,
    "compactThreshold": 40,
    "compactionPolicy": "summarize"
  },

  "context": {
    "defaultProviders": ["prompt-files", "memory-local"],
    "tokenBudget": 4000
  },

  "gateway": { "port": 18789, "host": "127.0.0.1" },

  "channels": {
    "tui": { "enabled": true },
    "http": { "enabled": true, "accounts": { "default": { "port": 18790 } } }
  },

  "plugins": {
    "load": { "paths": ["extensions"] },
    "discoverNodeModules": true
  },

  "pluginConfig": {
    "context-prompt-files": { "paths": ["prompts/"] },
    "context-memory-db": { "dbPath": ".yggdrasil/memory.db" }
  }
}
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `yggdrasil init` | Create `yggdrasil.config.json` in current directory |
| `yggdrasil run` | Start gateway + all enabled channels |
| `yggdrasil tui` | Start gateway + Ink TUI |
| `yggdrasil tui --legacy` | Start gateway + readline TUI (v1) |
| `yggdrasil tui --connect ws://host:port` | Connect TUI to remote gateway |
| `yggdrasil gateway` | Start gateway headless (no channels) |
| `yggdrasil plugin list` | List installed plugins |
| `yggdrasil plugin install <pkg>` | Install + enable a plugin |
| `yggdrasil plugin enable <id>` | Enable a disabled plugin |
| `yggdrasil plugin disable <id>` | Disable a plugin |
| `yggdrasil create-plugin <name> --kind <kind>` | Scaffold a new plugin |

## Packages

### Core (5)

| Package | Purpose |
|---------|---------|
| `@yggdrasil/kernel` | Plugin registry, discovery, lifecycle management |
| `@yggdrasil/sdk` | Public interfaces: plugins, harnesses, channels, providers, tools, context |
| `@yggdrasil/config` | Configuration types, loading, merging, validation, auth |
| `@yggdrasil/pipeline` | Turn kernel: message routing, context assembly, harness dispatch |
| `@yggdrasil/cli` | CLI commands and bootstrap logic |

### Runtime (4)

| Package | Purpose |
|---------|---------|
| `@yggdrasil/harness-runtime` | Harness selection (auto/pinned), builtin echo harness |
| `@yggdrasil/harness-llm` | LLM harness: tool loop, streaming, provider bridging |
| `@yggdrasil/tools-runtime` | Tool registry, resolution, execution, OpenAI schema conversion |
| `@yggdrasil/tools-sdk` | `defineTool()`, tool types, risk levels |

### Gateway & Channels (4)

| Package | Purpose |
|---------|---------|
| `@yggdrasil/gateway` | HTTP + WebSocket server, RPC dispatch, event bus, auth |
| `@yggdrasil/channel-tui` | Terminal channel (readline v1) |
| `@yggdrasil/channel-http` | HTTP channel with SSE streaming |
| `@yggdrasil/app-tui` | Standalone Ink/React TUI (v2): markdown, command palette, config menu |

### Context Assembly (6)

| Package | Purpose |
|---------|---------|
| `@yggdrasil/context-sdk` | ContextProvider interface and types |
| `@yggdrasil/context-runtime` | resolveContext() pipeline, caching |
| `@yggdrasil/context-prompt-files` | Read `.md` files from configurable directories |
| `@yggdrasil/context-memory-local` | Auto-discover memory files (YGGDRASIL.md pattern) |
| `@yggdrasil/context-memory-db` | SQLite memory store with CRUD RPC |
| `@yggdrasil/context-project` | Git, language, file tree detection |

### Other (4)

| Package | Purpose |
|---------|---------|
| `@yggdrasil/sessions` | Session persistence, compaction, token budgeting |
| `@yggdrasil/provider-openai-compat` | OpenAI-compatible API provider |
| `@yggdrasil/provider-ollama` | Ollama-specific provider |
| `@yggdrasil/web-console` | React + Vite web UI served at /ui |

### Extensions (4 examples)

| Extension | Kind | Purpose |
|-----------|------|---------|
| `echo-channel` | channel | Minimal test channel |
| `tool-datetime` | service+tool | Datetime tool plugin |
| `tool-destructive-demo` | tool | Demonstrates approval flow |
| `channel-telegram` | channel | Telegram bot integration |

## Testing

### Test layers

| Layer | Location | What it tests |
|-------|----------|--------------|
| Unit | `packages/*/src/*.test.ts` | Individual functions, reducers, parsers |
| Integration | `test/integration/` | Cross-package interactions |
| E2E | `test/e2e/` | Full message flow with mock providers |
| Live | `test/e2e/live/` | Real LLM API calls (requires `OLLAMA_API_KEY`) |

### Commands

```bash
pnpm test              # Unit + integration + E2E (mock)
pnpm test:unit         # Unit tests only
pnpm test:e2e          # E2E tests only
pnpm test:live         # Live provider tests (needs API key)
pnpm -r typecheck      # Type checking all packages
```

### Test helpers

- `createTestPlatform()`: Bootstraps a full Yggdrasil instance with mock providers for testing
- `GatewayWsClient`: WebSocket client for testing RPC methods and events
- Mock providers: stream, tool-loop, and capturing variants

## Dependency Graph

```
cli
 ├─ gateway
 │   ├─ pipeline
 │   │   ├─ harness-runtime
 │   │   │   └─ sdk
 │   │   ├─ harness-llm
 │   │   │   ├─ tools-runtime
 │   │   │   │   └─ tools-sdk
 │   │   │   └─ provider-openai-compat
 │   │   ├─ context-runtime
 │   │   │   ├─ context-sdk
 │   │   │   └─ kernel
 │   │   └─ sessions
 │   │       └─ config
 │   └─ kernel
 ├─ channel-tui
 ├─ app-tui (Ink)
 └─ config

Extensions (discovered at runtime):
 ├─ context-prompt-files → context-sdk, sdk
 ├─ context-memory-local → context-sdk, sdk
 ├─ context-memory-db → context-sdk, sdk, better-sqlite3
 ├─ context-project → context-sdk, sdk
 ├─ tool-weather → tools-sdk
 └─ channel-telegram → sdk
```

## Design Principles

1. **Everything is a plugin.** Channels, harnesses, providers, tools, and context sources all use the same registration pattern. No special cases.

2. **Pipeline, not monolith.** The message path is a clear pipeline: channel → normalize → session → context → harness → provider → response → store → deliver. Each stage is isolated and replaceable.

3. **Fail-safe by default.** Provider timeouts, tool failures, context provider crashes — all are caught, logged, and bypassed. The conversation continues.

4. **Configuration over code.** Agent behavior (model, provider, context sources, tool approval policy) is driven by `yggdrasil.config.json`. No recompilation needed.

5. **Backward compatible.** New features (context assembly, TUI v2) are additive. Existing configurations work without changes.

6. **Multi-agent aware.** Each agent has its own provider, model, harness, tools, and context sources. The orchestrator selects per-turn.
