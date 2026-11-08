import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

/** Re-renders the caller whenever the rich editor's selection or content changes, so UI derived from it stays current. */
export function useEditorTick(editor: Editor | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((t) => t + 1);
    editor.on("transaction", bump);
    editor.on("selectionUpdate", bump);
    return () => {
      editor.off("transaction", bump);
      editor.off("selectionUpdate", bump);
    };
  }, [editor]);
}
