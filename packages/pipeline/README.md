# @yggdrasil/pipeline

## Purpose

Pipeline is where one inbound chat message becomes one outbound reply. It is the orchestration layer that
sits between a channel (which only knows how to receive/send text) and a harness/provider (which only
knows how to run one LLM attempt): it resolves which agent and harness handle the message, loads and
compacts session history, assembles context-provider blocks, runs the harness attempt (with an echo-harness
fallback if the primary harness reports `"fallback"`), persists the resulting messages back to the session
store, emits lifecycle events (`turn.start`/`turn.end`), and delivers the final text back out through the
channel's outbound adapter. Everything in `packages/gateway` that handles a chat turn — the WebSocket
`chat.send` method and each channel's inbound callback — calls into this package rather than reimplementing
turn logic.

## Public API

`packages/pipeline/src/index.ts` re-exports from `turn-kernel.ts` (the package's only source file besides tests):

- `runChannelTurn(params: RunChannelTurnParams): Promise<RunChannelTurnResult>` — the main entry point.
  Decides admission (`"dispatch" | "observeOnly" | "drop"`, defaulting to `"drop"` for empty message bodies),
  and for `"dispatch"` runs a full turn via `ReplyDispatcher` and delivers the reply to the originating
  channel. Returns `{admission, replyText?, sessionKey, harnessId?, usage?}`.
- `ReplyDispatcher` — class doing the actual work; construct with `ReplyDispatcherOptions` (`config`,
  `workspaceRoot?`, `sessionStore?`, `onBlock?` streaming callback, `approveTool?`, `events?`). Two methods:
  - `dispatchToHarness(message)` — resolves the agent (`resolveAgent`), loads/compacts session history,
    prepends `agent.systemPrompt` and any assembled context-provider blocks, selects a harness (pinned via
    `agent.harness`, or `selectHarness` from `@yggdrasil/harness-runtime`), runs `harness.runAttempt`, falls
    back to the built-in echo harness if the result is classified `"fallback"`, appends the turn to the
    session store, and emits `turn.start`/`turn.end` on the event bus. Returns `DispatchResult`
    (`{replyText, harnessId, sessionKey, usage?}`).
  - `deliverToChannel(channelId, accountId, sessionKey, text)` — looks up the channel via `getChannel` and
    calls its `outbound.sendFinal` (preferred) or `outbound.sendText`.
- `ingestInboundMessage(message)` — normalizes a raw `NormalizedInboundMessage`: trims `body`, fills in
  `timestamp` if missing. Called by channel adapters before handing a message to `runChannelTurn`.
- `getChannelForMessage(channelId)` — thin re-export of `@yggdrasil/kernel`'s `getChannel`.
- `compactSessionNow(options: CompactSessionNowOptions): Promise<CompactSessionNowResult>` — forces
  compaction of a session's message history outside the normal turn flow (used by the gateway's
  `sessions.compact` RPC method). Uses `compactSummarize` (LLM-based, via a summarize function built from
  the agent's configured provider) if `config.sessions.compactionPolicy === "summarize"` and a provider is
  available, otherwise falls back to `compactTruncate`.
- Types: `RunChannelTurnParams`, `RunChannelTurnResult`, `DispatchResult`, `CompactSessionNowOptions`,
  `CompactSessionNowResult`, `ReplyDispatcherOptions`.

## Depends on

- **`@yggdrasil/config`** — `resolveAgent`, `resolveProviderConfig`, and the `YggdrasilConfig`/`AgentConfig` types.
- **`@yggdrasil/kernel`** — `getChannel`, `getHarness`, `getProvider`: pipeline never imports a plugin
  directly, it always looks it up through the kernel registry by id.
- **`@yggdrasil/sdk`** — the shared contract types it moves data through: `ChannelPlugin`,
  `ChannelTurnAdmission`, `ChatMessage`, `EventBus`, `NormalizedInboundMessage`, `OutboundContext`,
  `OutboundFinal`, `ToolApprovalHandler`.
- **`@yggdrasil/harness-runtime`** — `selectHarness` (priority-based harness selection when no harness is
  pinned on the agent), `BUILTIN_ECHO_HARNESS_ID`, `createEchoHarness` (the fallback harness used when a
  harness attempt classifies as `"fallback"`).
- **`@yggdrasil/sessions`** — `getSessionStore`, `maybeCompactSession`, `trimHistoryToTokenBudget`,
  `compactSummarize`, `compactTruncate`, and the `SessionStore`/`SessionMessage` types — all session
  history persistence and compaction logic lives there, pipeline just calls it at the right points in a turn.
- **`@yggdrasil/context-runtime`** — `resolveContext`, to assemble context-provider blocks (project files,
  prompt files, memory, etc.) that get prepended to the LLM history for a turn.
- **`@yggdrasil/provider-openai-compat`** — only `OPENAI_COMPAT_PROVIDER_ID`, used as the default provider id
  when building the session-compaction summarize function if an agent has no explicit provider.

## Used by

- **`packages/gateway/src/channel-manager.ts`** — `ingestInboundMessage` + `runChannelTurn` inside each
  channel account's `onInbound` callback; this is how a message from TUI/HTTP/Telegram etc. actually gets
  turned into a reply.
- **`packages/gateway/src/methods.ts`** — same two functions inside the `chat.send` gateway RPC method
  (direct chat over the WebSocket API, not through a channel), plus `compactSessionNow` for the
  `sessions.compact` RPC method.

No other package in the monorepo imports `@yggdrasil/pipeline` — it is gateway-only; channels themselves
never call it directly (they hand messages to the gateway's `ChannelManager`, which calls pipeline).

## Configuration

Reads (via the `YggdrasilConfig` passed into `runChannelTurn`/`ReplyDispatcher`):
- `harness.compactBeforeTurn` — whether to compact session history before each turn (default true).
- `sessions.maxTokens` — trims history to this token budget after compaction/loading.
- `sessions.compactionPolicy` — `"truncate" | "summarize"`, used by `compactSessionNow`.
- `sessions.maxMessages` — used to compute how many recent messages to keep on forced compaction.
- `context.defaultProviders`, `context.tokenBudget` — used when an agent doesn't specify its own
  `contextProviders`.
- `agents[].systemPrompt`, `agents[].harness`, `agents[].provider`, `agents[].model`,
  `agents[].contextProviders` — per-agent turn behavior, read via `resolveAgent`.
- `pluginConfig[providerId]` — passed to `resolveContext` as the first context provider's config.

## Extending / what's safe to change

- **This is the one place a "turn" is defined** — if you need to change what happens between "message
  received" and "reply sent" (new step, new event, new ordering of context vs. history), it happens in
  `ReplyDispatcher.dispatchToHarness`. Changes ripple into both gateway call sites (`channel-manager.ts` and
  `methods.ts`) and into `test/helpers/createTestPlatform` / the e2e test suite, since those exercise
  `runChannelTurn` directly.
- **The fallback-to-echo behavior** (`result.classification === "fallback"` triggers a second attempt with
  `createEchoHarness()`) is a deliberate safety net so a broken/unreachable provider degrades to an echo
  reply instead of throwing all the way up to the channel. If you add a new `HarnessResultClassification`
  value, decide explicitly whether it should also trigger this fallback path.
- **Context assembly ordering**: context-provider blocks are prepended to history, replacing an existing
  leading `system` message's position but not the message itself (see the `history[0].role === "system"`
  branch) — this is easy to get subtly wrong if you touch it; there are no dedicated tests for the ordering
  branch itself, only integration coverage through `multi-agent.test.ts`.
- Adding a new agent-level knob (e.g. a new field on `AgentConfig`) requires updating `@yggdrasil/config`
  first, then reading it here in `dispatchToHarness`.
- Safe to change in isolation: the Spanish-language compaction summarization prompt string in
  `createSummarizeFn` (`"Resume esta conversación..."`) — it's just the instruction sent to the LLM for
  summarizing old messages, has no structural coupling elsewhere.
