import type {
  ChatCompleteParams,
  ChatCompleteResult,
  ChatStreamEvent,
  ChatToolCall,
  ContentPart,
} from "@yggdrasil/sdk";

export type OpenAICompatClientOptions = {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type OpenAIMessage = {
  role: string;
  content?: string | ContentPart[] | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
};

type OpenAIChatResponse = {
  model?: string;
  choices?: Array<{
    message?: OpenAIMessage;
    finish_reason?: string;
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string };
};

function parseToolCalls(message?: OpenAIMessage): ChatToolCall[] | undefined {
  if (!message?.tool_calls?.length) return undefined;
  return message.tool_calls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
}

function mapFinishReason(reason?: string): ChatCompleteResult["finishReason"] {
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  return "stop";
}

function normalizeToolArguments(raw: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "{}";
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return "{}";
  }
}

function serializeMessages(messages: ChatCompleteParams["messages"]): OpenAIMessage[] {
  return messages.map((msg) => {
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      const textContent = typeof msg.content === "string" ? msg.content : "";
      return {
        role: "assistant",
        content: textContent.trim() ? textContent : null,
        tool_calls: msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: normalizeToolArguments(tc.arguments),
          },
        })),
      };
    }

    if (msg.role === "tool") {
      const textContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return {
        role: "tool",
        content: textContent,
        tool_call_id: msg.tool_call_id,
      };
    }

    // user/system messages support array content (multimodal)
    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

function buildRequestBody(params: ChatCompleteParams, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: serializeMessages(params.messages),
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    stream,
  };
  if (params.tools?.length) {
    body.tools = params.tools;
  }
  return body;
}

function parseChatResponse(body: OpenAIChatResponse, model: string): ChatCompleteResult {
  const choice = body.choices?.[0];
  const message = choice?.message;
  const toolCalls = parseToolCalls(message);
  const rawContent = message?.content;
  const text = typeof rawContent === "string" ? rawContent : (rawContent == null ? "" : "");
  const finishReason = mapFinishReason(choice?.finish_reason);

  if (!text && !toolCalls?.length) {
    throw new Error("OpenAI-compatible provider returned empty response");
  }

  return {
    text,
    model: body.model ?? model,
    usage: {
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens,
    },
    toolCalls,
    finishReason: toolCalls?.length ? "tool_calls" : finishReason,
  };
}

export async function chatComplete(
  options: OpenAICompatClientOptions,
  params: ChatCompleteParams,
): Promise<ChatCompleteResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const apiKey = options.apiKey?.trim();

  if (!apiKey) {
    throw new Error(
      "OpenAI-compatible provider: API key not configured (set OPENAI_API_KEY or providers.openai-compat.apiKey)",
    );
  }

  const response = await fetchFn(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(params, false)),
  });

  const body = (await response.json()) as OpenAIChatResponse;

  if (!response.ok) {
    const message = body.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`OpenAI-compatible provider error: ${message}`);
  }

  return parseChatResponse(body, params.model);
}

export async function chatCompleteStream(
  options: OpenAICompatClientOptions,
  params: ChatCompleteParams,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<ChatCompleteResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const apiKey = options.apiKey?.trim();

  if (!apiKey) {
    throw new Error(
      "OpenAI-compatible provider: API key not configured (set OPENAI_API_KEY or providers.openai-compat.apiKey)",
    );
  }

  const response = await fetchFn(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(params, true)),
  });

  if (!response.ok) {
    const body = (await response.json()) as OpenAIChatResponse;
    const message = body.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`OpenAI-compatible provider error: ${message}`);
  }

  if (!response.body) {
    throw new Error("OpenAI-compatible provider: empty stream body");
  }

  let text = "";
  let model = params.model;
  let finishReason: ChatCompleteResult["finishReason"] = "stop";
  const toolCallsAcc = new Map<number, ChatToolCall>();
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
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;

      let chunk: OpenAIChatResponse;
      try {
        chunk = JSON.parse(data) as OpenAIChatResponse;
      } catch {
        continue;
      }

      if (chunk.model) model = chunk.model;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) {
        finishReason = mapFinishReason(choice.finish_reason);
      }

      const delta = choice?.delta;
      if (delta?.content) {
        text += delta.content;
        onEvent({ type: "delta", text: delta.content });
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallsAcc.get(tc.index) ?? { id: "", name: "", arguments: "" };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCallsAcc.set(tc.index, existing);
        }
      }
    }
  }

  const toolCalls = [...toolCallsAcc.values()].filter((tc) => tc.id && tc.name);
  if (toolCalls.length) {
    onEvent({ type: "tool_calls", toolCalls });
    finishReason = "tool_calls";
  }

  const result: ChatCompleteResult = {
    text,
    model,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason,
  };

  onEvent({ type: "done", result });
  return result;
}
