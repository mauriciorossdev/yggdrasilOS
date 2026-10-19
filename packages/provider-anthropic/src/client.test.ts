import { describe, it, expect } from "vitest";
import { chatComplete, chatCompleteStream, serializeMessages } from "./client.js";
import type { ChatStreamEvent } from "@yggdrasil/sdk";

const baseOptions = { baseUrl: "https://api.example.com", apiKey: "sk-ant-test" };

describe("anthropic client", () => {
  it("posts to /v1/messages with auth headers and parses text", async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.example.com/v1/messages");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        system?: Array<{ type: string; text: string; cache_control?: unknown }>;
        max_tokens: number;
        messages: Array<{ role: string }>;
      };
      expect(body.model).toBe("claude-haiku-4-5-20251001");
      expect(body.system).toEqual([{ type: "text", text: "be brief", cache_control: { type: "ephemeral" } }]);
      expect(body.max_tokens).toBeGreaterThan(0);
      expect(body.messages.map((m) => m.role)).toEqual(["user"]);

      return new Response(
        JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          content: [{ type: "text", text: "hola" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 4 },
        }),
        { status: 200 },
      );
    };

    const result = await chatComplete(
      { ...baseOptions, fetchImpl },
      {
        model: "claude-haiku-4-5-20251001",
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "hi" },
        ],
      },
    );

    expect(result.text).toBe("hola");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
  });

  it("maps tool_use response blocks to toolCalls", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          model: "m",
          content: [{ type: "tool_use", id: "toolu_1", name: "phone_alarm", input: { time: "07:00" } }],
          stop_reason: "tool_use",
        }),
        { status: 200 },
      );

    const result = await chatComplete(
      { ...baseOptions, fetchImpl },
      { model: "m", messages: [{ role: "user", content: "alarma" }] },
    );

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "toolu_1", name: "phone_alarm", arguments: '{"time":"07:00"}' },
    ]);
  });

  it("sends tools as input_schema", async () => {
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        tools: Array<{ name: string; description: string; input_schema: unknown; cache_control?: unknown }>;
      };
      expect(body.tools[0]).toEqual({
        name: "echo",
        description: "echo it",
        input_schema: { type: "object", properties: {} },
        cache_control: { type: "ephemeral" },
      });
      return new Response(
        JSON.stringify({ model: "m", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }),
        { status: 200 },
      );
    };

    await chatComplete(
      { ...baseOptions, fetchImpl },
      {
        model: "m",
        messages: [{ role: "user", content: "x" }],
        tools: [
          {
            type: "function",
            function: { name: "echo", description: "echo it", parameters: { type: "object", properties: {} } },
          },
        ],
      },
    );
  });

  it("surfaces API errors", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 });
    await expect(
      chatComplete({ ...baseOptions, fetchImpl }, { model: "m", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow(/invalid x-api-key/);
  });

  it("throws when api key missing", async () => {
    await expect(
      chatComplete({ baseUrl: "https://api.example.com" }, { model: "m", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow(/API key/);
  });
});

describe("anthropic prompt caching", () => {
  const tool = (name: string) => ({
    type: "function" as const,
    function: { name, description: name, parameters: { type: "object" as const, properties: {} } },
  });

  const capture = async (promptCaching?: boolean) => {
    let body: Record<string, any> = {};
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          model: "m",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 },
        }),
        { status: 200 },
      );
    };
    const result = await chatComplete(
      { ...baseOptions, fetchImpl, ...(promptCaching === undefined ? {} : { promptCaching }) },
      {
        model: "m",
        tools: [tool("a"), tool("b")],
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hola" },
        ],
      },
    );
    return { body, result };
  };

  it("marks the last tool, the system prompt and the last message block", async () => {
    const { body } = await capture();
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    const lastBlocks = body.messages.at(-1).content;
    expect(lastBlocks.at(-1)).toEqual({ type: "text", text: "hola", cache_control: { type: "ephemeral" } });
  });

  it("reports cache read/write tokens in usage", async () => {
    const { result } = await capture();
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 3000,
      cacheWriteTokens: 500,
    });
  });

  it("sends no cache_control when promptCaching is false", async () => {
    const { body } = await capture(false);
    expect(JSON.stringify(body)).not.toContain("cache_control");
    expect(body.system).toBe("sys");
  });

  it("keeps cache counters out of usage when the API does not report them", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ model: "m", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 5, output_tokens: 1 } }),
        { status: 200 },
      );
    const result = await chatComplete(
      { ...baseOptions, fetchImpl },
      { model: "m", messages: [{ role: "user", content: "x" }] },
    );
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 1 });
  });

  it("collects cache usage from streaming events", async () => {
    const sse = (events: object[]) =>
      new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { status: 200 });
    const fetchImpl = async () =>
      sse([
        {
          type: "message_start",
          message: { model: "m", usage: { input_tokens: 4, cache_read_input_tokens: 2800, cache_creation_input_tokens: 0 } },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
      ]);
    const result = await chatCompleteStream(
      { ...baseOptions, fetchImpl },
      { model: "m", messages: [{ role: "user", content: "x" }] },
      () => {},
    );
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 7, cacheReadTokens: 2800, cacheWriteTokens: 0 });
  });
});

