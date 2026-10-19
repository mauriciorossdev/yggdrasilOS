/**
 * True when an event [payload] is addressed to [connectionId] — or carries no
 * address at all (older emitters, broadcast-style events).
 *
 * Device-tool invocations are addressed to one phone connection: a phone can
 * hold several at once (the app and the quick-access bubble's background
 * engine), all of which know the same tool names, so broadcasting would run
 * one tool call once per connection.
 */
export function isForThisConnection(payload: unknown, connectionId: string): boolean {
  const target = (payload as { connectionId?: unknown } | null | undefined)?.connectionId;
  return typeof target !== "string" || target === connectionId;
}
