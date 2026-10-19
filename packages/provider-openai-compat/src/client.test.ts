import { describe, it, expect } from "vitest";
import { chatComplete } from "./client.js";

describe("openai-compat client", () => {
  it("calls chat completions endpoint", async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.example.com/v1/chat/completions");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as { model: string };
      expect(body.model).toBe("test-model");

      return new Response(
        JSON.stringify({
          model: "test-model",
          choices: [{ message: { content: "hello from llm" } }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await chatComplete(
      { baseUrl: "https://api.example.com/v1", apiKey: "sk-test", fetchImpl },
      {
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      },
    );

    expect(result.text).toBe("hello from llm");
    expect(result.usage?.inputTokens).toBe(3);
  });

  it("serializes assistant tool_calls in OpenAI wire format", async () => {
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{
          role: string;
          tool_calls?: Array<{ type: string; function: { name: string; arguments: string } }>;
        }>;
      };
      const assistant = body.messages.find((m) => m.role === "assistant");
      expect(assistant?.tool_calls?.[0]).toEqual({
        id: "call_1",
        type: "function",
        function: { name: "my-tool_echo", arguments: '{"message":"hola"}' },
      });

      return new Response(
        JSON.stringify({
          model: "test-model",
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    await chatComplete(
      { baseUrl: "https://api.example.com/v1", apiKey: "sk-test", fetchImpl },
      {
        model: "test-model",
        messages: [
          { role: "user", content: "use tool" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call_1", name: "my-tool_echo", arguments: '{"message":"hola"}' }],
          },
          { role: "tool", content: '{"message":"hola"}', tool_call_id: "call_1", name: "my-tool_echo" },
        ],
      },
    );
  });

  it("throws when api key missing", async () => {
    await expect(
      chatComplete(
        { baseUrl: "https://api.example.com/v1" },
        { model: "m", messages: [{ role: "user", content: "x" }] },
      ),
    ).rejects.toThrow(/API key/);
  });
});
