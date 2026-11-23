import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as monaco from "monaco-editor";
import { t as tStandalone, useI18n } from "../i18n/index.js";
import type { CodeCommentSide } from "../types.js";
import { locateComment } from "./anchor.js";
import { refreshCodeComments, useCodeComments, useHideDoneComments, useRevealRequest } from "./codeCommentsStore.js";
import { linesLabel, Measured, ReviewCard, ReviewComposer } from "./ReviewCard.js";
import { ZoneSlot } from "./zoneSlot.js";

export type ReviewTarget = {
  /** Absolute repo/worktree root (main/codeCommentsHost.ts's locate). Nothing is shown without it. */
  root?: string;
  /** Repo-relative path of the file this editor shows. */
  path?: string;
  side: CodeCommentSide;
  /** Set when the editor shows a commit from the history. */
  commitSha?: string;
};

type Range = { startLine: number; endLine: number };

const GLYPH = monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;

/** Cleanups run after a diff editor may already be disposed; there's nothing left to undo then. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // editor disposed
  }
}

/**
 * Review comments on one Monaco editor (a side of a diff, or the file editor):
 * a "+" in the glyph margin (click a line or drag a range), ⌘⇧M on a selection,
 * the composer under the lines, and the saved comments as cards. Returns the
 * portals to render. See notes/features/code-review-comments.md.
 */
