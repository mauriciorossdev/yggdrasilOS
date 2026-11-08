import { useState } from "react";
import { outlineDepths, type OutlineItem } from "./outline.js";
import type { Backlink } from "../documents/notesIndex.js";
import { PropertiesPanel } from "./PropertiesPanel.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  items: OutlineItem[];
  /** Index of the heading the reader is in, or -1. */
  activeIndex: number;
  onSelect: (item: OutlineItem, index: number) => void;
  /** Notes that link to this one; omit where there are no links between notes (the Files tab). */
  backlinks?: Backlink[];
  onOpenBacklink?: (backlink: Backlink) => void;
  /** The whole document, to edit its front matter as fields. */
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  readOnly?: boolean;
  onClose: () => void;
};

type Tab = "outline" | "properties" | "backlinks";

/** Beside the editor: the document's headings (a click jumps to the section) and, in Documents, the notes that link to it. */
export function SidePanel({ items, activeIndex, onSelect, backlinks, onOpenBacklink, markdown, onMarkdownChange, readOnly, onClose }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("outline");
  const current: Tab = tab === "backlinks" && !backlinks ? "outline" : tab;
  const depths = outlineDepths(items);

  return (
    <aside className="outline-panel" aria-label={t("doc.side.label")}>
      <div className="outline-panel-head">
        <div className="side-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={current === "outline"} onClick={() => setTab("outline")}>
            {t("doc.side.outline")}
          </button>
          <button type="button" role="tab" aria-selected={current === "properties"} onClick={() => setTab("properties")}>
            {t("doc.side.properties")}
          </button>
          {backlinks && (
            <button type="button" role="tab" aria-selected={current === "backlinks"} onClick={() => setTab("backlinks")}>
              {t("doc.side.backlinks")}{backlinks.length > 0 ? ` (${backlinks.length})` : ""}
            </button>
          )}
        </div>
        <button type="button" className="side-close" title={t("doc.side.hide")} aria-label={t("doc.side.hide")} onClick={onClose}>
          ×
        </button>
      </div>

      {current === "outline" &&
        (items.length === 0 ? (
          <p className="outline-empty">{t("doc.side.noHeadings")}</p>
        ) : (
          <nav className="outline-list">
            {items.map((item, i) => (
              <button
                key={`${i}:${item.text}`}
                type="button"
                className={`outline-item${i === activeIndex ? " active" : ""}`}
                style={{ paddingLeft: 10 + depths[i]! * 14 }}
                title={item.text}
                aria-current={i === activeIndex ? "location" : undefined}
                onClick={() => onSelect(item, i)}
              >
                <span className="outline-level">H{item.level}</span>
                <span className="outline-text">{item.text}</span>
              </button>
            ))}
          </nav>
        ))}

      {current === "properties" && <PropertiesPanel markdown={markdown} onChange={onMarkdownChange} readOnly={readOnly} />}

      {current === "backlinks" &&
        (!backlinks || backlinks.length === 0 ? (
          <p className="outline-empty">{t("doc.side.noBacklinks")}</p>
        ) : (
          <nav className="outline-list">
            {backlinks.map((b) => (
              <button
                key={`${b.path}:${b.line}`}
                type="button"
                className="backlink-item"
                title={b.path}
                onClick={() => onOpenBacklink?.(b)}
              >
                <span className="backlink-title">{b.title}</span>
                <span className="backlink-path">
                  {t("doc.side.backlinkLine", { path: b.path, line: b.line })}
                </span>
                <span className="backlink-text">{b.text}</span>
              </button>
            ))}
          </nav>
        ))}
    </aside>
  );
}
