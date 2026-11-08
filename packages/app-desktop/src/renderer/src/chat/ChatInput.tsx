import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { DocumentIcon, FolderIcon, PaperClipIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import type { Attachment, FsSearchResult } from "../types.js";
import { FILE_DRAG_MIME, type FileDragPayload } from "../files/dragMimeType.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  disabled: boolean;
  isStreaming?: boolean;
  onSend: (text: string) => void;
  onStop?: () => void;
  attachments: Attachment[];
  onAttach: (a: Attachment) => void;
  onRemoveAttachment: (relativePath: string) => void;
  onCycleMode?: () => void;
};

const MENTION_PATTERN = /@(\S*)$/;

function basename(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}

export function ChatInput({ disabled, isStreaming, onSend, onStop, attachments, onAttach, onRemoveAttachment, onCycleMode }: Props) {
  const { call } = useGateway();
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionResults, setMentionResults] = useState<FsSearchResult["entries"]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
    setMentionOpen(false);
  };

  const checkMention = (text: string, cursor: number) => {
    const upToCursor = text.slice(0, cursor);
    const match = upToCursor.match(MENTION_PATTERN);
    if (!match) {
      setMentionOpen(false);
      return;
    }
    setMentionOpen(true);
    setMentionIndex(0);
    const query = match[1] ?? "";
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await call<FsSearchResult>("fs.search", { query, limit: 8 });
        setMentionResults(res.entries);
      } catch {
        setMentionResults([]);
      }
    }, 150);
  };

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const pickMention = (entry: FsSearchResult["entries"][number]) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? value.length;
    const upToCursor = value.slice(0, cursor);
    const replaced = upToCursor.replace(MENTION_PATTERN, "");
    const next = replaced + value.slice(cursor);
    setValue(next);
    setMentionOpen(false);
    onAttach({ relativePath: entry.relativePath, type: entry.type });
    requestAnimationFrame(() => textarea?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pickMention(mentionResults[mentionIndex]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      onCycleMode?.();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // The paperclip: a native picker that opens on the project. Anything outside it can't be
  // attached (the gateway reads attachments from the project), so say so instead of skipping it quietly.
  const pickFiles = async () => {
    setAttachNote(null);
    try {
      const { attachments: picked, rejected } = await window.yggdrasil.files.pickToAttach();
      picked.forEach(onAttach);
      if (rejected.length > 0) {
        setAttachNote(
          rejected.length === 1 ? t("chat.input.outsideOne") : t("chat.input.outsideMany", { count: rejected.length }),
        );
      }
    } catch (err) {
      setAttachNote(err instanceof Error ? err.message : String(err));
    }
  };

  const onDragOver = (e: DragEvent<HTMLFormElement>) => {
    if (e.dataTransfer.types.includes(FILE_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const onDrop = (e: DragEvent<HTMLFormElement>) => {
    const raw = e.dataTransfer.getData(FILE_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    try {
      const payload = JSON.parse(raw) as FileDragPayload;
      onAttach(payload);
    } catch {
      /* ignore malformed payload */
    }
  };

  return (
    <form
      className="chat-input"
      onSubmit={(e) => {
        e.preventDefault();
        if (isStreaming) {
          onStop?.();
        } else {
          submit();
        }
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="chat-input-main">
        {attachNote && (
          <div className="attachment-note" role="status">
            {attachNote}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((a) => (
              <div key={a.relativePath} className="attachment-chip">
                <span className="attachment-chip-name">{basename(a.relativePath)}</span>
                <button type="button" onClick={() => onRemoveAttachment(a.relativePath)}>
                  <XMarkIcon className="hero-icon" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-input-textarea-wrap">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              checkMention(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
            placeholder={t("chat.input.placeholder")}
            rows={2}
            disabled={disabled || isStreaming}
          />
          {mentionOpen && mentionResults.length > 0 && (
            <div className="mention-dropdown">
              {mentionResults.map((entry, i) => (
                <button
                  type="button"
                  key={entry.relativePath}
                  className={`mention-item ${i === mentionIndex ? "active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(entry);
                  }}
                >
                  {entry.type === "directory" ? (
                    <FolderIcon className="hero-icon" />
                  ) : (
                    <DocumentIcon className="hero-icon" />
                  )}{" "}
                  {entry.relativePath}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        className="icon-btn chat-attach-btn"
        title={t("chat.input.attach")}
        aria-label={t("chat.input.attach")}
        onClick={() => void pickFiles()}
        disabled={disabled || isStreaming}
      >
        <PaperClipIcon className="hero-icon" />
      </button>
      <button type="submit" disabled={disabled && !isStreaming}>
        {isStreaming ? t("chat.input.stop") : t("chat.input.send")}
      </button>
    </form>
  );
}
