import type {
  ChatCompleteParams,
  ChatCompleteResult,
  ChatMessage,
  ChatStreamEvent,
  ChatToolDefinition,
  ChatToolCall,
  ProviderPlugin,
  ToolApprovalHandler,
  ContentPart,
} from "@yggdrasil/sdk";
import type { HarnessAttemptResult } from "@yggdrasil/sdk";
import type { AgentToolDefinition, ApprovalMode } from "@yggdrasil/tools-sdk";
import {
  callSignature,
  looksUnfinished,
  MAX_ACTION_NUDGES,
  MAX_EMPTY_RETRIES,
  MAX_REFUSED_REPEATS,
  NUDGES,
  repeatRefusal,
  resolveGuards,
  trailingRepeats,
  type LoopGuards,
} from "./loop-guards.js";

export type ToolExecuteEvent = {
  name: string;
  durationMs: number;
  ok: boolean;
  // Args the call actually ran with, and either the stringified result or
  // the error message — same content that goes into the tool-role message
  // pushed to history, surfaced here too so a listener (gateway's
  // "tool.execute" event, ultimately the chat UI) doesn't need to
  // reconstruct it. Optional so the one-shot {name,durationMs,ok} shape
  // existing callers rely on keeps working untouched.
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  /** Set only for a tool result that hit the __ygg_image__ sentinel below — lets a listener (gateway's "tool.execute" event, ultimately the chat UI) render the actual image instead of just the "[Image loaded]" placeholder text in `result`. */
  image?: { base64: string; mimeType: string; path?: string };
};

export type ProviderLatencyEvent = {
  model: string;
  durationMs: number;
  iteration: number;
};

export type ToolLoopOptions = {
  provider: ProviderPlugin;
  providerCfg: unknown;
  model: string;
  sessionKey: string;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  maxIterations: number;
  streaming?: boolean;
  parallelToolCalls?: boolean;
  onDelta?: (text: string) => void;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  approveTool?: ToolApprovalHandler;
  getToolDefinition?: (name: string) => AgentToolDefinition | undefined;
  onToolExecute?: (event: ToolExecuteEvent) => void;
  onProviderLatency?: (event: ProviderLatencyEvent) => void;
  /**
   * Per-session tool-approval mode — "auto" (default, undefined behaves the
   * same) asks only for moderate/destructive calls; "plan" auto-denies any
   * risky call instead of asking (read-only investigation, no human
   * interruption); "restrict" asks for every call including ones a tool
   * itself marks safe; "yolo" never asks, even for destructive calls.
   */
  approvalMode?: ApprovalMode;
  /** Cancels the turn: no new model call or tool call starts once aborted, and waits on the provider / an approval prompt are abandoned. */
  signal?: AbortSignal;
  /** Safety nets for models that stall (see loop-guards.ts). On by default; `false` restores the bare loop. */
  guards?: boolean | Partial<LoopGuards>;
  /** Told whenever a guard steps in, so the gateway can surface it (event "loop.guard"). */
  onGuard?: (event: { kind: GuardKind; detail?: string }) => void;
  /** The provider is waiting to retry a failed request (rate limit, 5xx, dropped connection). */
  onProviderRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
};

export type GuardKind = "empty-retry" | "action-nudge" | "repeat-refused" | "limit-summary" | "stuck-summary";

const CANCELLED = Symbol("cancelled");

