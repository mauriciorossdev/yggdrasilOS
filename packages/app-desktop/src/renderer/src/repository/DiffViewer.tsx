import { DiffEditor } from "@monaco-editor/react";
import "../files/monacoSetup.js";
import { languageFromPath } from "../files/languageFromPath.js";
import type { DiffContent } from "./types.js";

type Props = { path: string; modelKey: string; content: DiffContent | null; loading: boolean };

export function DiffViewer({ path, modelKey, content, loading }: Props) {
  if (loading && !content) return <div className="repo-empty">Cargando diff…</div>;
  if (!content) return <div className="repo-empty">Seleccioná un archivo para ver sus cambios</div>;
  if (content.binary) return <div className="repo-empty">Archivo binario — sin vista de diff</div>;
  if (content.tooLarge) return <div className="repo-empty">Archivo demasiado grande para mostrar el diff</div>;
  return (
    <DiffEditor
      originalModelPath={`original:${modelKey}`}
      modifiedModelPath={`modified:${modelKey}`}
      language={languageFromPath(path)}
      original={content.original}
      modified={content.modified}
      theme="vs-dark"
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        fontSize: 13,
        folding: false,
        stickyScroll: { enabled: false },
        colorDecorators: false,
      }}
    />
  );
}
