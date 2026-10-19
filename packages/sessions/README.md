# @yggdrasil/sessions

## Purpose

Persists conversation history to disk (one JSON file per session) and provides the compaction/token-budgeting logic that keeps a session's history from growing without bound. This is the shared session store used by the kernel's turn pipeline, both TUI implementations, and every gateway RPC method under `sessions.*`.

Storage is a flat directory of `<sanitized-session-key>.json` files, default `~/.yggdrasil/sessions`. No database, no locking beyond "read-modify-write the whole file."

## Public API

Exported from `src/index.ts`:

- **Store** (`src/store.ts`):
  - `class SessionStore` — constructed with `(dir, maxMessages)`.
    - `get(sessionKey)`, `list()` (sorted by `updatedAt` desc), `reset(sessionKey)` (deletes the file).
    - `appendUser(sessionKey, content)`, `appendAssistant(sessionKey, content)`, `appendMessages(sessionKey, messages: ChatMessage[])`.
    - `patch(sessionKey, { title?, metadata?, agentId? })`.
    - `replaceMessages(sessionKey, messages, compaction?)` — used by compaction to swap in a summarized/truncated history and record `SessionCompactionState`.
    - `getHistory(sessionKey)` / `getHistoryBeforeLastUser(sessionKey)` — returns `ChatMessage[]` (the `@yggdrasil/sdk` wire type; strips the internal `timestamp` field).
    - Every write truncates to the last `maxMessages` entries (`truncateMessages`) before saving — this is a hard cap independent of compaction.
  - `createSessionStore(config): SessionStore` — reads `config.sessions?.dir` / `config.sessions?.maxMessages`.
  - `initSessionStore(config)` / `getSessionStore()` / `resetSessionStoreForTest()` — a process-wide singleton stashed on `globalThis` via a `Symbol.for("yggdrasil.sessionStore")` key (so it survives across module instances / dynamic imports within one process, and is easy to reset between tests).
  - `sanitizeSessionKey(key)` — replaces anything outside `[a-zA-Z0-9._-]` with `__`, used to derive the filename.
- **Compaction** (`src/compact.ts`):
  - `shouldCompact(messageCount, config)` — `messageCount >= (config.sessions?.compactThreshold ?? 40)`.
  - `compactTruncate(messages, keep)` — keep only the last `keep`.
  - `compactSummarize(messages, { keepRecent, summarize })` — replaces everything except the last `keepRecent` messages with one synthetic `system` message `"[Resumen previo] <summary>"`, where `summarize` is a caller-supplied `(ChatMessage[]) => Promise<string>` (i.e. an LLM call — this package has no model access itself).
  - `maybeCompactSession(options: MaybeCompactOptions): Promise<ChatMessage[]>` — the actual entry point callers use. If the session doesn't need compaction yet, just returns history-before-last-user. If it does, runs `compactionPolicy` (`"summarize"` if a `summarize` fn was passed and the policy config says so, else falls back to truncate — and falls back to truncate anyway if `summarize` throws), persists via `store.replaceMessages`, and returns the resulting history.
- **Token budgeting** (`src/tokens.ts`):
  - `estimateMessageTokens(msg)` / `estimateHistoryTokens(messages)` — crude `chars/4` heuristic plus fixed per-role/tool-call overhead constants (`ROLE_OVERHEAD = 4`, `TOOL_CALL_OVERHEAD = 20`). Not a real tokenizer.
  - `trimHistoryToTokenBudget(messages, maxTokens)` — drops oldest messages (keeping at least the most recent one) until the estimated total fits.
- **Types** (`src/types.ts`): `SessionMessage` (`ChatMessage & { timestamp }`), `SessionRecord`, `SessionSummary`, `SessionPatch`, `SessionCompactionState`.

## Depends on

- `@yggdrasil/config` — `YggdrasilConfig` type (`config.sessions.*`).
- `@yggdrasil/sdk` — `ChatMessage` type (the shared message shape used across providers/harness/pipeline).

## Used by

- `@yggdrasil/pipeline` (`src/turn-kernel.ts`) — the core turn loop: appends the incoming user message, calls `maybeCompactSession` to get bounded history for the model call (falling back to `getHistoryBeforeLastUser` if compaction isn't needed), then `trimHistoryToTokenBudget` against the agent's context window, and appends the assistant's reply/tool messages afterward. This is the primary consumer.
- `@yggdrasil/gateway` (`src/methods.ts`, `src/server.ts`) — implements the `sessions.list` / `sessions.get` / `sessions.patch` / `sessions.reset` / `sessions.compact` RPC methods by delegating straight to a `SessionStore`; these are what both `app-tui` and `web-console` call over WebSocket.
- `@yggdrasil/channel-tui` — `getSessionStore()` to implement its `/reset` command.
- `@yggdrasil/cli` — `initSessionStore` (on every `bootstrap()`) and `resetSessionStoreForTest` (on shutdown, oddly named but used for real shutdown cleanup too — it just clears the global singleton).

## Configuration

Root `yggdrasil.config.json`, `sessions` block:

```json
{
  "sessions": {
    "dir": "~/.yggdrasil/sessions",
    "maxMessages": 50,
    "compactThreshold": 40,
    "compactionPolicy": "summarize",
    "maxTokens": 8000
  }
}
```

- `dir` — defaults to `~/.yggdrasil/sessions` if unset.
- `maxMessages` — hard cap enforced on every save, regardless of compaction (default `50`).
- `compactThreshold` — message count at which `shouldCompact` triggers (default `40`; must be `<= maxMessages` to ever actually fire before the hard truncation does).
- `compactionPolicy` — `"summarize"` (default, requires a `summarize` callback to be passed in — otherwise silently falls back to truncate) or anything else (falls back to `compactTruncate`).
- `maxTokens` — read not here but by `@yggdrasil/pipeline`'s `turn-kernel.ts`, which calls this package's `trimHistoryToTokenBudget(history, config.sessions.maxTokens)` after compaction, before handing history to the harness. Unset by default (no trimming applied).

Related, but read by `@yggdrasil/pipeline` rather than this package: `harness.compactBeforeTurn` (default `true`) gates whether `maybeCompactSession` runs at all before each turn.

## Extending / what's safe to change

- **Swapping the compaction policy**: `maybeCompactSession` only branches on `policy === "summarize"` — everything else (including an unset/typo'd value) truncates. To add a third policy, add a branch there and a corresponding pure function alongside `compactTruncate`/`compactSummarize`. The `summarize` callback is intentionally injected by the caller (`turn-kernel.ts` passes one backed by the harness's LLM call) — this package stays model-agnostic.
- **Changing storage backend**: `SessionStore` is the only thing that touches the filesystem (`node:fs/promises`, one JSON file per session). Swapping to, say, SQLite means reimplementing this one class against the same public method signatures — nothing else in the codebase should need to change since callers only interact through `SessionStore`'s methods and the module-level singleton getters.
- **Token estimation accuracy**: `estimateMessageTokens` is a rough heuristic (chars/4), not tied to any real tokenizer/model. If you need accuracy per-provider, this is the function to replace or parameterize — right now it's provider-agnostic and deliberately cheap.
- The singleton pattern (`globalThis` + `Symbol.for`) means only one `SessionStore` (one `dir`/`maxMessages` config) is active per process. If you need multiple stores in one process (e.g. multi-tenant), you'll need to move away from `initSessionStore`/`getSessionStore()` and pass `SessionStore` instances explicitly (the constructor already supports this — `turn-kernel.ts`'s `sessionStore` option shows the pattern).
