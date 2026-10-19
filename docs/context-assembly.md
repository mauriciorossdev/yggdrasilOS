# Context Assembly Pipeline

## Overview

The Context Assembly Pipeline replaces the static `systemPrompt` string with a composable, plugin-based system where multiple **context sources** contribute to what the LLM sees as system context. Each source is a `ContextProvider` plugin that assembles context blocks, which are then sorted by priority, trimmed to a token budget, and injected into the message history before the LLM call.

This follows the same pattern as the tool plugin system: array-based registry → resolve pipeline → per-agent composition.

```
ContextProviders (plugins, parallel)
  ├─ prompt-files     (.md from workspace)      priority: 0
  ├─ memory-local     (YGGDRASIL.md, notes)     priority: 10
  ├─ memory-db        (SQLite)                  priority: 20
  └─ project-context  (git, file tree)          priority: 30
          │
          ▼
  resolveContext()
    Promise.all() → filter(agent) → sort(priority) → trim(tokenBudget)
          │
          ▼
  turn-kernel: [system prompt] + [assembled context] + [session history] + [user message]
```

## What It Adds

| Capability | Before | After |
|-----------|--------|-------|
| System prompt | Single static string in `AgentConfig.systemPrompt` | Composable from multiple files, databases, and runtime sources |
| Memory | None | Local files (`YGGDRASIL.md`, `.yggdrasil/memory/`) + SQLite database with CRUD API |
| Project awareness | None | Auto-detects git branch, languages, package manager, key files |
| Multi-agent context | Same system prompt for all | Each agent configures its own `contextProviders[]` |
| Token management | No budget control | Configurable `tokenBudget` with automatic trimming |
| Extensibility | Hardcoded | Any plugin can register a `ContextProvider` |

## Packages

| Package | Purpose | Dependencies |
|---------|---------|-------------|
| `@yggdrasil/context-sdk` | Type definitions: `ContextProvider`, `ContextBlock`, `ContextProviderContext` | None |
| `@yggdrasil/context-runtime` | `resolveContext()` pipeline + `ContextCache` with TTL | context-sdk, kernel, sdk |
| `@yggdrasil/context-prompt-files` | Reads `.md` files from configurable directories | context-sdk, sdk |
| `@yggdrasil/context-memory-local` | Auto-discovers `YGGDRASIL.md` + `.yggdrasil/memory/*.md` | context-sdk, sdk |
| `@yggdrasil/context-memory-db` | SQLite memory store + gateway RPC methods | context-sdk, sdk, better-sqlite3 |
| `@yggdrasil/context-project` | Git status, language detection, file tree summary | context-sdk, sdk |

## Configuration

### Per-agent context providers

```json
{
  "agents": [
    {
      "id": "coder",
      "provider": "openai-compat",
      "model": "gpt-4o",
      "contextProviders": ["prompt-files", "memory-local", "memory-db", "project-context"],
      "systemPrompt": "Optional inline prompt — always injected first"
    }
  ]
}
```

### Global defaults

```json
{
  "context": {
    "defaultProviders": ["prompt-files", "memory-local"],
    "tokenBudget": 4000
  }
}
```

- `defaultProviders`: used when an agent has no `contextProviders` field
- `tokenBudget`: maximum estimated tokens for assembled context (chars / 4 heuristic)

### Provider-specific config

```json
{
  "pluginConfig": {
    "context-prompt-files": {
      "paths": ["prompts/", "rules/"]
    },
    "context-memory-db": {
      "dbPath": ".yggdrasil/memory.db"
    }
  }
}
```

## Providers in Detail

### prompt-files

Reads all `.md` files from configured directories (default: `prompts/`), sorted alphabetically, concatenated with `---` separators.

**File structure:**
```
prompts/
  01-base.md          # Core personality and behavior
  02-tools.md         # How to use available tools
  03-output-format.md # Response format guidelines
```

Files are numbered for explicit ordering. Any `.md` file in the directory is included.

**Cache:** 5 minutes TTL. Changes require restarting or waiting for cache expiry.

### memory-local

Auto-discovers memory files without configuration:

