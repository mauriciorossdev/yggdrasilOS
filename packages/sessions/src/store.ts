import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { YggdrasilConfig } from "@yggdrasil/config";
import type { ChatMessage } from "@yggdrasil/sdk";
import type { SessionCompactionState, SessionMessage, SessionPatch, SessionRecord, SessionSummary } from "./types.js";

const SESSION_STORE_KEY = Symbol.for("yggdrasil.sessionStore");

type GlobalWithStore = typeof globalThis & {
  [SESSION_STORE_KEY]?: SessionStore;
};

export function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

function toChatMessage(msg: SessionMessage): ChatMessage {
  const { timestamp: _ts, ...rest } = msg;
  return rest;
}

function toSessionMessage(msg: ChatMessage): SessionMessage {
  return { ...msg, timestamp: Date.now() };
}

const SESSION_PREVIEW_MAX_CHARS = 200;

function contentToText(content: SessionMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

function normalizePreview(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SESSION_PREVIEW_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, SESSION_PREVIEW_MAX_CHARS - 1)}…`;
}

// Scans from the end so a trailing tool_calls/tool-result pair (common right
// after a device-tool or shell-tool turn) doesn't become the preview — a raw
// tool-result blob is not what a chat-list preview should show. Skips a
// message with no text too (e.g. an assistant turn that's tool_calls-only,
// content: "").
function buildLastMessagePreview(messages: SessionMessage[]): SessionSummary["lastMessage"] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const preview = normalizePreview(contentToText(msg.content));
    if (!preview) continue;
    return { role: msg.role, preview, timestamp: msg.timestamp };
  }
  return undefined;
}

export class SessionStore {
  constructor(
    private readonly dir: string,
    private readonly maxMessages: number,
  ) {}

  private filePath(sessionKey: string): string {
    return join(this.dir, `${sanitizeSessionKey(sessionKey)}.json`);
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private truncateMessages(messages: SessionRecord["messages"]): SessionRecord["messages"] {
    if (messages.length <= this.maxMessages) return messages;
    return messages.slice(messages.length - this.maxMessages);
  }

  async get(sessionKey: string): Promise<SessionRecord | null> {
    try {
      const raw = await readFile(this.filePath(sessionKey), "utf8");
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  async list(): Promise<SessionSummary[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir);
    const summaries: SessionSummary[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(this.dir, entry), "utf8");
        const record = JSON.parse(raw) as SessionRecord;
        summaries.push({
          sessionKey: record.sessionKey,
          title: record.title,
          agentId: record.agentId,
          messageCount: record.messages.length,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          lastMessage: buildLastMessagePreview(record.messages),
        });
      } catch {
        // skip corrupt files
      }
    }

    return [...summaries].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async save(record: SessionRecord): Promise<void> {
    await this.ensureDir();
    record.messages = this.truncateMessages(record.messages);
    record.updatedAt = Date.now();
    await writeFile(this.filePath(record.sessionKey), JSON.stringify(record, null, 2), "utf8");
  }

  private async getOrCreate(sessionKey: string): Promise<SessionRecord> {
    const existing = await this.get(sessionKey);
    if (existing) return existing;
    const now = Date.now();
    return {
      sessionKey,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  async appendUser(sessionKey: string, content: string): Promise<void> {
    const record = await this.getOrCreate(sessionKey);
    record.messages.push({ role: "user", content, timestamp: Date.now() });
    await this.save(record);
  }

  async appendAssistant(sessionKey: string, content: string): Promise<void> {
    const record = await this.getOrCreate(sessionKey);
    record.messages.push({ role: "assistant", content, timestamp: Date.now() });
    await this.save(record);
  }

  async appendMessages(sessionKey: string, messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const record = await this.getOrCreate(sessionKey);
    for (const msg of messages) {
      record.messages.push(toSessionMessage(msg));
    }
    await this.save(record);
  }

  async patch(sessionKey: string, patch: SessionPatch): Promise<SessionRecord> {
    const record = await this.getOrCreate(sessionKey);
    if (patch.title !== undefined) record.title = patch.title;
    if (patch.metadata !== undefined) record.metadata = patch.metadata;
    if (patch.agentId !== undefined) record.agentId = patch.agentId;
    await this.save(record);
    return record;
  }

  async replaceMessages(
    sessionKey: string,
    messages: SessionMessage[],
    compaction?: SessionCompactionState,
  ): Promise<void> {
    const record = await this.getOrCreate(sessionKey);
    record.messages = messages;
    if (compaction) {
      record.compaction = compaction;
    }
    await this.save(record);
  }

  async getHistory(sessionKey: string): Promise<ChatMessage[]> {
    const record = await this.get(sessionKey);
    if (!record) return [];
    return record.messages.map(toChatMessage);
  }

  async getHistoryBeforeLastUser(sessionKey: string): Promise<ChatMessage[]> {
    const history = await this.getHistory(sessionKey);
    if (history.length === 0) return [];
    const last = history[history.length - 1];
    if (last?.role === "user") {
      return history.slice(0, -1);
    }
    return history;
  }

  async reset(sessionKey: string): Promise<void> {
    try {
      await unlink(this.filePath(sessionKey));
    } catch {
      // already gone
    }
  }
}

export function createSessionStore(config: YggdrasilConfig): SessionStore {
  const dir = config.sessions?.dir ?? join(homedir(), ".yggdrasil", "sessions");
  const maxMessages = config.sessions?.maxMessages ?? 50;
  return new SessionStore(dir, maxMessages);
}

export function initSessionStore(config: YggdrasilConfig): SessionStore {
  const store = createSessionStore(config);
  const g = globalThis as GlobalWithStore;
  g[SESSION_STORE_KEY] = store;
  return store;
}

export function getSessionStore(): SessionStore | null {
  return (globalThis as GlobalWithStore)[SESSION_STORE_KEY] ?? null;
}

export function resetSessionStoreForTest(): void {
  delete (globalThis as GlobalWithStore)[SESSION_STORE_KEY];
}
