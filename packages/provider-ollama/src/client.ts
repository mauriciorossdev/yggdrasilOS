import type {
  ChatCompleteParams,
  ChatCompleteResult,
  ChatStreamEvent,
} from "@yggdrasil/sdk";
import {
  toOllamaMessages,
  toOllamaTools,
  fromOllamaToolCalls,
  parseFallbackToolCalls,
  type OllamaToolCall,
} from "./messages.js";

export type OllamaClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

type OllamaChatResponse = {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
};

type OllamaTagsResponse = {
  models: Array<{
    name: string;
    model: string;
    size: number;
  }>;
};

// A plain fetch() has no timeout — pointed at a dropped/unreachable host
// (dead LAN IP, wrong port, firewall silently discarding packets) it can
// hang far longer than any UI should wait just to list models. Bounded to
// fail fast; chatComplete/chatCompleteStream deliberately don't get this —
// a real inference call legitimately can take a while.
const LIST_MODELS_TIMEOUT_MS = 5_000;

export async function listModels(options: OllamaClientOptions): Promise<OllamaTagsResponse> {
  const fetchFn = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetchFn(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS) });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "unreachable";
    throw new Error(`Ollama at ${baseUrl} is ${reason}`);
  }
  if (!response.ok) {
    throw new Error(`Ollama listModels failed: HTTP ${response.status}`);
  }
  return (await response.json()) as OllamaTagsResponse;
}

export async function chatComplete(
  options: OllamaClientOptions,
  params: ChatCompleteParams,
): Promise<ChatCompleteResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  const body: Record<string, unknown> = {
    model: params.model,
    messages: toOllamaMessages(params.messages),
    stream: false,
  };

  const tools = toOllamaTools(params.tools);
  if (tools) body.tools = tools;
  if (params.temperature !== undefined) body.options = { temperature: params.temperature };

  const response = await fetchFn(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama chat error: HTTP ${response.status} — ${text}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  let toolCalls = fromOllamaToolCalls(data.message.tool_calls);
  let text = data.message.content ?? "";

  if (!toolCalls?.length && tools) {
    const fallback = parseFallbackToolCalls(text);
    if (fallback?.length) {
      toolCalls = fallback;
      text = "";
    }
  }

  return {
    text,
    model: data.model,
    usage: {
      inputTokens: data.prompt_eval_count,
      outputTokens: data.eval_count,
    },
    toolCalls,
    finishReason: toolCalls?.length ? "tool_calls" : "stop",
  };
}

export async function chatCompleteStream(
  options: OllamaClientOptions,
  params: ChatCompleteParams,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<ChatCompleteResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  const body: Record<string, unknown> = {
    model: params.model,
    messages: toOllamaMessages(params.messages),
    stream: true,
  };

  const tools = toOllamaTools(params.tools);
  if (tools) body.tools = tools;
  if (params.temperature !== undefined) body.options = { temperature: params.temperature };

  const response = await fetchFn(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama chat stream error: HTTP ${response.status} — ${text}`);
  }

  if (!response.body) {
    throw new Error("Ollama: empty stream body");
  }

  let text = "";
  let model = params.model;
  let toolCalls: ReturnType<typeof fromOllamaToolCalls>;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  // Some models emit tool calls as plain JSON content instead of using
  // Ollama's structured tool_calls field (see parseFallbackToolCalls). We
  // can't know a chunk is part of a tool call until enough of it has arrived,
  // so hold back emitting deltas until the first non-whitespace character
  // tells us whether this looks like a tool call attempt or normal prose.
  let pending = "";
  let holdingForToolCall: boolean | undefined;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let chunk: OllamaChatResponse;
      try {
        chunk = JSON.parse(trimmed) as OllamaChatResponse;
      } catch {
        continue;
      }

      if (chunk.model) model = chunk.model;

      if (chunk.message?.content) {
        text += chunk.message.content;

        if (!tools || holdingForToolCall === false) {
          onEvent({ type: "delta", text: chunk.message.content });
        } else {
          pending += chunk.message.content;
          if (holdingForToolCall === undefined) {
            const leading = pending.trimStart();
            if (leading.length > 0) {
              holdingForToolCall = leading[0] === "{" || leading[0] === "<";
              if (!holdingForToolCall) {
                onEvent({ type: "delta", text: pending });
                pending = "";
              }
            }
          }
        }
      }

      if (chunk.message?.tool_calls) {
        toolCalls = fromOllamaToolCalls(chunk.message.tool_calls);
      }

      if (chunk.done) {
        inputTokens = chunk.prompt_eval_count;
        outputTokens = chunk.eval_count;
      }
    }
  }

  if (!toolCalls?.length && tools && pending) {
    const fallback = parseFallbackToolCalls(pending);
    if (fallback?.length) {
      toolCalls = fallback;
      text = text.slice(0, text.length - pending.length);
      pending = "";
    }
  }

  if (pending) {
    onEvent({ type: "delta", text: pending });
  }

  if (toolCalls?.length) {
    onEvent({ type: "tool_calls", toolCalls });
  }

  const result: ChatCompleteResult = {
    text,
    model,
    usage: { inputTokens, outputTokens },
    toolCalls,
    finishReason: toolCalls?.length ? "tool_calls" : "stop",
  };

  onEvent({ type: "done", result });
  return result;
}