| Path | Scope | Purpose |
|------|-------|---------|
| `<workspace>/YGGDRASIL.md` | Project | Project-level notes, conventions, decisions |
| `<workspace>/.yggdrasil/memory/*.md` | Project | Modular project memories |
| `~/.yggdrasil/memory/*.md` | Global | User-wide memories (preferences, style) |

Files are concatenated in the order listed above (project first, global last).

**Cache:** 5 minutes TTL.

### memory-db

SQLite database for structured, persistent memories with CRUD operations via gateway RPC.

**Schema:**
```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,           -- NULL = applies to all agents
  content TEXT NOT NULL,
  type TEXT DEFAULT 'fact', -- fact, preference, context, instruction
  created_at INTEGER,
  updated_at INTEGER,
  relevance REAL DEFAULT 1.0
);
```

**Gateway RPC methods:**

| Method | Params | Returns |
|--------|--------|---------|
| `memory.add` | `{content, type?, agentId?}` | `{memory: MemoryRow}` |
| `memory.list` | `{agentId?, limit?}` | `{memories: MemoryRow[]}` |
| `memory.remove` | `{id}` | `{ok, id}` |
| `memory.update` | `{id, content?, relevance?}` | `{ok, id}` |

**Assembly:** Retrieves top 20 memories sorted by relevance (desc) and recency. Agent-specific + global (agent_id IS NULL) memories are combined.

**Cache:** 1 minute TTL. Adding/removing memories via RPC does not automatically invalidate the cache — the next turn after TTL expiry will pick up changes.

### project-context

Automatically gathers runtime information about the workspace:

```markdown
## Project Context
- Name: yggdrasil
- Workspace: /Users/dev/yggdrasil
- Git: main (3 uncommitted changes)
- Languages: TypeScript, JavaScript/Node
- Package manager: pnpm
- Key files: package.json, tsconfig.base.json, yggdrasil.config.json
```

**Detection:**
- Git: `git rev-parse --abbrev-ref HEAD` + `git status --porcelain`
- Languages: checks for `tsconfig.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, etc.
- Package manager: checks lock files (pnpm-lock.yaml, yarn.lock, etc.)
- Files: top-level file listing (max 20)

**Cache:** 1 minute TTL (git state changes frequently).

## Performance

### Benchmarks

| Scenario | First turn (cache miss) | Subsequent turns (cache hit) |
|----------|------------------------|------------------------------|
| prompt-files only | ~5ms | ~0ms |
| All 4 providers | ~50-200ms | ~0ms |
| With SQLite (1000 memories) | ~10ms | ~0ms |
| project-context (large repo) | ~100-200ms | ~0ms |

For comparison, a typical LLM response takes 500ms–30s. Context assembly overhead is imperceptible.

### How caching works

```
Turn 1: cache MISS → all providers execute in parallel → results cached
Turn 2+: cache HIT → ~0ms until TTL expires
         ↓
File change → TTL expiry invalidates (5min for files, 1min for git)
memory.add RPC → next turn after TTL picks up change
```

### Safeguards

- **Timeout:** Each provider has a 2-second timeout via `Promise.race`. If a provider hangs, it's skipped with a console warning.
- **Failure isolation:** If a provider throws, it's caught and skipped. Other providers still contribute. The turn proceeds.
- **Fallback:** If `resolveContext()` fails entirely, the inline `systemPrompt` is still injected (backward compatible).

## Multi-Agent Behavior

Each agent has its own `contextProviders[]`. When the harness orchestrates multiple agents, `resolveContext()` receives the current `agentId` and only fires that agent's configured providers.

```json
{
  "agents": [
    {
      "id": "coder",
      "contextProviders": ["prompt-files", "memory-db"]
    },
    {
      "id": "reviewer",
      "contextProviders": ["project-context"]
    }
  ]
}
```

The `memory-db` provider also scopes memories by `agent_id`:
- Memories with `agent_id = "coder"` are only seen by the coder agent
- Memories with `agent_id = NULL` are seen by all agents

## Writing a Custom ContextProvider

Any plugin can register a context provider:

```typescript
import { definePlugin } from "@yggdrasil/sdk";
import type { ContextProvider } from "@yggdrasil/context-sdk";

