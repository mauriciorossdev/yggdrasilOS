import { useInput } from "ink";
import type { TuiAction, ViewMode } from "../state/store.js";

export function useKeybinds(
  dispatch: React.Dispatch<TuiAction>,
  viewMode: ViewMode,
  onExit: () => void,
  onCycleMode: () => void,
): void {
  useInput((input, key) => {
    if (input === "c" && key.ctrl) {
      onExit();
      return;
    }

    if (input === "k" && key.ctrl) {
      if (viewMode === "command-palette") {
        dispatch({ type: "POP_VIEW" });
      } else {
        dispatch({ type: "PUSH_VIEW", mode: "command-palette" });
      }
      return;
    }

    if (key.tab && key.shift) {
      if (viewMode === "chat") onCycleMode();
      return;
    }

    if (viewMode === "chat") {
      if (key.pageUp || (key.upArrow && key.shift)) {
        dispatch({ type: "SCROLL", delta: 5 });
      }
      if (key.pageDown || (key.downArrow && key.shift)) {
        dispatch({ type: "SCROLL", delta: -5 });
      }
    }
  });
}
