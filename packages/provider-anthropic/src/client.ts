import type {
  ChatCompleteParams,
  ChatCompleteResult,
  ChatMessage,
  ChatStreamEvent,
  ChatToolCall,
  ContentPart,
} from "@yggdrasil/sdk";

export type AnthropicClientOptions = {
  baseUrl: string;
  apiKey?: string;
  apiVersion?: string;
  /** Mark tools, system prompt and the conversation prefix for Anthropic's prompt cache. Default true. */
  promptCaching?: boolean;
  fetchImpl?: typeof fetch;
};

const DEFAULT_API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicImageBlock = {
  type: "image";
  source:
    | { type: "base64"; media_type: string; data: string }
    | { type: "url"; url: string };
};
type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};
type AnthropicBlock = (
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
) & { cache_control?: { type: "ephemeral" } };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
};

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type AnthropicResponse = {
  model?: string;
  content?: AnthropicBlock[];
  stop_reason?: string;
  usage?: AnthropicUsage;
  error?: { message?: string };
};

type AnthropicStreamEvent = {
  type: string;
  message?: AnthropicResponse;
  index?: number;
  content_block?: AnthropicBlock;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: AnthropicUsage;
  error?: { message?: string };
};

function parseToolArguments(raw: string): unknown {
  const trimmed = raw?.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

function contentToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function partToBlock(part: ContentPart): AnthropicBlock {
  if (part.type === "text") return { type: "text", text: part.text };
  const url = part.image_url.url;
  const dataUrl = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (dataUrl) {
    return { type: "image", source: { type: "base64", media_type: dataUrl[1]!, data: dataUrl[2]! } };
  }
  return { type: "image", source: { type: "url", url } };
}

function userBlocks(content: ChatMessage["content"]): string | AnthropicBlock[] {
  if (typeof content === "string") return content;
  return content.map(partToBlock);
}

/** Anthropic takes `system` outside `messages`, and wants tool results as
 *  `tool_result` blocks inside a user turn — consecutive ones must share a turn. */
export function serializeMessages(messages: ChatMessage[]): {
  system?: string;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];

  const pushUserBlocks = (blocks: AnthropicBlock[]) => {
    const last = out[out.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) {
      last.content.push(...blocks);
    } else if (last?.role === "user" && typeof last.content === "string") {
      out[out.length - 1] = {
        role: "user",
        content: [{ type: "text", text: last.content }, ...blocks],
      };
    } else {
      out.push({ role: "user", content: blocks });
    }
  };

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = contentToText(msg.content).trim();
      if (text) systemParts.push(text);
      continue;
    }

    if (msg.role === "tool") {
      pushUserBlocks([
        {
          type: "tool_result",
          tool_use_id: msg.tool_call_id ?? "",
          content: contentToText(msg.content),
        },
      ]);
      continue;
    }

    if (msg.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      const text = contentToText(msg.content);
      if (text.trim()) blocks.push({ type: "text", text });
      for (const tc of msg.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: parseToolArguments(tc.arguments),
        });
      }
      if (blocks.length === 0) continue;
      out.push({ role: "assistant", content: blocks });
      continue;
    }

    const content = userBlocks(msg.content);
    const last = out[out.length - 1];
    if (last?.role === "user") {
      const blocks = typeof content === "string" ? [{ type: "text", text: content } as AnthropicBlock] : content;
      pushUserBlocks(blocks);
    } else {
      out.push({ role: "user", content });
    }
  }

  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages: out,
  };
}

const CACHE_CONTROL = { type: "ephemeral" } as const;

/** Attaches a cache breakpoint to the last content block of the last message. */
function markLastMessageForCache(messages: AnthropicMessage[]): AnthropicMessage[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  const blocks: AnthropicBlock[] =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  const tail = blocks[blocks.length - 1];
  if (!tail) return messages;
  blocks[blocks.length - 1] = { ...tail, cache_control: CACHE_CONTROL };
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

function buildRequestBody(
  params: ChatCompleteParams,
  stream: boolean,
  promptCaching = true,
): Record<string, unknown> {
  const { system, messages } = serializeMessages(params.messages);
  // Cache order is tools -> system -> messages; up to 3 of Anthropic's 4
  // breakpoints are used so the tool schemas + system prompt (identical on
  // every call) and the growing conversation prefix are read back cheaply on
  // each tool-loop iteration and on follow-up turns.
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: promptCaching ? markLastMessageForCache(messages) : messages,
    stream,
  };
  if (system) {
    body.system = promptCaching
      ? [{ type: "text", text: system, cache_control: CACHE_CONTROL }]
      : system;
  }
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.tools?.length) {
    const tools: Array<Record<string, unknown>> = params.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    if (promptCaching) {
      tools[tools.length - 1] = { ...tools[tools.length - 1]!, cache_control: CACHE_CONTROL };
    }
    body.tools = tools;
  }
  return body;
}

