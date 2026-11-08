import type { Attachment } from "../types.js";

/**
 * Module-level pub-sub so the file tree (in the sidebar, no shared ancestor with
 * ChatView) can attach a file to the chat's composer. Same shape as the other
 * bridges (terminal/terminalBridge.ts, chat/mainTabsBridge.ts).
 */
type Listener = (attachment: Attachment) => void;

let listener: Listener | null = null;

/** ChatView registers how to add an attachment to its pending message. */
export function onChatAttach(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Returns false when no chat is mounted to receive it. */
export function requestChatAttach(attachment: Attachment): boolean {
  if (!listener) return false;
  listener(attachment);
  return true;
}
