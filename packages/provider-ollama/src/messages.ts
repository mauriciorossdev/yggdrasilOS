import type { ChatMessage, ChatToolCall, ChatToolDefinition } from "@yggdrasil/sdk";

export type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
};

export type OllamaToolCall = {
  function: { name: string; arguments: Record<string, unknown> };
};

export type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type ParsedContent = { text: string; images?: string[] };

function parseContent(content: ChatMessage["content"]): ParsedContent {
  if (typeof content === "string") return { text: content };
  if (!Array.isArray(content)) return { text: "" };

  const textParts: string[] = [];
  const images: string[] = [];

  for (const part of content) {
    if (part.type === "text") {
      textParts.push(part.text);
    } else if (part.type === "image_url") {
      // Ollama expects raw base64, not a data URL — strip the "data:...;base64," prefix
      const url = part.image_url.url;
      const commaIdx = url.indexOf(",");
      images.push(commaIdx !== -1 ? url.slice(commaIdx + 1) : url);
    }
  }

  return { text: textParts.join(" "), images: images.length ? images : undefined };
}

export function toOllamaMessages(messages: ChatMessage[]): OllamaMessage[] {
  return messages.map((msg) => {
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      const { text } = parseContent(msg.content);
      return {
        role: "assistant" as const,
        content: text,
        tool_calls: msg.tool_calls.map((tc) => ({
          function: {
            name: tc.name,
            arguments: safeParseArgs(tc.arguments),
          },
        })),
      };
    }
    const { text, images } = parseContent(msg.content);
    return {
      role: msg.role as OllamaMessage["role"],
      content: text,
      ...(images ? { images } : {}),
    };
  });
}

export function toOllamaTools(tools?: ChatToolDefinition[]): OllamaTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as Record<string, unknown>,
    },
  }));
}

export function fromOllamaToolCalls(
  toolCalls?: OllamaToolCall[],
): ChatToolCall[] | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls.map((tc, i) => ({
    id: `call_${i}_${tc.function.name}`,
    name: tc.function.name,
    arguments: JSON.stringify(tc.function.arguments),
  }));
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const TOOL_CALL_TAG_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const CODE_FENCE_RE = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/;

/**
 * Models also commonly wrap a leaked tool call in a markdown code fence
 * (` ```json\n{...}\n``` `) rather than (or in addition to) failing to use
 * the structured tool_calls field — strip it before attempting to parse as
 * JSON. A no-op for content that isn't a single fenced block.
 */
function stripCodeFence(text: string): string {
  const match = text.match(CODE_FENCE_RE);
  return match ? match[1].trim() : text;
}

/**
 * Some small/quantized models (e.g. qwen2.5-coder 7b) fail to follow their
 * own chat template and emit a tool call as plain JSON content instead of
 * Ollama's structured `message.tool_calls` field — with or without the
 * `<tool_call>` wrapper tags the template asks for. This recovers those
 * cases so the tool still executes instead of the raw JSON leaking to the user.
 */
export function parseFallbackToolCalls(content: string): ChatToolCall[] | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;

  const tagMatches = [...trimmed.matchAll(TOOL_CALL_TAG_RE)];
  const candidates = tagMatches.length ? tagMatches.map((m) => m[1].trim()) : [trimmed];

  const calls: ChatToolCall[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const parsed = tryParseToolCallJson(stripCodeFence(candidates[i]), i);
    if (!parsed) {
      if (tagMatches.length) continue;
      return undefined;
    }
    calls.push(parsed);
  }
  return calls.length ? calls : undefined;
}

function tryParseToolCallJson(raw: string, index: number): ChatToolCall | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof obj !== "object" ||
    obj === null ||
    typeof (obj as Record<string, unknown>).name !== "string" ||
    typeof (obj as Record<string, unknown>).arguments !== "object" ||
    (obj as Record<string, unknown>).arguments === null
  ) {
    return undefined;
  }
  const name = (obj as Record<string, unknown>).name as string;
  const args = (obj as Record<string, unknown>).arguments as Record<string, unknown>;
  return {
    id: `call_fallback_${index}_${name}`,
    name,
    arguments: JSON.stringify(args),
  };
}