export function useReviewComments(editor: monaco.editor.IStandaloneCodeEditor | null, target: ReviewTarget): ReactNode {
  const { t } = useI18n();
  const { root, path, side, commitSha } = target;
  const all = useCodeComments(root);
  const hideDone = useHideDoneComments();
  const reveal = useRevealRequest();
  const [composer, setComposer] = useState<Range | null>(null);
  const [textVersion, setTextVersion] = useState(0);
  const [, setSlotsVersion] = useState(0);
  const slots = useRef(new Map<string, ZoneSlot>());
  const enabled = Boolean(editor && root && path);

  const comments = useMemo(
    () =>
      all.filter(
        (c) => c.path === path && c.side === side && (c.commitSha ?? "") === (commitSha ?? "") && !(hideDone && c.status === "done"),
      ),
    [all, path, side, commitSha, hideDone],
  );

  // Where each comment's lines are now (the text may have moved since it was made).
  const located = useMemo(() => {
    const model = editor?.getModel();
    const lines = model ? model.getLinesContent() : [];
    return comments.map((c) => ({ c, loc: lines.length ? locateComment(c, lines) : null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- textVersion stands for the model's content
  }, [comments, editor, textVersion]);

  // A new file in the same editor, or the target changing, drops a half-written comment.
  useEffect(() => setComposer(null), [editor, root, path, side, commitSha]);

  // Re-anchor after edits (the file editor) and when the diff loads new content.
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setTextVersion((v) => v + 1), 250);
    };
    const subs = [editor.onDidChangeModelContent(bump), editor.onDidChangeModel(bump)];
    bump();
    return () => {
      clearTimeout(timer);
      subs.forEach((s) => s.dispose());
    };
  }, [editor]);

  // Gutter: "+" on hover, click or drag to pick lines; ⌘⇧M / context menu on a selection.
  useEffect(() => {
    if (!editor || !enabled) return;
    editor.updateOptions({ glyphMargin: true });
    const hover = editor.createDecorationsCollection();
    let drag: number | null = null;
    const show = (r: Range | null, cls: string) =>
      hover.set(
        r
          ? [
              {
                range: new monaco.Range(r.startLine, 1, r.endLine, 1),
                options: { isWholeLine: true, className: "review-line-picking", glyphMarginClassName: cls },
              },
            ]
          : [],
      );
    const subs: monaco.IDisposable[] = [
      editor.onMouseMove((e) => {
        const line = e.target.position?.lineNumber;
        if (drag !== null && line) {
          show({ startLine: Math.min(drag, line), endLine: Math.max(drag, line) }, "review-glyph-plus");
        } else if (e.target.type === GLYPH && line) {
          hover.set([{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: "review-glyph-plus" } }]);
        } else {
          hover.clear();
        }
      }),
      editor.onMouseLeave(() => drag === null && hover.clear()),
      editor.onMouseDown((e) => {
        if (e.target.type !== GLYPH || !e.target.position) return;
        drag = e.target.position.lineNumber;
        show({ startLine: drag, endLine: drag }, "review-glyph-plus");
      }),
      editor.onMouseUp((e) => {
        if (drag === null) return;
        const line = e.target.position?.lineNumber ?? drag;
        setComposer({ startLine: Math.min(drag, line), endLine: Math.max(drag, line) });
        drag = null;
        hover.clear();
      }),
      editor.addAction({
        id: "ygg.review.comment",
        label: tStandalone("review.action"),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM],
        contextMenuGroupId: "navigation",
        contextMenuOrder: 0,
        run: (ed) => {
          const sel = ed.getSelection();
          if (!sel) return;
          const end = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber;
          setComposer({ startLine: sel.startLineNumber, endLine: end });
        },
      }),
    ];
    return () => {
      subs.forEach((s) => s.dispose());
      safely(() => hover.clear());
    };
  }, [editor, enabled]);

  // Margin dot and a faint highlight on the lines of each comment.
  useEffect(() => {
    if (!editor || !enabled) return;
    const marks = editor.createDecorationsCollection(
      located.flatMap(({ c, loc }) =>
        loc
          ? [
              {
                range: new monaco.Range(loc.startLine, 1, loc.endLine, 1),
                options: {
                  isWholeLine: true,
                  className: c.status === "done" ? undefined : `review-line review-line--${c.status}`,
                },
              },
              {
                range: new monaco.Range(loc.startLine, 1, loc.startLine, 1),
                options: { glyphMarginClassName: `review-glyph-dot review-glyph-dot--${c.status}` },
              },
            ]
          : [],
      ),
    );
    return () => safely(() => marks.clear());
  }, [editor, enabled, located]);

  // One view zone per card (and one for the composer), kept in step with the list.
  const items = useMemo(() => {
    const lineCount = editor?.getModel()?.getLineCount() ?? 0;
    const list: Array<{ key: string; after: number }> = located.map(({ c, loc }) => ({
      key: c.id,
      after: Math.min(loc?.endLine ?? c.endLine, Math.max(lineCount, 1)),
    }));
    if (composer) list.push({ key: "composer", after: composer.endLine });
    return list;
  }, [located, composer, editor]);

  useEffect(() => {
    if (!editor || !enabled) return;
    const live = slots.current;
    let changed = false;
    const keep = new Set(items.map((i) => i.key));
    for (const [key, slot] of live) {
      if (!keep.has(key)) {
        slot.dispose();
        live.delete(key);
        changed = true;
      }
    }
    for (const { key, after } of items) {
      const slot = live.get(key);
      if (slot) slot.moveTo(after);
      else {
        live.set(key, new ZoneSlot(editor, `${key}-${Math.random().toString(36).slice(2, 8)}`, after));
        changed = true;
      }
    }
    if (changed) setSlotsVersion((v) => v + 1);
  }, [editor, enabled, items]);

  // The editor going away (or changing) takes its zones with it.
  useEffect(() => {
    const live = slots.current;
    return () => {
      live.forEach((s) => s.dispose());
      live.clear();
    };
  }, [editor]);

  // "Ver todos" → scroll to the comment, in whichever editor shows it.
  useEffect(() => {
    if (!editor || !reveal || reveal.root !== root || reveal.path !== path) return;
    const hit = located.find(({ c }) => c.id === reveal.id);
    if (!hit) return;
    const line = hit.loc?.startLine ?? hit.c.startLine;
    editor.revealLineInCenter(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request (nonce), not on every re-anchor
  }, [reveal?.nonce, editor]);

  const snippetOf = useCallback(
    (r: Range) => {
      const model = editor?.getModel();
      if (!model) return "";
      const end = Math.min(r.endLine, model.getLineCount());
      return model.getValueInRange(new monaco.Range(r.startLine, 1, end, model.getLineMaxColumn(end)));
    },
    [editor],
  );

  if (!editor || !enabled || !root || !path) return null;

  const portals: ReactNode[] = [];
  for (const { c, loc } of located) {
    const slot = slots.current.get(c.id);
    if (!slot) continue;
    portals.push(
      createPortal(
        <Measured onHeight={(h) => slot.setHeight(h)}>
          <ReviewCard
            comment={c}
            location={loc}
            onEdit={async (text) => {
              await window.yggdrasil.codeComments.update(root, c.id, text);
              await refreshCodeComments(root);
            }}
            onDelete={() => void window.yggdrasil.codeComments.remove(root, c.id).then(() => refreshCodeComments(root))}
            onStatus={(status) => void window.yggdrasil.codeComments.setStatus([c.id], status).then(() => refreshCodeComments(root))}
          />
        </Measured>,
        slot.dom,
        c.id,
      ),
    );
  }
  const composerSlot = slots.current.get("composer");
  if (composer && composerSlot) {
    portals.push(
      createPortal(
        <Measured onHeight={(h) => composerSlot.setHeight(h)}>
          <ReviewComposer
            label={linesLabel(t, composer.startLine, composer.endLine)}
            onCancel={() => {
              setComposer(null);
              editor.focus();
            }}
            onSave={async (text) => {
              await window.yggdrasil.codeComments.add(root, {
                path,
                side,
                startLine: composer.startLine,
                endLine: composer.endLine,
                snippet: snippetOf(composer),
                commitSha,
                comment: text,
              });
              await refreshCodeComments(root);
              setComposer(null);
            }}
          />
        </Measured>,
        composerSlot.dom,
        "composer",
      ),
    );
  }
  return portals;
}
