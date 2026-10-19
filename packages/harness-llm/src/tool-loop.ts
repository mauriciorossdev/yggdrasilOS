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
};

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
): Promise<ChatCompleteResult> {
  const params: ChatCompleteParams = {
    model: options.model,
    messages,
    tools: options.tools.length ? options.tools : undefined,
  };

  const ctx = { config: options.providerCfg };
  const useStream = options.streaming !== false && !!options.provider.chatCompleteStream;
  const started = Date.now();

  let result: ChatCompleteResult;
  if (useStream && options.provider.chatCompleteStream) {
    result = await options.provider.chatCompleteStream(ctx, params, (event: ChatStreamEvent) => {
      if (event.type === "delta" && options.onDelta) {
        options.onDelta(event.text);
      }
    });
  } else {
    result = await options.provider.chatComplete(ctx, params);
  }

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
      const approved = await options.approveTool({
        sessionKey,
        toolName: call.name,
        args,
        riskLevel: def?.riskLevel,
      });
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

  for (let i = 0; i < options.maxIterations; i++) {
    const result = await completeOnce(options, messages, i);
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
      messages.push({
        role: "assistant",
        content: result.text || "",
        tool_calls: result.toolCalls,
      });

      const parallel = options.parallelToolCalls !== false;
      let results: ToolCallResult[];

      if (parallel) {
        results = await Promise.all(
          result.toolCalls.map((call) => executeOneToolCall(call, options, options.sessionKey)),
        );
      } else {
        results = [];
        for (const call of result.toolCalls) {
          results.push(await executeOneToolCall(call, options, options.sessionKey));
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
      continue;
    }

    return {
      text: result.text || "(the model returned an empty response)",
      usage: totalUsage,
      classification: "ok",
      metadata: { model: lastModel, toolIterations: i },
      sessionAppend: withoutImageBytes(messages.slice(initialCount)),
    };
  }

  return {
    text: "Tool loop exceeded maximum iterations",
    classification: "error",
    metadata: { model: lastModel },
    sessionAppend: withoutImageBytes(messages.slice(initialCount)),
  };
}