const myProvider: ContextProvider = {
  id: "my-context",
  label: "My Custom Context",
  priority: 15,

  supports(ctx) {
    // Optional: return false to skip this provider for certain agents/sessions
    return ctx.agentId === "special-agent";
  },

  async assemble(ctx) {
    // ctx.workspaceRoot, ctx.agentId, ctx.sessionKey, ctx.config are available
    const data = await fetchRelevantContext(ctx.sessionKey);

    return [{
      role: "system",
      content: `## Custom Context\n${data}`,
      source: "my-context",
      priority: 15,
      cacheable: true,
      ttlMs: 120_000, // 2 minutes
    }];
  },
};

export default definePlugin({
  id: "my-context-plugin",
  register(api) {
    api.registerContextProvider(myProvider);
  },
});
```

### ContextBlock fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `"system"` | Yes | Always "system" for context blocks |
| `content` | `string` | Yes | The text injected into the LLM conversation |
| `source` | `string` | Yes | Provider ID, used for logging/debugging |
| `priority` | `number` | Yes | Sort order (0 = first, 100 = last) |
| `tokens` | `number` | No | Pre-computed token count. If omitted, estimated as `content.length / 4` |
| `cacheable` | `boolean` | No | Whether to cache this block (default: `true`) |
| `ttlMs` | `number` | No | Cache time-to-live in milliseconds (default: 300,000 = 5 minutes) |

## Pros and Cons

### Pros

- **Composable:** Mix and match context sources per agent. Add/remove with config, no code changes.
- **Plugin-based:** Follows the same pattern as tools — familiar to plugin authors, extensible.
- **Performance:** Parallel execution + caching. Near-zero overhead on cached turns.
- **Backward compatible:** Existing `systemPrompt` inline strings still work. No migration needed.
- **Multi-agent aware:** Each agent gets its own context, scoped by `contextProviders[]` and `agent_id` in memory-db.
- **Fail-safe:** Provider failures don't crash the turn. Timeout protection prevents hangs.
- **Token budget:** Prevents context from consuming the entire context window.

### Cons

- **No real-time file watching:** File changes are picked up after cache TTL expires (5 min default), not instantly. Could add `fs.watch` in a future iteration.
- **No semantic search in memory-db:** Memories are ranked by `relevance` field (manual) and recency, not by semantic similarity to the user's message. Adding embeddings would require a vector store.
- **Cache invalidation is TTL-based:** No explicit invalidation when files change or memories are added via RPC. The next turn after TTL expiry picks up changes.
- **Token estimation is rough:** Uses `chars / 4` heuristic. For precise budgets, providers should set `tokens` explicitly or integrate a tokenizer.
- **No UI for memory management:** Memory CRUD is via gateway RPC only. The TUI and web console don't have memory management screens yet.
- **SQLite native dependency:** `better-sqlite3` requires native compilation. May cause issues on some platforms or Docker images without build tools.

## Future Improvements

| Improvement | Complexity | Impact |
|-------------|-----------|--------|
| `fs.watch` for instant file reload | Low | Eliminate 5-min lag on prompt file edits |
| TUI `/memory` command for CRUD | Medium | User-friendly memory management |
| Semantic search with embeddings | High | Query-relevant memories instead of top-N |
| Context provider marketplace | Medium | Discover/install community providers |
| Per-provider token budget | Low | Fine-grained control over context composition |
| Web console memory manager | Medium | Visual CRUD for memories |
| Explicit cache invalidation on RPC | Low | `memory.add` → instant context refresh |
| Context diff logging | Low | Show what context was injected per turn (debugging) |
| Template variables in prompts | Medium | `{{agent_id}}`, `{{date}}`, `{{workspace}}` substitution |
| RAG integration provider | High | Retrieve relevant docs from vector store |

## Compatibility

- **Node.js:** ≥ 22
- **Backward compatible:** Agents without `contextProviders` work exactly as before
- **`systemPrompt` coexistence:** Inline `systemPrompt` is always injected first (priority -1, before any provider), then assembled context follows
- **Existing tests:** All 136 tests pass, zero regressions
