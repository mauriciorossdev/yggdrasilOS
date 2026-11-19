/** One tab of ChatView's aside: a file (FileContentPanel), a file's uncommitted diff (DiffContentPanel), a complemento opened as a panel (PluginPanel) or a live terminal pane (TerminalSidePanel). */
export type SidePanel =
  | { kind: "file"; path: string }
  | {
      kind: "diff";
      /** Relative to the root of the repo that holds the project. */
      path: string;
      /** The same file relative to the project, for "Open file"; absent when it was deleted or sits outside the project. */
      filePath?: string;
    }
  | { kind: "plugin"; key: string }
  | { kind: "terminal"; id: string };

/** Identity of a tab: opening the same thing twice activates it instead of adding another. */
export function sidePanelKey(panel: SidePanel): string {
  switch (panel.kind) {
    case "file":
      return `file:${panel.path}`;
    case "diff":
      return `diff:${panel.path}`;
    case "plugin":
      return `plugin:${panel.key}`;
    case "terminal":
      return `terminal:${panel.id}`;
  }
}

/** A `ygg:console`/`ygg:error` message forwarded by pluginSdk.ts's console/error capture — see PluginFrame.tsx's onConsole/onError props and StudioPreview.tsx's log panel. */
export type PluginConsoleEntry = { kind: "console"; level: "log" | "warn" | "error"; args: string[]; timestamp: number };
export type PluginErrorEntry = { kind: "error"; message: string; stack?: string; timestamp: number };
export type PluginLogEntry = PluginConsoleEntry | PluginErrorEntry;