describe("serializeMessages", () => {
  it("converts tool calls and results, merging consecutive results into one user turn", () => {
    const { messages } = serializeMessages([
      { role: "user", content: "haz dos cosas" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "a", name: "t1", arguments: '{"x":1}' },
          { id: "b", name: "t2", arguments: "" },
        ],
      },
      { role: "tool", content: "r1", tool_call_id: "a" },
      { role: "tool", content: "r2", tool_call_id: "b" },
    ]);

    expect(messages).toEqual([
      { role: "user", content: "haz dos cosas" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "a", name: "t1", input: { x: 1 } },
          { type: "tool_use", id: "b", name: "t2", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "r1" },
          { type: "tool_result", tool_use_id: "b", content: "r2" },
        ],
      },
    ]);
  });

  it("converts data-URL images to base64 sources", () => {
    const { messages } = serializeMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "mira" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
    ]);
    expect(messages[0]!.content).toEqual([
      { type: "text", text: "mira" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });
});

describe("anthropic streaming", () => {
  const sse = (events: object[]) =>
    new Response(
      events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(""),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );

  it("emits text deltas", async () => {
    const fetchImpl = async () =>
      sse([
        { type: "message_start", message: { model: "m", usage: { input_tokens: 5 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ho" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "la" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ]);

    const events: ChatStreamEvent[] = [];
    const result = await chatCompleteStream(
      { ...baseOptions, fetchImpl },
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      (e) => events.push(e),
    );

    expect(result.text).toBe("hola");
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(events.filter((e) => e.type === "delta")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("assembles tool_use input from json deltas", async () => {
    const fetchImpl = async () =>
      sse([
        { type: "message_start", message: { model: "m" } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "echo", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"mess' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'age":"hi"}' } },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
      ]);

    const events: ChatStreamEvent[] = [];
    const result = await chatCompleteStream(
      { ...baseOptions, fetchImpl },
      { model: "m", messages: [{ role: "user", content: "x" }] },
      (e) => events.push(e),
    );

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([{ id: "toolu_1", name: "echo", arguments: '{"message":"hi"}' }]);
    expect(events.some((e) => e.type === "tool_calls")).toBe(true);
  });

  it("throws on stream error events", async () => {
    const fetchImpl = async () => sse([{ type: "error", error: { message: "overloaded" } }]);
    await expect(
      chatCompleteStream(
        { ...baseOptions, fetchImpl },
        { model: "m", messages: [{ role: "user", content: "x" }] },
        () => {},
      ),
    ).rejects.toThrow(/overloaded/);
  });
});