/** Resolves with `value`, or with CANCELLED as soon as the signal fires (never rejects for the abort itself). */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof CANCELLED> {
  if (!signal) return promise;
  if (signal.aborted) {
    // The abandoned promise may still reject later; don't leave it unhandled.
    promise.catch(() => {});
    return Promise.resolve(CANCELLED);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => {});
      resolve(CANCELLED);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function completeOnce(
  options: ToolLoopOptions,
  messages: ChatMessage[],
  iteration: number,
): Promise<ChatCompleteResult | typeof CANCELLED> {
  const params: ChatCompleteParams = {
    model: options.model,
    messages,
    tools: options.tools.length ? options.tools : undefined,
    signal: options.signal,
    onRetry: options.onProviderRetry,
  };

  const ctx = { config: options.providerCfg };
  const useStream = options.streaming !== false && !!options.provider.chatCompleteStream;
  const started = Date.now();

  let result: ChatCompleteResult | typeof CANCELLED;
  if (useStream && options.provider.chatCompleteStream) {
    result = await raceAbort(
      options.provider.chatCompleteStream(ctx, params, (event: ChatStreamEvent) => {
        // Text that arrives after a cancel is dropped, not shown.
        if (event.type === "delta" && options.onDelta && !options.signal?.aborted) {
          options.onDelta(event.text);
        }
      }),
      options.signal,
    );
  } else {
    result = await raceAbort(options.provider.chatComplete(ctx, params), options.signal);
  }
  if (result === CANCELLED) return CANCELLED;

  options.onProviderLatency?.({
    model: result.model,
    durationMs: Date.now() - started,
    iteration,
  });

  return result;
}

/**
 * What gets saved to the session: images are shown to the model during the turn
 * only. Persisting the base64 would bloat the session file and re-send the same
 * picture (thousands of tokens) with every later turn; the text part naming the
 * file stays, so the model can open it again with the tool if it needs to.
 */
export function withoutImageBytes(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role !== "user" || typeof m.content === "string") return m;
    if (!m.content.some((p) => p.type === "image_url")) return m;
    const kept = m.content.filter((p) => p.type !== "image_url");
    return { ...m, content: kept.length ? kept : [{ type: "text", text: "[image omitted from history]" }] };
  });
}

type ImageSentinel = {
  __ygg_image__: true;
  base64: string;
  mimeType: string;
  path?: string;
};

function isImageSentinel(output: unknown): output is ImageSentinel {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as Record<string, unknown>).__ygg_image__ === true
  );
}

type ToolCallResult = {
  call: ChatToolCall;
  content: string;
  imagePart?: ContentPart[];
};

