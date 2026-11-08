import { useState } from "react";
import { useI18n } from "../i18n/index.js";
import { otherKeys, parseProps, setProperty, type KnownKey } from "./frontmatter.js";

type Props = {
  /** The whole markdown document, front matter included. */
  markdown: string;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
};

const STATUS_SUGGESTIONS = ["doc.props.status.draft", "doc.props.status.inProgress", "doc.props.status.inReview", "doc.props.status.done"] as const;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Title, status, date and tags of a note as fields; the YAML underneath is edited line by line. */
export function PropertiesPanel({ markdown, onChange, readOnly }: Props) {
  const { t: tr } = useI18n();
  const props = parseProps(markdown);
  const others = otherKeys(markdown);
  const [tagDraft, setTagDraft] = useState("");

  const set = (key: KnownKey, value: string | string[]) => onChange(setProperty(markdown, key, value));

  const addTags = (text: string) => {
    const added = text.split(",").map((t) => t.trim()).filter(Boolean);
    if (added.length === 0) return;
    const merged = [...props.tags];
    for (const t of added) if (!merged.includes(t.replace(/^#+/, ""))) merged.push(t);
    set("tags", merged);
  };

  const dateIsStandard = props.date === "" || DATE_FORMAT.test(props.date);

  return (
    <div className="props-panel">
      <label className="props-field">
        <span className="props-label">{tr("doc.props.title")}</span>
        <input
          type="text"
          value={props.title}
          disabled={readOnly}
          placeholder={tr("doc.props.noTitle")}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>

      <label className="props-field">
        <span className="props-label">{tr("doc.props.status")}</span>
        <input
          type="text"
          list="props-status-options"
          value={props.status}
          disabled={readOnly}
          placeholder={tr("doc.props.noStatus")}
          onChange={(e) => set("status", e.target.value)}
        />
        <datalist id="props-status-options">
          {STATUS_SUGGESTIONS.map((s) => (
            <option key={s} value={tr(s)} />
          ))}
        </datalist>
      </label>

      <div className="props-field">
        <span className="props-label">{tr("doc.props.date")}</span>
        <div className="props-row">
          <input
            type={dateIsStandard ? "date" : "text"}
            aria-label={tr("doc.props.date")}
            value={props.date}
            disabled={readOnly}
            onChange={(e) => set("date", e.target.value)}
          />
          {!readOnly && props.date !== today() && (
            <button type="button" className="props-mini" onClick={() => set("date", today())}>
              {tr("doc.props.today")}
            </button>
          )}
        </div>
      </div>

      <div className="props-field">
        <span className="props-label">{tr("doc.props.tags")}</span>
        <div className="props-tags">
          {props.tags.map((t) => (
            <span key={t} className="props-tag">
              {t}
              {!readOnly && (
                <button type="button" aria-label={tr("doc.props.removeTag", { tag: t })} onClick={() => set("tags", props.tags.filter((x) => x !== t))}>
                  ×
                </button>
              )}
            </span>
          ))}
          {!readOnly && (
            <input
              type="text"
              aria-label={tr("doc.props.addTag")}
              value={tagDraft}
              placeholder={props.tags.length === 0 ? tr("doc.props.addTag") : "+"}
              onChange={(e) => {
                const v = e.target.value;
                if (v.includes(",")) {
                  addTags(v);
                  setTagDraft("");
                } else {
                  setTagDraft(v);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTags(tagDraft);
                  setTagDraft("");
                } else if (e.key === "Backspace" && tagDraft === "" && props.tags.length > 0) {
                  set("tags", props.tags.slice(0, -1));
                }
              }}
              onBlur={() => {
                addTags(tagDraft);
                setTagDraft("");
              }}
            />
          )}
        </div>
      </div>

      {others.length > 0 && (
        <p className="props-others">
          {tr(others.length === 1 ? "doc.props.othersOne" : "doc.props.others", { count: others.length, keys: others.join(", ") })}
        </p>
      )}
    </div>
  );
}
