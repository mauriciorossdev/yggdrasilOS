import { useEffect, type RefObject } from "react";

/**
 * Calls `onDismiss` when the user presses Escape or mouses down outside `ref`.
 * Replaces the copy of this effect that every popup menu used to carry.
 * Pass `enabled: false` to listen only while a popup is open.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, onDismiss: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, onDismiss, enabled]);
}