async function executeOneToolCall(
  call: ChatToolCall,
  options: ToolLoopOptions,
  sessionKey: string,
): Promise<ToolCallResult> {
  const started = Date.now();
  let content: string;
  let ok = true;
  // Declared outside the try so the final onToolExecute call (which runs
  // whether or not executeTool threw) can still report what args this call
  // actually ran with.
  let args: Record<string, unknown> = {};

  try {
    args = parseToolArgs(call.arguments);
    const def = options.getToolDefinition?.(call.name);
    // A tool with assessRisk owns its risk decision entirely, based on the
    // actual call args (e.g. shell_exec allowlisting specific safe commands).
    // Tools without it keep the static riskLevel/requiresApproval check.
    const risky = def?.assessRisk
      ? def.assessRisk(args) !== "safe"
      : def?.requiresApproval === true || def?.riskLevel === "moderate" || def?.riskLevel === "destructive";

    const mode = options.approvalMode ?? "auto";
    const decision: "run" | "ask" | "auto-deny" =
      mode === "yolo"
        ? "run"
        : mode === "restrict"
          ? "ask"
          : mode === "plan"
            ? risky
              ? "auto-deny"
              : "run"
            : risky
              ? "ask"
              : "run"; // auto

    if (decision === "auto-deny") {
      content = `Error: tool execution blocked — plan mode is read-only investigation; "${call.name}" would require approval (risk: ${def?.riskLevel ?? "unknown"}). Investigate further and present a plan instead of attempting to act.`;
      options.onToolExecute?.({ name: call.name, durationMs: Date.now() - started, ok: false, args, error: content });
      return { call, content };
    }

    if (decision === "ask" && options.approveTool) {
      const answer = await raceAbort(
        options.approveTool({
          sessionKey,
          toolName: call.name,
          args,
          riskLevel: def?.riskLevel,
        }),
        options.signal,
      );
      // Cancelling while an approval prompt is open counts as a denial.
      const approved = answer !== CANCELLED && answer;
      if (!approved) {
        content = "Error: tool execution denied by user";
        options.onToolExecute?.({ name: call.name, durationMs: Date.now() - started, ok: false, args, error: content });
        return { call, content };
      }
    }

    const output = await options.executeTool(call.name, args);
    if (isImageSentinel(output)) {
      const dataUrl = `data:${output.mimeType};base64,${output.base64}`;
      content = output.path ? `[Image loaded: ${output.path}]` : "[Image loaded]";
      const imagePart: ContentPart[] = [
        { type: "text", text: `Tool ${call.name} returned an image${output.path ? ` (${output.path})` : ""}. Describe what you see.` },
        { type: "image_url", image_url: { url: dataUrl } },
      ];
      options.onToolExecute?.({
        name: call.name,
        durationMs: Date.now() - started,
        ok: true,
        args,
        result: content,
        image: { base64: output.base64, mimeType: output.mimeType, path: output.path },
      });
      return { call, content, imagePart };
    }
    content = typeof output === "string" ? output : JSON.stringify(output);
  } catch (err) {
    ok = false;
    content = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  options.onToolExecute?.({
    name: call.name,
    durationMs: Date.now() - started,
    ok,
    args,
    ...(ok ? { result: content } : { error: content }),
  });
  return { call, content };
}

type CacheKey = "cacheReadTokens" | "cacheWriteTokens";

function sumOptional(
  total: HarnessAttemptResult["usage"],
  next: NonNullable<HarnessAttemptResult["usage"]>,
  key: CacheKey,
): Partial<Record<CacheKey, number>> {
  if (total?.[key] === undefined && next[key] === undefined) return {};
  return { [key]: (total?.[key] ?? 0) + (next[key] ?? 0) };
}

export async function runToolLoop(options: ToolLoopOptions): Promise<HarnessAttemptResult> {
  const messages = [...options.messages];
  const initialCount = messages.length;
  let lastModel = options.model;
  let totalUsage: HarnessAttemptResult["usage"];

  // Text streamed so far this turn — kept as the reply if the user cancels midway.
  let streamed = "";
  const baseOnDelta = options.onDelta;
  options = {
    ...options,
    onDelta: baseOnDelta
      ? (text) => {
          streamed += text;
          baseOnDelta(text);
        }
      : undefined,
  };

  const cancelled = (): HarnessAttemptResult => ({
    text: streamed.trim() ? `${streamed.trimEnd()}\n\n(cancelled)` : "(cancelled)",
    usage: totalUsage,
    classification: "cancelled",
    metadata: { model: lastModel },
    sessionAppend: persisted(),
  });

  const guards = resolveGuards(options.guards);
  // Nudges steer the model during this turn only; they never reach the saved session.
  const ephemeral = new Set<ChatMessage>();
  const nudge = (text: string) => {
    const message: ChatMessage = { role: "user", content: text };
    ephemeral.add(message);
    messages.push(message);
  };
  const persisted = () => withoutImageBytes(messages.slice(initialCount).filter((m) => !ephemeral.has(m)));
  let emptyRetries = 0;
  let actionNudges = 0;
  let refusedRepeats = 0;
  const callHistory: string[] = [];

  /** One last call with no tools, asking the model to say where things stand — instead of a bare error. */
  const summarize = async (reason: "limit" | "stuck"): Promise<HarnessAttemptResult> => {
    options.onGuard?.({ kind: reason === "limit" ? "limit-summary" : "stuck-summary" });
    const base = reason === "limit" ? "Tool loop exceeded maximum iterations" : "Stopped: the model kept repeating the same tool call";
    if (guards.summarizeOnLimit && !options.signal?.aborted) {
      nudge(reason === "limit" ? NUDGES.limit : NUDGES.stuck);
      try {
        const summary = await completeOnce({ ...options, tools: [] }, messages, options.maxIterations);
        if (summary !== CANCELLED && summary.text.trim()) {
          return {
            text: `${summary.text.trim()}\n\n(${base}.)`,
            usage: totalUsage,
            classification: "error",
            metadata: { model: lastModel, stopped: reason },
            sessionAppend: persisted(),
          };
        }
      } catch {
        // fall through to the bare message
      }
    }
    return { text: `${base}.`, classification: "error", usage: totalUsage, metadata: { model: lastModel, stopped: reason }, sessionAppend: persisted() };
  };

  for (let i = 0; i < options.maxIterations; i++) {
    if (options.signal?.aborted) return cancelled();
    const result = await completeOnce(options, messages, i);
    if (result === CANCELLED) return cancelled();
    lastModel = result.model;
    if (result.usage) {
      totalUsage = {
        inputTokens: (totalUsage?.inputTokens ?? 0) + (result.usage.inputTokens ?? 0),
        outputTokens: (totalUsage?.outputTokens ?? 0) + (result.usage.outputTokens ?? 0),
        // Prompt-cache counters stay absent for providers that don't report them.
        ...sumOptional(totalUsage, result.usage, "cacheReadTokens"),
        ...sumOptional(totalUsage, result.usage, "cacheWriteTokens"),
      };
    }

    if (result.finishReason === "tool_calls" && result.toolCalls?.length) {
      // Checked before the assistant tool_calls message is stored so history never
      // holds tool calls that have no matching tool results.
      if (options.signal?.aborted) return cancelled();
      messages.push({
        role: "assistant",
        content: result.text || "",
        tool_calls: result.toolCalls,
      });

      // A call identical to the last few is refused (the model sees why) rather than run again.
      const runOrRefuse = (call: ChatToolCall): Promise<ToolCallResult> => {
        const signature = callSignature(call.name, call.arguments);
        const count = trailingRepeats(callHistory, signature);
        callHistory.push(signature);
        if (guards.repeatLimit > 0 && count > guards.repeatLimit) {
          refusedRepeats++;
          const content = repeatRefusal(call.name, count - 1);
          options.onGuard?.({ kind: "repeat-refused", detail: call.name });
          options.onToolExecute?.({ name: call.name, durationMs: 0, ok: false, args: parseToolArgs(call.arguments), error: content });
          return Promise.resolve({ call, content });
        }
        return executeOneToolCall(call, options, options.sessionKey);
      };

      const parallel = options.parallelToolCalls !== false;
      let results: ToolCallResult[];

      if (parallel) {
        // Signatures are recorded in call order before anything runs, so the check is deterministic.
        results = await Promise.all(result.toolCalls.map((call) => runOrRefuse(call)));
      } else {
        results = [];
        for (const call of result.toolCalls) {
          if (options.signal?.aborted) {
            results.push({ call, content: "Error: cancelled by the user" });
            continue;
          }
          results.push(await runOrRefuse(call));
        }
      }

      for (const { call, content, imagePart } of results) {
        messages.push({
          role: "tool",
          content,
          tool_call_id: call.id,
          name: call.name,
        });
        if (imagePart) {
          messages.push({ role: "user", content: imagePart });
        }
      }
      if (refusedRepeats > MAX_REFUSED_REPEATS) return summarize("stuck");
      continue;
    }

    const text = result.text.trim();

    // Nothing at all: one more try with a nudge (the empty reply itself is not stored).
    if (!text && guards.retryEmpty && emptyRetries < MAX_EMPTY_RETRIES) {
      emptyRetries++;
      options.onGuard?.({ kind: "empty-retry" });
      nudge(NUDGES.empty);
      // No tool ran, so a retry must not eat into the turn's tool-call iterations.
      i--;
      continue;
    }

    // "I will run X:" and then the turn ends. Keep what it said (it is real output), then push it to act.
    if (text && guards.nudgeUnannounced && options.tools.length > 0 && actionNudges < MAX_ACTION_NUDGES && looksUnfinished(text)) {
      actionNudges++;
      options.onGuard?.({ kind: "action-nudge" });
      messages.push({ role: "assistant", content: result.text });
      nudge(NUDGES.unannounced);
      continue;
    }

    return {
      text: result.text || "(the model returned an empty response)",
      usage: totalUsage,
      classification: "ok",
      metadata: { model: lastModel, toolIterations: i },
      sessionAppend: persisted(),
    };
  }

  return summarize("limit");
}
