import { useEffect, useRef, useState, type ReactNode } from "react";
import * as monaco from "monaco-editor";
import { ExclamationTriangleIcon, XCircleIcon } from "@heroicons/react/20/solid";
import { useI18n } from "../i18n/index.js";
import { countMarkers, sortMarkers, SEVERITY_ERROR } from "./markers.js";
import { onDiagnosticsChanged, openProblem, otherFilesProblems, type ProjectProblem } from "./lsp/service.js";

type Editor = monaco.editor.IStandaloneCodeEditor;
type Marker = monaco.editor.IMarker;

type Info = {
  line: number;
  column: number;
  selected: number;
  language: string;
  indent: { spaces: boolean; size: number };
  eol: "LF" | "CRLF";
};

function readInfo(editor: Editor): Info | null {
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) return null;
  const selection = editor.getSelection();
  const options = model.getOptions();
  return {
    line: position.lineNumber,
    column: position.column,
    selected: selection ? model.getValueInRange(selection).length : 0,
    language: model.getLanguageId(),
    indent: { spaces: options.insertSpaces, size: options.indentSize },
    eol: model.getEOL() === "\r\n" ? "CRLF" : "LF",
  };
}

/** The open file's problems, kept current as language services report them. */
function useMarkers(editor: Editor | null): Marker[] {
  const [markers, setMarkers] = useState<Marker[]>([]);
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const model = editor.getModel();
      setMarkers(model ? monaco.editor.getModelMarkers({ resource: model.uri }) : []);
    };
    read();
    const onMarkers = monaco.editor.onDidChangeMarkers((uris) => {
      const current = editor.getModel()?.uri.toString();
      if (uris.some((uri) => uri.toString() === current)) read();
    });
    const onModel = editor.onDidChangeModel(read);
    return () => {
      onMarkers.dispose();
      onModel.dispose();
    };
  }, [editor]);
  return markers;
}

/** Problems servers have reported in files other than the one showing. */
function useOtherProblems(editor: Editor | null, active: boolean): ProjectProblem[] {
  const [problems, setProblems] = useState<ProjectProblem[]>([]);
  useEffect(() => {
    if (!active) return;
    const read = () => setProblems(otherFilesProblems(editor?.getModel()?.uri.toString()));
    read();
    const offDiagnostics = onDiagnosticsChanged(read);
    const onModel = editor?.onDidChangeModel(read);
    return () => {
      offDiagnostics();
      onModel?.dispose();
    };
  }, [editor, active]);
  return problems;
}

type Props = {
  editor: Editor | null;
  /** Where the host shows the save state. */
  status?: ReactNode;
};

/** Cursor, selection, language, indentation, line endings and a problems list for code files. */
export function CodeStatusBar({ editor, status }: Props) {
  const { t } = useI18n();
  const [info, setInfo] = useState<Info | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const markers = useMarkers(editor);
  const others = useOtherProblems(editor, problemsOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const { errors, warnings } = countMarkers(markers);

  useEffect(() => {
    if (!editor) return;
    const read = () => setInfo(readInfo(editor));
    read();
    const subs = [
      editor.onDidChangeCursorPosition(read),
      editor.onDidChangeCursorSelection(read),
      editor.onDidChangeModel(read),
      editor.onDidChangeModelLanguage(read),
      editor.onDidChangeModelOptions(read),
      editor.onDidChangeModelContent(read),
    ];
    return () => subs.forEach((sub) => sub.dispose());
  }, [editor]);

  const goTo = (marker: Marker) => {
    if (!editor) return;
    const position = { lineNumber: marker.startLineNumber, column: marker.startColumn };
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
    editor.focus();
  };

  return (
    <>
      {problemsOpen && (
        <div className="code-problems" role="region" aria-label={t("doc.status.problems")} ref={panelRef}>
          {markers.length === 0 && others.length === 0 && <p className="muted">{t("doc.status.noProblems")}</p>}
          {sortMarkers(markers).map((marker, i) => (
            <button type="button" key={i} className="code-problem" onClick={() => goTo(marker)}>
              {marker.severity === SEVERITY_ERROR ? (
                <XCircleIcon className="hero-icon code-problem-error" />
              ) : (
                <ExclamationTriangleIcon className="hero-icon code-problem-warning" />
              )}
              <span className="code-problem-message">{marker.message}</span>
              {marker.source && <span className="code-problem-meta">{marker.source}</span>}
              <span className="code-problem-meta">
                {marker.startLineNumber}:{marker.startColumn}
              </span>
            </button>
          ))}
          {sortMarkers(others).map((problem, i) => (
            <button type="button" key={`other-${i}`} className="code-problem" onClick={() => panelRef.current && openProblem(panelRef.current, problem)}>
              {problem.severity === SEVERITY_ERROR ? (
                <XCircleIcon className="hero-icon code-problem-error" />
              ) : (
                <ExclamationTriangleIcon className="hero-icon code-problem-warning" />
              )}
              <span className="code-problem-message">{problem.message}</span>
              <span className="code-problem-meta">
                {problem.path}:{problem.startLineNumber}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="text-status-bar">
        <button
          type="button"
          className="code-status-problems"
          aria-expanded={problemsOpen}
          title={t("doc.status.problems")}
          onClick={() => setProblemsOpen((open) => !open)}
        >
          <XCircleIcon className="hero-icon" /> {errors}
          <ExclamationTriangleIcon className="hero-icon" /> {warnings}
        </button>
        <span className="text-status-spacer" />
        {status}
        {info && (
          <>
            <span>
              {t("doc.status.position", { line: info.line, column: info.column })}
              {info.selected > 0 && ` ${t("doc.status.selected", { count: info.selected })}`}
            </span>
            <span>{info.indent.spaces ? t("doc.status.spaces", { size: info.indent.size }) : t("doc.status.tabs", { size: info.indent.size })}</span>
            <span>{info.eol}</span>
            <span>{info.language}</span>
          </>
        )}
      </div>
    </>
  );
}
