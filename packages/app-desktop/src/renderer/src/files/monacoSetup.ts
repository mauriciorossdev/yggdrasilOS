import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import { getThemeColors, onThemeApplied } from "../ui/theme/themeRuntime.js";
import { monacoThemeData } from "../ui/theme/surfaces.js";
import { setLanguageCatalog } from "./languageFromPath.js";
import { monacoWorkerKind, type MonacoWorkerKind } from "./monacoWorkerKind.js";
import { registerGdscript } from "./gdscriptLanguage.js";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker";
import CssWorker from "monaco-editor/languages/features/css/css.worker?worker";
import HtmlWorker from "monaco-editor/languages/features/html/html.worker?worker";

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

const WORKERS: Record<MonacoWorkerKind, new () => Worker> = {
  typescript: TsWorker,
  json: JsonWorker,
  css: CssWorker,
  html: HtmlWorker,
  editor: EditorWorker,
};

// getWorker receives every worker request, including the language services',
// so each one has to get the worker that implements its features.
(self as typeof self & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: (_moduleId, label) => new WORKERS[monacoWorkerKind(label)](),
};

registerGdscript(monaco);
setLanguageCatalog(monaco.languages.getLanguages());

// The TS worker only sees open files, so it would report every import of a
// closed file as "Cannot find module". Semantic checks stay off; project
// windows get those from a language server (files/lsp/).
const tsCompilerOptions: monaco.typescript.CompilerOptions = {
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
  jsx: monaco.typescript.JsxEmit.Preserve,
  allowJs: true,
  esModuleInterop: true,
  allowNonTsExtensions: true,
};
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setCompilerOptions(tsCompilerOptions);
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  defaults.setEagerModelSync(true);
  // A project window's language server handles TS/JS, and two providers would double every completion,
  // hover and quick fix. Monaco reads this once, when the first TS model appears, so it has to be set
  // here and can't be switched back later. The bundled server ships with the app, so it's always there.
  if (window.yggdrasil?.projectPath) {
    defaults.setModeConfiguration({
      completionItems: false,
      hovers: false,
      documentSymbols: false,
      definitions: false,
      references: false,
      documentHighlights: false,
      rename: false,
      diagnostics: false,
      documentRangeFormattingEdits: false,
      signatureHelp: false,
      onTypeFormattingEdits: false,
      codeActions: false,
      inlayHints: false,
    });
  }
}

// tsconfig-style JSON with comments and trailing commas is common in real projects.
// setDiagnosticsOptions/setOptions replace the whole object, hence the spreads.
monaco.json.jsonDefaults.setDiagnosticsOptions({
  ...monaco.json.jsonDefaults.diagnosticsOptions,
  comments: "ignore",
  trailingCommas: "ignore",
});

// Tailwind and PostCSS at-rules (@apply, @tailwind...) aren't errors.
for (const defaults of [monaco.css.cssDefaults, monaco.css.scssDefaults, monaco.css.lessDefaults]) {
  // Monaco's types omit this rule, but the CSS service reads it.
  const lint: typeof defaults.options.lint & { unknownAtRules: "ignore" } = { ...defaults.options.lint, unknownAtRules: "ignore" };
  defaults.setOptions({ ...defaults.options, lint });
}
