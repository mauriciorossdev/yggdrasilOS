import { describe, expect, it } from "vitest";
import { encodeMessage, MessageReader } from "./framing.js";

function reader() {
  const messages: unknown[] = [];
  const errors: string[] = [];
  return { messages, errors, r: new MessageReader((m) => messages.push(m), (e) => errors.push(e.message)) };
}

describe("LSP framing", () => {
  it("counts bytes, not characters", () => {
    expect(encodeMessage({ a: "ñ" }).toString()).toBe('Content-Length: 10\r\n\r\n{"a":"ñ"}');
  });

  it("reads messages split across chunks, including inside a multibyte character", () => {
    const { messages, r } = reader();
    const bytes = encodeMessage({ text: "añb" });
    for (const byte of bytes) r.push(Buffer.from([byte]));
    expect(messages).toEqual([{ text: "añb" }]);
  });

  it("reads several messages from one chunk", () => {
    const { messages, r } = reader();
    r.push(Buffer.concat([encodeMessage({ n: 1 }), encodeMessage({ n: 2 }), encodeMessage({ n: 3 }).subarray(0, 5)]));
    expect(messages).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("accepts extra headers", () => {
    const { messages, r } = reader();
    r.push(Buffer.from('Content-Type: application/vscode-jsonrpc\r\nContent-Length: 2\r\n\r\n{}'));
    expect(messages).toEqual([{}]);
  });

  it("reports bad input and keeps reading after invalid JSON", () => {
    const { messages, errors, r } = reader();
    r.push(Buffer.from("Content-Length: 1\r\n\r\n{"));
    r.push(encodeMessage({ ok: true }));
    expect(errors).toEqual(["LSP message is not valid JSON"]);
    expect(messages).toEqual([{ ok: true }]);
    const other = reader();
    other.r.push(Buffer.from("Nope: 1\r\n\r\n"));
    expect(other.errors).toEqual(["LSP header without Content-Length"]);
  });
});
