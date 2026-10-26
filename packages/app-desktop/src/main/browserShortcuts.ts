// Keyboard shortcuts of the Browser tab, as a pure input -> action mapping so
// it can be unit-tested without Electron. Applied from `before-input-event` on
// both the page views (focus inside a page) and the app window (focus in the
// address bar / tab strip) — see browserTabView.ts.

export type BrowserShortcutAction =
  | "newTab"
  | "closeTab"
  | "focusAddress"
  | "reload"
  | "hardReload"
  | "back"
  | "forward"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "nextTab"
  | "prevTab"
  | "devTools";

/** The subset of Electron's Input the mapping needs. */
export type ShortcutInput = {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
};

export function matchBrowserShortcut(input: ShortcutInput, isMac: boolean): BrowserShortcutAction | null {
  if (input.type !== "keyDown") return null;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;

  // F-keys and Alt+arrows carry no command modifier.
  if (key === "F5") return input.control || input.meta || input.shift ? "hardReload" : "reload";
  if (key === "F12") return "devTools";
  if (input.alt && !input.control && !input.meta && !input.shift) {
    if (key === "ArrowLeft") return "back";
    if (key === "ArrowRight") return "forward";
    return null;
  }

  // Ctrl on Windows/Linux, Cmd on macOS — never both, never Alt.
  const command = isMac ? input.meta && !input.control : input.control && !input.meta;
  if (!command || input.alt) return null;

  if (input.shift) {
    if (key === "r") return "hardReload";
    if (key === "i") return "devTools";
    if (key === "Tab") return "prevTab";
    // Ctrl+Shift+= is how "+" is typed on many layouts.
    if (key === "+") return "zoomIn";
    return null;
  }

  switch (key) {
    case "t":
      return "newTab";
    case "w":
      return "closeTab";
    case "l":
      return "focusAddress";
    case "r":
      return "reload";
    case "=":
    case "+":
      return "zoomIn";
    case "-":
      return "zoomOut";
    case "0":
      return "zoomReset";
    case "Tab":
      return "nextTab";
    default:
      return null;
  }
}

/** Chrome's zoom steps; the next/previous one relative to `current` (a factor, 1 = 100%). */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export function nextZoomFactor(current: number, direction: "in" | "out"): number {
  // Compare with a tolerance: Electron hands back factors like 1.0999999.
  const eps = 0.001;
  if (direction === "in") return ZOOM_STEPS.find((s) => s > current + eps) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return [...ZOOM_STEPS].reverse().find((s) => s < current - eps) ?? ZOOM_STEPS[0]!;
}
