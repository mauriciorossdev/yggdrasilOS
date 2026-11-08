import type { Editor } from "@tiptap/react";
import { useEditorTick } from "./useEditorTick.js";
import { TABLE_ACTIONS } from "./tableControls.js";
import { useI18n } from "../i18n/index.js";

type Props = { editor: Editor; readOnly?: boolean };

/**
 * A row under the toolbar that shows up only when it has something to say: the table's controls while the
 * cursor is in a table, the alt text of an image while one is selected.
 */
export function ContextBar({ editor, readOnly }: Props) {
  const { t } = useI18n();
  useEditorTick(editor);
  if (readOnly) return null;

  if (editor.isActive("image")) {
    const alt = (editor.getAttributes("image").alt as string | null) ?? "";
    return (
      <div className="context-bar" role="toolbar" aria-label={t("doc.image")}>
        <span className="context-bar-label">{t("doc.image")}</span>
        <input
          type="text"
          value={alt}
          placeholder={t("doc.image.altPlaceholder")}
          aria-label={t("doc.image.altLabel")}
          spellCheck={false}
          onChange={(e) => editor.chain().updateAttributes("image", { alt: e.target.value }).run()}
        />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteSelection().run()}>
          {t("doc.image.remove")}
        </button>
      </div>
    );
  }

  if (editor.isActive("table")) {
    return (
      <div className="context-bar" role="toolbar" aria-label={t("doc.table")}>
        <span className="context-bar-label">{t("doc.table")}</span>
        {TABLE_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            title={t(action.title)}
            disabled={!action.can(editor)}
            className={action.id.startsWith("delete") ? "danger" : ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => action.run(editor)}
          >
            {t(action.label)}
          </button>
        ))}
      </div>
    );
  }

  return null;
}