function mapUsage(usage?: AnthropicUsage): NonNullable<ChatCompleteResult["usage"]> {
  const out: NonNullable<ChatCompleteResult["usage"]> = {
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
  };
  // Only surfaced when the API reports them, so uncached requests look as before.
  if (usage?.cache_read_input_tokens !== undefined) out.cacheReadTokens = usage.cache_read_input_tokens;
  if (usage?.cache_creation_input_tokens !== undefined) out.cacheWriteTokens = usage.cache_creation_input_tokens;
  return out;
}

function mapStopReason(reason?: string): ChatCompleteResult["finishReason"] {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  return "stop";
}

function requestHeaders(options: AnthropicClientOptions, apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": options.apiVersion ?? DEFAULT_API_VERSION,
  };
}

function requireApiKey(options: AnthropicClientOptions): string {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new Error(
      "Anthropic provider: API key not configured (set ANTHROPIC_API_KEY or providers.anthropic.apiKey)",
    );
  }
  return apiKey;
}

function messagesUrl(options: AnthropicClientOptions): string {
  return `${options.baseUrl.replace(/\/$/, "")}/v1/messages`;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as AnthropicResponse;
    return body.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function chatComplete(
  options: AnthropicClientOptions,
  params: ChatCompleteParams,
): Promise<ChatCompleteResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const apiKey = requireApiKey(options);

  const response = await fetchFn(messagesUrl(options), {
    method: "POST",
    headers: requestHeaders(options, apiKey),
    body: JSON.stringify(buildRequestBody(params, false, options.promptCaching !== false)),
  });

  if (!response.ok) {
    throw new Error(`Anthropic provider error: ${await readError(response)}`);
  }

  const body = (await response.json()) as AnthropicResponse;
  let text = "";
  const toolCalls: ChatToolCall[] = [];
  for (const block of body.content ?? []) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
    }
  }

  if (!text && !toolCalls.length) {
    throw new Error("Anthropic provider returned empty response");
  }

  return {
    text,
    model: body.model ?? params.model,
    usage: mapUsage(body.usage),
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason: toolCalls.length ? "tool_calls" : mapStopReason(body.stop_reason),
  };
}

export async function chatCompleteStream(
  options: AnthropicClientOptions,
  params: ChatCompleteParams,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<ChatCompleteResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const apiKey = requireApiKey(options);

  const response = await fetchFn(messagesUrl(options), {
    method: "POST",
    headers: requestHeaders(options, apiKey),
    body: JSON.stringify(buildRequestBody(params, true, options.promptCaching !== false)),
  });

  if (!response.ok) {
    throw new Error(`Anthropic provider error: ${await readError(response)}`);
  }
  if (!response.body) {
    throw new Error("Anthropic provider: empty stream body");
  }

  let text = "";
  let model = params.model;
  let stopReason: string | undefined;
  let usage: AnthropicUsage = {};
  // Tool-use blocks arrive as a start event plus `input_json_delta` fragments keyed by block index.
  const toolBlocks = new Map<number, ChatToolCall>();

  const handle = (event: AnthropicStreamEvent) => {
    switch (event.type) {
      case "message_start":
        if (event.message?.model) model = event.message.model;
        usage = { ...usage, ...event.message?.usage };
        break;
      case "content_block_start":
        if (event.content_block?.type === "tool_use" && event.index !== undefined) {
          toolBlocks.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            arguments: "",
          });
        }
        break;
      case "content_block_delta":
        if (event.delta?.type === "text_delta" && event.delta.text) {
          text += event.delta.text;
          onEvent({ type: "delta", text: event.delta.text });
        } else if (event.delta?.type === "input_json_delta" && event.index !== undefined) {
          const block = toolBlocks.get(event.index);
          if (block) block.arguments += event.delta.partial_json ?? "";
        }
        break;
      case "message_delta":
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        usage = { ...usage, ...event.usage };
        break;
      case "error":
        throw new Error(`Anthropic provider error: ${event.error?.message ?? "stream error"}`);
    }
  };

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
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        continue;
      }
      handle(event);
    }
  }

  const toolCalls = [...toolBlocks.values()]
    .filter((tc) => tc.id && tc.name)
    .map((tc) => ({ ...tc, arguments: tc.arguments.trim() ? tc.arguments : "{}" }));
  if (toolCalls.length) {
    onEvent({ type: "tool_calls", toolCalls });
  }

  const result: ChatCompleteResult = {
    text,
    model,
    usage: mapUsage(usage),
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason: toolCalls.length ? "tool_calls" : mapStopReason(stopReason),
  };

  onEvent({ type: "done", result });
  return result;
}
