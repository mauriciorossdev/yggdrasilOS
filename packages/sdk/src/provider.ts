import type { ToolParameterSchema } from "@yggdrasil/tools-sdk";

export type ContentPartText = { type: "text"; text: string };
export type ContentPartImage = { type: "image_url"; image_url: { url: string } };
export type ContentPart = ContentPartText | ContentPartImage;

export type ProviderModel = {
  id: string;
  label: string;
  provider: string;
  contextWindow?: number;
  supportsTools?: boolean;
};

export type ProviderCatalogContext = {
  config: unknown;
};

export type ChatToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_call_id?: string;
  name?: string;
  tool_calls?: ChatToolCall[];
};

export type ChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
};

export type ChatCompleteParams = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatToolDefinition[];
};

export type ChatCompleteFinishReason = "stop" | "tool_calls" | "length";

export type ChatCompleteResult = {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  model: string;
  toolCalls?: ChatToolCall[];
  finishReason?: ChatCompleteFinishReason;
};

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_calls"; toolCalls: ChatToolCall[] }
  | { type: "done"; result: ChatCompleteResult };

export type ProviderPlugin = {
  id: string;
  label: string;
  listModels(ctx: ProviderCatalogContext): ProviderModel[] | Promise<ProviderModel[]>;
  resolveApiKey?(ctx: ProviderCatalogContext): string | undefined | Promise<string | undefined>;
  chatComplete(ctx: ProviderCatalogContext, params: ChatCompleteParams): Promise<ChatCompleteResult>;
  chatCompleteStream?(
    ctx: ProviderCatalogContext,
    params: ChatCompleteParams,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<ChatCompleteResult>;
};
