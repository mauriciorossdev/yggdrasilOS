import { DiffEditor } from "@monaco-editor/react";
import { YGG_MONACO_THEME, ensureYggTheme } from "../files/monacoSetup.js";
import { languageFromPath } from "../files/languageFromPath.js";
import type { DiffContent } from "./types.js";
import { useI18n } from "../i18n/index.js";

type Props = { path: string; modelKey: string; content: DiffContent | null; loading: boolean; sideBySide?: boolean };

export function DiffViewer({ path, modelKey, content, loading, sideBySide = false }: Props) {
  const { t } = useI18n();
  if (loading && !content) return <div className="repo-empty">{t("repo.diff.loading")}</div>;
  if (!content) return <div className="repo-empty">{t("repo.diff.select")}</div>;
  if (content.binary) return <div className="repo-empty">{t("repo.diff.binary")}</div>;
  if (content.tooLarge) return <div className="repo-empty">{t("repo.diff.tooLarge")}</div>;
  return (
    <DiffEditor
      originalModelPath={`original:${modelKey}`}
      modifiedModelPath={`modified:${modelKey}`}
      language={languageFromPath(path)}
      original={content.original}
      modified={content.modified}
      theme={YGG_MONACO_THEME}
      beforeMount={() => ensureYggTheme()}
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
      }}
    />
  );
}
