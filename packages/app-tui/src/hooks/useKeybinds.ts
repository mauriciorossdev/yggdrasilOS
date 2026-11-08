import { useInput } from "ink";
import type { TuiAction, ViewMode } from "../state/store.js";

export function useKeybinds(
  dispatch: React.Dispatch<TuiAction>,
  viewMode: ViewMode,
  onExit: () => void,
  onCycleMode: () => void,
  /** Cancels the turn in flight; the keys below only act on it while `canCancel` is true. */
  onCancel: () => void,
  canCancel: boolean,
): void {
  useInput((input, key) => {
    if (input === "c" && key.ctrl) {
      // First Ctrl+C stops a running turn; with nothing running it quits.
      if (canCancel) onCancel();
      else onExit();
      return;
    }

    if (key.escape && canCancel && viewMode === "chat") {
      onCancel();
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
