// The LSP wire format: `Content-Length: <bytes>\r\n\r\n<json>`. Lengths count bytes, not characters.

const HEADER_END = Buffer.from("\r\n\r\n");
/** A header this long isn't LSP; give up on the stream rather than buffer it forever. */
const MAX_HEADER_BYTES = 8 * 1024;

export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** Reassembles messages from stream chunks, which can split or join them anywhere. */
export class MessageReader {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    private readonly onMessage: (message: unknown) => void,
    private readonly onError: (error: Error) => void,
  ) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END);
      if (headerEnd === -1) {
        if (this.buffer.length > MAX_HEADER_BYTES) this.fail("LSP header too long");
        return;
      }
      const length = /content-length:\s*(\d+)/i.exec(this.buffer.toString("ascii", 0, headerEnd))?.[1];
      if (length === undefined) return this.fail("LSP header without Content-Length");
      const start = headerEnd + HEADER_END.length;
      const end = start + Number(length);
      if (this.buffer.length < end) return;
      const body = this.buffer.toString("utf8", start, end);
      this.buffer = this.buffer.subarray(end);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        this.onError(new Error("LSP message is not valid JSON"));
      }
    }
  }

  private fail(reason: string): void {
    this.buffer = Buffer.alloc(0);
    this.onError(new Error(reason));
  }
}
