import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import { YGG_MONACO_THEME, ensureYggTheme } from "../files/monacoSetup.js";
import { languageFromPath } from "../files/languageFromPath.js";
import type { DiffContent } from "./types.js";
import { useI18n } from "../i18n/index.js";
import { useReviewComments } from "../review/useReviewComments.js";

/** Review comments on this diff (notes/features/code-review-comments.md): the repo/worktree root and the file's repo-relative path. */
export type DiffReview = { root?: string; path: string; commitSha?: string };

type Props = {
  path: string;
  modelKey: string;
  content: DiffContent | null;
  loading: boolean;
  sideBySide?: boolean;
  review?: DiffReview;
};

export function DiffViewer({ path, modelKey, content, loading, sideBySide = false, review }: Props) {
  const { t } = useI18n();
  const [editors, setEditors] = useState<{ modified: monaco.editor.IStandaloneCodeEditor; original: monaco.editor.IStandaloneCodeEditor } | null>(null);
  // Only while the DiffEditor is mounted: an unmounted one leaves disposed editors behind.
  const showing = Boolean(content && !content.binary && !content.tooLarge);
  const live = showing ? editors : null;
  useEffect(() => {
    if (!showing) setEditors(null);
  }, [showing]);
  // Unified mode draws the deleted lines inside the modified editor as view zones, where nothing can anchor:
  // the original side takes comments only when it's shown as its own editor (split).
  const modifiedPortals = useReviewComments(review ? (live?.modified ?? null) : null, {
    root: review?.root,
    path: review?.path,
    side: "modified",
    commitSha: review?.commitSha,
  });
  const originalPortals = useReviewComments(review && sideBySide ? (live?.original ?? null) : null, {
    root: review?.root,
    path: review?.path,
    side: "original",
    commitSha: review?.commitSha,
  });

  // Same for a path change on a mounted editor: make sure both sides show this diff's text.
  useEffect(() => {
    if (!live || !content) return;
    const original = live.original.getModel();
    const modified = live.modified.getModel();
    if (original && original.getValue() !== content.original) original.setValue(content.original);
    if (modified && modified.getValue() !== content.modified) modified.setValue(content.modified);
  }, [live, content, modelKey]);

  if (loading && !content) return <div className="repo-empty">{t("repo.diff.loading")}</div>;
  if (!content) return <div className="repo-empty">{t("repo.diff.select")}</div>;
  if (content.binary) return <div className="repo-empty">{t("repo.diff.binary")}</div>;
  if (content.tooLarge) return <div className="repo-empty">{t("repo.diff.tooLarge")}</div>;
  return (
    <>
      <DiffEditor
        originalModelPath={`original:${modelKey}`}
        modifiedModelPath={`modified:${modelKey}`}
        language={languageFromPath(path)}
        original={content.original}
        modified={content.modified}
        theme={YGG_MONACO_THEME}
        beforeMount={() => ensureYggTheme()}
        onMount={(diff) => {
          // @monaco-editor/react reuses a model already registered under the same path without updating its
          // text (getOrCreateModel), so a model left over from an earlier render can show stale content.
          const models = diff.getModel();
          if (models && models.original.getValue() !== content.original) models.original.setValue(content.original);
          if (models && models.modified.getValue() !== content.modified) models.modified.setValue(content.modified);
          setEditors({ modified: diff.getModifiedEditor(), original: diff.getOriginalEditor() });
        }}
        options={{
          readOnly: true,
          renderSideBySide: sideBySide,
          renderSideBySideInlineBreakpoint: 0,
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          fontSize: 13,
          folding: false,
          stickyScroll: { enabled: false },
          colorDecorators: false,
          glyphMargin: Boolean(review?.root),
        }}
      />
      {modifiedPortals}
      {originalPortals}
    </>
  );
}
