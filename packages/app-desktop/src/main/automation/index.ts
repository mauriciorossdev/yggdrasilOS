import { createDarwinAutomationAdapter } from "./darwin.js";
import { createUnsupportedAutomationAdapter } from "./unsupported.js";
import type { DesktopAutomationAdapter } from "./types.js";

let adapter: DesktopAutomationAdapter | undefined;

/** Stateless (no per-project data), so unlike paneControlServer's browserTab/plugins callbacks this doesn't need injecting from index.ts's per-window state — one adapter instance for the whole app run. */
export function getDesktopAutomationAdapter(): DesktopAutomationAdapter {
  if (!adapter) {
    adapter = process.platform === "darwin" ? createDarwinAutomationAdapter() : createUnsupportedAutomationAdapter(process.platform);
  }
  return adapter;
}

export * from "./types.js";
