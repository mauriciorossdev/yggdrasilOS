import type { createEventBus } from "@yggdrasil/kernel";

export type ActiveTurnTracker = { isActive: (sessionKey: string) => boolean };

// Backs terminals.list's "working" flag — a pane counts as working only
// while its linked sessionKey has an in-flight turn. turn.start/turn.end are
// already emitted by the pipeline's TurnKernel (packages/pipeline/src/
// turn-kernel.ts) onto this same events bus (see createDefaultGatewayContext
// passing `events: ctx.events` into runChannelTurn) — this just tracks them.
export function createActiveTurnTracker(events: ReturnType<typeof createEventBus>): ActiveTurnTracker {
  const active = new Set<string>();

  events.on("turn.start", (payload) => {
    const sessionKey = (payload as { sessionKey?: unknown })?.sessionKey;
    if (typeof sessionKey === "string") active.add(sessionKey);
  });
  events.on("turn.end", (payload) => {
    const sessionKey = (payload as { sessionKey?: unknown })?.sessionKey;
    if (typeof sessionKey === "string") active.delete(sessionKey);
  });

  return { isActive: (sessionKey) => active.has(sessionKey) };
}
