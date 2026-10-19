import { useRef } from "react";

type Props = {
  direction: "row" | "column";
  onResize: (deltaFraction: number) => void;
};

/** A draggable divider between two adjacent panes in a split. Reports each move as an *incremental* delta (fraction of the parent split container's size along its axis, since the previous move) — the caller just adds it straight onto the two neighboring panes' current `sizes`, no drag-start snapshot needed. */
export function PaneDivider({ direction, onResize }: Props) {
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const axisSize = direction === "row" ? rect.width : rect.height;
    let last = direction === "row" ? e.clientX : e.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      if (axisSize === 0) return;
      const current = direction === "row" ? moveEvent.clientX : moveEvent.clientY;
      onResizeRef.current((current - last) / axisSize);
      last = current;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return <div className={`pane-divider ${direction}`} onPointerDown={onPointerDown} />;
}
