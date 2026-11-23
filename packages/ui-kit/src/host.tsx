import { createContext, useContext, type ReactNode } from "react";
import type { CustomRole } from "./types.js";

/**
 * What a kit component needs from the app hosting it (Electron in app-desktop, a plain
 * browser in web-console). Everything is optional: without it the component falls back
 * to a web default or hides that one feature. The kit never touches window.yggdrasil.
 */
export type KitHost = {
  /** Project folder, to turn a tool's relative file path into one the host can open. */
  projectPath?: string;
  /** Opens a link outside the app. Default: a new browser tab. */
  openExternal?: (url: string) => void;
  /** Saved custom agent roles. Without it, only the built-in roles are offered. */
  customRoles?: {
    list(): Promise<CustomRole[]>;
    save(input: { label: string; systemPrompt: string }): Promise<CustomRole[]>;
  };
};

const defaultHost: KitHost = {
  openExternal: (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
};

const HostContext = createContext<KitHost>(defaultHost);

export function KitHostProvider({ host, children }: { host: KitHost; children: ReactNode }) {
  return <HostContext.Provider value={{ ...defaultHost, ...host }}>{children}</HostContext.Provider>;
}

export function useKitHost(): KitHost {
  return useContext(HostContext);
}
