// Helpers for merging a plugin frame's two error channels: the SDK's own
// window.onerror/unhandledrejection reports (postMessage, with stack, but
// muted to "Script error." for the plugin's own files) and the main
// process's console-message copy (real text + file:line, no stack) — see
// main/pluginProtocol.ts's forwardPluginFrameErrors and PluginFrame.tsx.

/** How long the main-process copy of an error waits for the SDK's own report of it. */
export const ERROR_DEDUPE_WAIT_MS = 300;
/** How far back an SDK report counts as "the same error". */
export const ERROR_DEDUPE_MS = 2_000;

/**
 * Whether a main-process frame URL belongs to this iframe: its own
 * `ygg-frame` id, or — once the plugin navigated to another of its pages and
 * dropped the param — any page under this plugin's base URL.
 */
export function isFrameOf(frameUrl: string, pluginUrl: string, frameId: string): boolean {
  if (!pluginUrl || !frameUrl.startsWith(pluginUrl)) return false;
  let id: string | null = null;
  try {
    id = new URL(frameUrl).searchParams.get("ygg-frame");
  } catch {
    return false;
  }
  return id === null || id === frameId;
}

/** "Uncaught (in promise) Error: boom" → "Error: boom" — the part both channels share. */
export function errorCore(consoleMessage: string): string {
  return consoleMessage.replace(/^Uncaught (\(in promise\) )?/, "");
}

/** A script URL inside the plugin, shown relative to it ("app.js"); anything else as-is. */
export function relativeSource(sourceId: string, pluginUrl: string): string {
  return pluginUrl && sourceId.startsWith(pluginUrl) ? sourceId.slice(pluginUrl.length) : sourceId;
}

/**
 * Makes a stack trace readable: the plugin's own URLs (base + query, e.g.
 * `ygg-plugin://plugin/project/p/tasks/?v=0&ygg-frame=…`) become paths
 * relative to the plugin, the bare base becoming its entry file.
 */
export function tidyStack(stack: string, pluginUrl: string, entry = "index.html"): string {
  if (!pluginUrl) return stack;
  const escaped = pluginUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stack.replace(new RegExp(`${escaped}([^\\s?:)]*)(\\?[^\\s:)]*)?`, "g"), (_m, path: string) => path || entry);
}
