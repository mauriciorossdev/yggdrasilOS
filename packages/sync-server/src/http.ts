import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 8 * 1024 * 1024; // a shared board/notes-file blob, not a file upload service

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `"${field}" is required`);
  return value;
}
