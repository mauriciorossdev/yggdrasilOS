import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import { getThemeColors, onThemeApplied } from "../ui/theme/themeRuntime.js";
import { monacoThemeData } from "../ui/theme/surfaces.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// @monaco-editor/react defaults to fetching Monaco from a CDN (jsdelivr) on
// first mount — wrong for this Electron app, which should work offline and
// shouldn't make an unannounced network request just to open a file. Point
// it at the monaco-editor package already bundled into the renderer.
loader.config({ monaco });

// One Monaco theme ("ygg") built from the user's core colors, redefined when
// the theme changes. Editors pass theme={YGG_MONACO_THEME} and call
// ensureYggTheme in beforeMount so the theme exists before the first paint.
export const YGG_MONACO_THEME = "ygg";

export function ensureYggTheme(instance: typeof monaco = monaco): void {
  instance.editor.defineTheme(YGG_MONACO_THEME, monacoThemeData(getThemeColors()));
}

ensureYggTheme();
onThemeApplied(() => {
  ensureYggTheme();
  monaco.editor.setTheme(YGG_MONACO_THEME);
});

// Monaco needs a Worker per language (typescript, json, css, html...) for
// full semantic diagnostics/IntelliSense. Registering only the generic
// editor worker here keeps this simple and the bundle small, at the cost of
// those per-language features — this editor is for quick project/notes
// edits, not meant to replace a real IDE.
(self as typeof self & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
