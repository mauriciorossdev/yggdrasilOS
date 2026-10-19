# Advanced Agent Features (Iteración 7)

## Tool Approval

Tools can be marked as requiring user approval before execution.

### Defining a tool with approval

```typescript
import { defineTool } from "@yggdrasil/tools-sdk";

const dangerousTool = defineTool({
  name: "delete_file",
  description: "Delete a file from the filesystem",
  riskLevel: "destructive", // "safe" | "moderate" | "destructive"
  // requiresApproval is automatically set to true for "destructive" tools
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async execute(_ctx, args) {
    // your implementation
  },
});
```

### Risk levels

| Level | `requiresApproval` | Description |
|-------|-------------------|-------------|
| `safe` | false (default) | No side effects |
| `moderate` | false (default) | Minor side effects |
| `destructive` | true (auto) | Irreversible actions |

### Configuration

```json
{
  "harness": {
    "toolApproval": "destructive-only"
  }
}
```

Options: `"always"` | `"destructive-only"` (default) | `"never"`

### TUI approval

When running in TUI mode, destructive tools prompt:

```
⚠ Approve tool delete_file with {"path":"/tmp/test"}? [y/N]
```

Timeout: 60 seconds → auto-deny.

### Gateway approval (WebSocket)

1. Client receives `tool.approval.requested` event:
   ```json
   { "type": "event", "event": "tool.approval.requested", "payload": {
     "requestId": "uuid", "sessionKey": "...", "toolName": "delete_file", "args": {...}
   }}
   ```

2. Client responds via RPC:
   ```json
   { "method": "tools.approve", "params": { "requestId": "uuid", "approved": true } }
   ```

3. Client receives `tool.approval.resolved` event.

---

## Parallel Tool Execution

When the LLM returns multiple `tool_calls` in a single response, they execute in parallel via `Promise.all`.

### Configuration

```json
{
  "harness": {
    "parallelToolCalls": true
  }
}
```

Set to `false` for sequential execution (useful for tools with side-effect ordering).

---

## Multi-Agent

Configure multiple agents with different providers, models, and system prompts.

### Configuration

```json
{
  "defaultAgent": "default",
  "agents": [
    { "id": "default", "provider": "openai-compat", "model": "gpt-4o-mini" },
    {
      "id": "coder",
      "provider": "ollama",
      "model": "codellama",
      "harness": "llm",
      "systemPrompt": "You are a coding assistant. Respond only with code."
    }
  ]
}
```

### Usage

**TUI:** `/agent coder` switches the active agent for the session.

**Gateway RPC:**
```json
{ "method": "chat.send", "params": { "message": "...", "agentId": "coder" } }
```

**`agents.list` RPC** returns all configured agents with truncated `systemPrompt`.

### Agent fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier |
| `label` | no | Display name |
| `provider` | no | Provider ID |
| `model` | no | Model ID |
| `harness` | no | Pin a specific harness (bypasses auto-selection) |
| `systemPrompt` | no | Prepended to history as system message |

---

## Provider Ollama (Native)

Native Ollama provider using `/api/chat` instead of OpenAI-compatible `/v1/chat/completions`.

### Configuration

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434",
      "defaultModel": "llama3.2"
    }
  },
  "agents": [
    { "id": "local", "provider": "ollama", "model": "llama3.2" }
  ]
}
```

### Differences from openai-compat

| Aspect | openai-compat | ollama (native) |
|--------|--------------|-----------------|
| Endpoint | `/v1/chat/completions` | `/api/chat` |
| Stream format | SSE | NDJSON |
| Auth | Bearer API key | No key (local) |
| Model discovery | Static list | `GET /api/tags` |

---

## Tracing Events

Events emitted via WebSocket during a turn:

| Event | When | Payload |
|-------|------|---------|
| `turn.start` | Turn begins | `{ sessionKey, agentId, harnessId, messagePreview }` |
| `turn.end` | Turn completes | `{ sessionKey, harnessId, classification, durationMs }` |
| `tool.execute` | After each tool | `{ name, durationMs, ok }` |
| `provider.latency` | After each LLM call | `{ model, durationMs, iteration }` |

### Monitoring with websocat

```bash
websocat ws://127.0.0.1:18789
```

### Turn history RPC

```json
{ "method": "turns.recent" }
```

Returns the last 50 turns (in-memory ring buffer).

---

## Harness Planner Pattern (Iteración 8)

A routing harness can delegate to different sub-harnesses based on `runtime` metadata. Example pattern:

```typescript
const plannerHarness: AgentHarness = {
  id: "planner",
  label: "Planner",
  supports(ctx) {
    return ctx.runtime === "plan"
      ? { supported: true, priority: 200 }
      : { supported: false };
  },
  async runAttempt(params) {
    return { text: `Plan for: ${params.message}`, classification: "ok" };
  },
};
```

Usage: set `"harness": "planner"` in agent config, or extend for sub-agent routing in future iterations.
