/**
 * Mirrors the gateway WebSocket traffic into the session log (main/sessionLog.ts):
 * every frame sent to the gateway and every frame received, so a log shows the
 * whole exchange (user text, tool calls and results, final replies). Streaming
 * deltas are skipped: they're one event per token and carry nothing the final
 * reply doesn't already have.
 */
const MAX_FRAME_CHARS = 4000;
const SKIPPED_EVENTS = new Set(["chat.delta"]);

function record(dir: "out" | "in", frame: string): void {
  try {
    if (dir === "in") {
      const parsed = JSON.parse(frame) as { type?: string; event?: string };
      if (parsed.type === "event" && parsed.event && SKIPPED_EVENTS.has(parsed.event)) return;
    }
  } catch {
    // Not JSON: log it as-is.
  }
  const text = frame.length > MAX_FRAME_CHARS ? `${frame.slice(0, MAX_FRAME_CHARS)}…[truncated ${frame.length}]` : frame;
  void window.yggdrasil.log.write(`ws.${dir}`, { frame: text }).catch(() => undefined);
}

export function installFrameLogging(): void {
  const NativeWebSocket = window.WebSocket;
  class LoggedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("message", (event) => {
        if (typeof event.data === "string") record("in", event.data);
      });
    }

    send(data: Parameters<WebSocket["send"]>[0]): void {
      if (typeof data === "string") record("out", data);
      super.send(data);
    }
  }
  window.WebSocket = LoggedWebSocket as typeof WebSocket;
}
