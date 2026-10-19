import { describe, it, expect } from "vitest";
import { toOllamaMessages, toOllamaTools, fromOllamaToolCalls, parseFallbackToolCalls } from "./messages.js";
import type { ChatMessage, ChatToolDefinition } from "@yggdrasil/sdk";

describe("Ollama message mapping", () => {
  it("converts ChatMessage[] to OllamaMessage[]", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    const result = toOllamaMessages(messages);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: "system", content: "You are helpful" });
    expect(result[1]).toEqual({ role: "user", content: "Hello" });
    expect(result[2]).toEqual({ role: "assistant", content: "Hi there" });
  });

  it("converts assistant messages with tool_calls", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", name: "get_time", arguments: '{"tz":"UTC"}' },
        ],
      },
    ];

    const result = toOllamaMessages(messages);
    expect(result[0].tool_calls).toHaveLength(1);
    expect(result[0].tool_calls![0].function.name).toBe("get_time");
    expect(result[0].tool_calls![0].function.arguments).toEqual({ tz: "UTC" });
  });

  it("converts ChatToolDefinition[] to OllamaTool[]", () => {
    const tools: ChatToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "search",
          description: "Search the web",
          parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        },
      },
    ];

    const result = toOllamaTools(tools);
    expect(result).toHaveLength(1);
    expect(result![0].type).toBe("function");
    expect(result![0].function.name).toBe("search");
  });

  it("returns undefined for empty tools array", () => {
    expect(toOllamaTools([])).toBeUndefined();
    expect(toOllamaTools(undefined)).toBeUndefined();
  });

  it("converts OllamaToolCall[] to ChatToolCall[]", () => {
    const ollama = [
      { function: { name: "calc", arguments: { a: 1, b: 2 } } },
    ];

    const result = fromOllamaToolCalls(ollama);
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe("calc");
    expect(result![0].arguments).toBe('{"a":1,"b":2}');
    expect(result![0].id).toContain("calc");
  });

  it("recovers a bare-JSON tool call some models emit as plain content", () => {
    const result = parseFallbackToolCalls('{"name": "echo", "arguments": {"message": "hola"}}');
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe("echo");
    expect(result![0].arguments).toBe('{"message":"hola"}');
  });

  it("recovers tool calls wrapped in <tool_call> tags", () => {
    const content = '<tool_call>\n{"name": "echo", "arguments": {"message": "hi"}}\n</tool_call>';
    const result = parseFallbackToolCalls(content);
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe("echo");
  });

  it("recovers multiple tagged tool calls", () => {
    const content =
      '<tool_call>{"name": "a", "arguments": {}}</tool_call>' +
      '<tool_call>{"name": "b", "arguments": {"x": 1}}</tool_call>';
    const result = parseFallbackToolCalls(content);
    expect(result).toHaveLength(2);
    expect(result!.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("recovers a tool call wrapped in a ```json markdown code fence", () => {
    const content = '```json\n{"name": "echo", "arguments": {"message": "hola"}}\n```';
    const result = parseFallbackToolCalls(content);
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe("echo");
    expect(result![0].arguments).toBe('{"message":"hola"}');
  });

  it("recovers a tool call wrapped in a bare ``` fence (no language tag)", () => {
    const content = '```\n{"name": "echo", "arguments": {"message": "hola"}}\n```';
    const result = parseFallbackToolCalls(content);
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe("echo");
  });

  it("returns undefined for a fenced JSON example that isn't a tool call", () => {
    expect(parseFallbackToolCalls('```json\n{"foo": "bar"}\n```')).toBeUndefined();
  });

  it("returns undefined for ordinary prose", () => {
    expect(parseFallbackToolCalls("Estoy bien, gracias. ¿Y tú?")).toBeUndefined();
  });

  it("returns undefined for prose containing an unrelated JSON-looking fragment", () => {
    expect(parseFallbackToolCalls('The config is {"foo": "bar"} by default.')).toBeUndefined();
  });

  it("returns undefined for empty content", () => {
    expect(parseFallbackToolCalls("")).toBeUndefined();
    expect(parseFallbackToolCalls("   ")).toBeUndefined();
  });
});
