import { encodeMessage, MessageReader } from "./framing.js";

/** A connection to a language server: a child's stdio, or a socket to one already running. */
export type LspChannel = {
  write: (data: Buffer) => void;
  onData: (handler: (chunk: Buffer) => void) => void;
  onClose: (handler: (reason: string | null) => void) => void;
  /** Ends it for good, including any processes the server started. */
  kill: () => void;
  /** False when the server outlives us (Godot's editor): it must not be told to shut down. */
  ownsServer: boolean;
};

export type LspManagerDeps = {
  onMessage: (ownerId: string, sessionId: string, message: unknown) => void;
  onClose: (ownerId: string, sessionId: string, reason: string | null) => void;
  /** How long a server gets to exit by itself after being asked. */
  graceMs?: number;
};

type Session = { id: string; ownerId: string; serverId: string; channel: LspChannel; stopping: boolean; allowedUris: Set<string> };

const SHUTDOWN_ID = "ygg-shutdown";
const MAX_ALLOWED_URIS = 5000;

/** URIs a definition/references result points at. */
function resultUris(message: unknown): string[] {
  const result = (message as { result?: unknown } | null)?.result;
  if (!result || typeof result !== "object") return [];
  const items = Array.isArray(result) ? result : [result];
  const uris: string[] = [];
  for (const item of items) {
    const { uri, targetUri } = (item ?? {}) as { uri?: unknown; targetUri?: unknown };
    if (typeof uri === "string") uris.push(uri);
    if (typeof targetUri === "string") uris.push(targetUri);
  }
  return uris;
}

/**
 * Language server sessions per owner (a project window). One session per (owner, server), so opening
 * a second file reuses it. An owner can only reach its own sessions.
 */
export function createLspManager(deps: LspManagerDeps) {
  const sessions = new Map<string, Session>();
  const graceMs = deps.graceMs ?? 1500;
  let nextId = 1;

  const find = (ownerId: string, sessionId: string): Session | undefined => {
    const session = sessions.get(sessionId);
    return session?.ownerId === ownerId ? session : undefined;
  };

  function stopSession(session: Session): Promise<void> {
    if (session.stopping) return Promise.resolve();
    session.stopping = true;
    if (!session.channel.ownsServer) {
      session.channel.kill();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        session.channel.kill();
        resolve();
      }, graceMs);
      session.channel.onClose(() => {
        clearTimeout(timer);
        // Its children (tsserver) may still be alive after the server itself exits.
        session.channel.kill();
        resolve();
      });
      try {
        session.channel.write(encodeMessage({ jsonrpc: "2.0", id: SHUTDOWN_ID, method: "shutdown" }));
      } catch {
        session.channel.kill();
      }
    });
  }

  return {
    /** The session for this owner and server, opening it if needed. */
    start(ownerId: string, serverId: string, open: () => LspChannel): string {
      for (const session of sessions.values()) {
        if (session.ownerId === ownerId && session.serverId === serverId && !session.stopping) return session.id;
      }
      const id = `lsp-${nextId++}`;
      const channel = open();
      const session: Session = { id, ownerId, serverId, channel, stopping: false, allowedUris: new Set() };
      sessions.set(id, session);
      const reader = new MessageReader(
        (message) => {
          const { id: messageId } = (message ?? {}) as { id?: unknown };
          if (messageId === SHUTDOWN_ID) {
            try {
              channel.write(encodeMessage({ jsonrpc: "2.0", method: "exit" }));
            } catch {
              channel.kill();
            }
            return;
          }
          if (session.stopping) return;
          if (session.allowedUris.size < MAX_ALLOWED_URIS) {
            for (const uri of resultUris(message)) session.allowedUris.add(uri);
          }
          deps.onMessage(ownerId, id, message);
        },
        (error) => console.error(`[lsp] ${serverId}:`, error.message),
      );
      channel.onData((chunk) => reader.push(chunk));
      channel.onClose((reason) => {
        sessions.delete(id);
        if (!session.stopping) {
          channel.kill();
          deps.onClose(ownerId, id, reason);
        }
      });
      return id;
    },

    send(ownerId: string, sessionId: string, message: unknown): void {
      const session = find(ownerId, sessionId);
      if (!session || session.stopping) return;
      session.channel.write(encodeMessage(message));
    },

    /** Whether one of the owner's servers pointed at this URI, so it may open that file to show it. */
    isAllowedUri(ownerId: string, uri: string): boolean {
      for (const session of sessions.values()) {
        if (session.ownerId === ownerId && session.allowedUris.has(uri)) return true;
      }
      return false;
    },

    runningServers(ownerId: string): string[] {
      return [...sessions.values()].filter((s) => s.ownerId === ownerId && !s.stopping).map((s) => s.serverId);
    },

    stopOwner(ownerId: string): Promise<void> {
      return Promise.all([...sessions.values()].filter((s) => s.ownerId === ownerId).map(stopSession)).then(() => undefined);
    },

    stopAll(): Promise<void> {
      return Promise.all([...sessions.values()].map(stopSession)).then(() => undefined);
    },
  };
}

export type LspManager = ReturnType<typeof createLspManager>;
