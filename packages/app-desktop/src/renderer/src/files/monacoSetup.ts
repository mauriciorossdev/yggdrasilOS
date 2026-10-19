import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// @monaco-editor/react defaults to fetching Monaco from a CDN (jsdelivr) on
// first mount — wrong for this Electron app, which should work offline and
// shouldn't make an unannounced network request just to open a file. Point
// it at the monaco-editor package already bundled into the renderer.
loader.config({ monaco });

// Monaco needs a Worker per language (typescript, json, css, html...) for
// full semantic diagnostics/IntelliSense. Registering only the generic
// editor worker here keeps this simple and the bundle small, at the cost of
// those per-language features — this editor is for quick project/notes
// edits, not meant to replace a real IDE.
(self as typeof self & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
