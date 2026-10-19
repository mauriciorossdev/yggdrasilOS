/** ChatView's single aside slot — a file (FileContentPanel) or a complemento opened as a panel (PluginPanel). Only one open at a time, same as before this existed (openFilePath). */
export type SidePanel = { kind: "file"; path: string } | { kind: "plugin"; key: string };

/** A `ygg:console`/`ygg:error` message forwarded by pluginSdk.ts's console/error capture — see PluginFrame.tsx's onConsole/onError props and StudioPreview.tsx's log panel. */
export type PluginConsoleEntry = { kind: "console"; level: "log" | "warn" | "error"; args: string[]; timestamp: number };
export type PluginErrorEntry = { kind: "error"; message: string; stack?: string; timestamp: number };
export type PluginLogEntry = PluginConsoleEntry | PluginErrorEntry;
