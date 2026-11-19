import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceView } from "./WorkspaceView.js";
import { useWorkspace } from "./workspaceStore.js";
import { clampWorkspaceWidth, defaultWorkspaceWidth, readSavedWidth, saveWidth } from "./splitWidth.js";

/**
 * The chat tab as a split view: the chat on the left and, once something has been opened from it, the
 * workspace container (tabs) on the right with a draggable divider. With nothing open the chat takes the
 * whole width, exactly as before. This is in the layout flow on purpose — unlike the file side panel it
 * never floats over the chat.
 */
export function ChatSplit({ chat }: { chat: ReactNode }) {
  const { tabs } = useWorkspace();
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const open = tabs.length > 0;

  const containerWidth = () => hostRef.current?.clientWidth ?? window.innerWidth;

  // The first time the workspace appears: the saved width, or about half.
  useEffect(() => {
    if (open && width === null) setWidth(clampWorkspaceWidth(readSavedWidth() ?? defaultWorkspaceWidth(containerWidth()), containerWidth()));
  }, [open, width]);

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = width ?? defaultWorkspaceWidth(containerWidth());
      const move = (m: PointerEvent) => setWidth(clampWorkspaceWidth(startWidth - (m.clientX - startX), containerWidth()));
      const up = (u: PointerEvent) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        saveWidth(clampWorkspaceWidth(startWidth - (u.clientX - startX), containerWidth()));
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    },
    [width],
  );

  return (
    <div className="chat-split" ref={hostRef}>
      <div className="chat-split-chat">{chat}</div>
      {open && (
        <>
          <div className="chat-split-resizer" onPointerDown={startResize} role="separator" aria-orientation="vertical" />
          <div className="chat-split-workspace" style={{ width: width ?? undefined }}>
            <WorkspaceView />
          </div>
        </>
      )}
    </div>
  );
}
