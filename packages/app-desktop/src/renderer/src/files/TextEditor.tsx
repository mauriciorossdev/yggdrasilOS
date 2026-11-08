import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { editor as MonacoEditorNS } from "monaco-editor";
import { CodeEditor } from "./CodeEditor.js";
import { MarkdownToolbar } from "./MarkdownToolbar.js";
import { MarkdownRichEditor } from "./MarkdownRichEditor.js";
import { TextStatusBar } from "./TextStatusBar.js";
import { CodeStatusBar } from "./CodeStatusBar.js";
import { LspTrustBar } from "./LspTrustBar.js";
import { FindBar } from "./FindBar.js";
import { SidePanel } from "./SidePanel.js";
import { joinFrontmatter, splitFrontmatter } from "./frontmatter.js";
import type { Backlink, WikiItem } from "../documents/notesIndex.js";
import { ContextBar } from "./ContextBar.js";
import { activeOutlineIndex, extractOutline, outlineFromDoc, type OutlineItem } from "./outline.js";
import { useEditorTick } from "./useEditorTick.js";
import { languageFromPath } from "./languageFromPath.js";

/** Where to take the reader once a note opens from a search hit: the text to find and, in source view, the line. */
export type RevealTarget = { query: string; line?: number; nonce: number };

type Props = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** Shown in the status bar next to the mode switch (Documents puts its save state here). */
  status?: ReactNode;
  /** Opens the note at a search result; applied once per `nonce`. */
  reveal?: RevealTarget;
  /** Notes `[[` can link to. Omitted (the Files tab) = no note linking. */
  wikiItems?: WikiItem[];
  /** Notes that link to this one, for the side panel's Backlinks tab. Omitted = no such tab. */
  backlinks?: Backlink[];
  onOpenBacklink?: (backlink: Backlink) => void;
};

const DEFAULT_FONT_SIZE = 13;
const OUTLINE_KEY = "ygg.editor.outline";
/** A heading counts as "reached" once it scrolls this close to the top of the page. */
const HEADING_LEAD_PX = 72;

function readOutlineOpen(): boolean {
  try {
    return window.localStorage.getItem(OUTLINE_KEY) !== "0";
  } catch {
    return true;
  }
}

// Plain files just get the code editor. .md files additionally get a
// formatting toolbar that drives whichever editor is showing — the rich
// (WYSIWYG) one, where the rendered note itself is directly editable, or the
// raw-source one, where each button writes the markdown syntax — an outline of
// the document's headings, find (and replace), and a status bar with the word
// count and the Rica / Código switch. Both sides edit the same markdown
// string; switching is lossless.
export function TextEditor({ path, value, onChange, readOnly, status, reveal, wikiItems, backlinks, onOpenBacklink }: Props) {
  const isMarkdown = languageFromPath(path) === "markdown";
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const [rich, setRich] = useState<Editor | null>(null);
  const [previewing, setPreviewing] = useState(true);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [outlineOpen, setOutlineOpen] = useState(readOutlineOpen);
  const [find, setFind] = useState<{ query: string; nonce: number } | null>(null);
  const [richActive, setRichActive] = useState(-1);
  const [sourceLine, setSourceLine] = useState(1);
  const revealedRef = useRef(0);

  useEditorTick(rich);

  // The rich editor shows the note without its front matter (it would rewrite the YAML as prose);
  // that block is kept here and put back on every change.
  const split = useMemo(() => splitFrontmatter(value), [value]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onRichChange = useCallback(
    (body: string) => onChange(joinFrontmatter(splitFrontmatter(valueRef.current).raw, body)),
    [onChange],
  );

  // Every newly opened doc starts in the rich view, not raw source.
  useEffect(() => {
    setPreviewing(true);
    setFind(null);
  }, [path]);

  // The outline comes from the document the active editor shows: its headings in rich view (same
  // order as on screen), the `#` lines of the markdown in source view.
  const items: OutlineItem[] = useMemo(
    () => (previewing ? (rich ? outlineFromDoc(rich.state.doc) : []) : extractOutline(value)),
    // The rich document changes without `value` changing identity in the same render; the tick above re-renders us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewing, rich, value, rich?.state.doc],
  );

  // Rich view: the active heading follows the scroll.
  useEffect(() => {
    const container = previewRef.current;
    if (!previewing || !rich || !container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const heads = rich.view.dom.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6");
      const top = container.getBoundingClientRect().top + HEADING_LEAD_PX;
      let current = -1;
      heads.forEach((h, i) => {
        if (h.getBoundingClientRect().top <= top) current = i;
      });
      setRichActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [previewing, rich, items.length]);

  // Source view: the active heading follows the cursor and the scroll.
  useEffect(() => {
    if (previewing || !source) return;
    const topLine = () => source.getVisibleRanges()[0]?.startLineNumber ?? 1;
    const onCursor = source.onDidChangeCursorPosition((e) => setSourceLine(e.position.lineNumber));
    const onScroll = source.onDidScrollChange(() => setSourceLine(topLine() + 1));
    setSourceLine(source.getPosition()?.lineNumber ?? topLine());
    return () => {
      onCursor.dispose();
      onScroll.dispose();
    };
  }, [previewing, source]);

  const activeIndex = previewing ? richActive : activeOutlineIndex(items, sourceLine);

  const selectHeading = (item: OutlineItem, index: number) => {
    if (previewing && rich && item.pos !== undefined) {
      rich.chain().setTextSelection(item.pos + 1).run();
      const dom = rich.view.nodeDOM(item.pos);
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start", behavior: "smooth" });
      setRichActive(index);
    } else if (!previewing && source && item.line !== undefined) {
      source.revealLineNearTop(item.line);
      source.setPosition({ lineNumber: item.line, column: 1 });
      source.focus();
    }
  };

  const toggleOutline = () => {
    setOutlineOpen((open) => {
      try {
        window.localStorage.setItem(OUTLINE_KEY, open ? "0" : "1");
      } catch {
        // Not remembered; the toggle still works.
      }
      return !open;
    });
  };

  // Rich view: our find bar (with replace). Source view: Monaco's own find widget.
  const openFind = useCallback(
    (seed?: string) => {
      if (previewing && rich) {
        let query = seed ?? "";
        if (!seed) {
          const { from, to, empty } = rich.state.selection;
          const selected = empty ? "" : rich.state.doc.textBetween(from, to, " ");
          if (selected && selected.length <= 100 && !selected.includes("\n")) query = selected;
        }
        setFind({ query, nonce: Date.now() });
      } else if (source) {
        void source.getAction("actions.find")?.run();
      }
    },
    [previewing, rich, source],
  );

  // ⌘F / Ctrl+F while this editor is the one on screen.
  useEffect(() => {
    if (!isMarkdown) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "f") return;
      const root = rootRef.current;
      if (!root || !root.offsetParent) return;
      const target = e.target as Element | null;
      const outside = target && target !== document.body && !root.contains(target);
      if (outside) return;
      // Monaco handles ⌘F itself when it has focus.
      if (!previewing && target?.closest?.(".monaco-editor")) return;
      e.preventDefault();
      openFind();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMarkdown, previewing, openFind]);

  // A note opened from a search hit: find the text (rich view) or go to its line (source view).
  useEffect(() => {
    if (!reveal || reveal.nonce === revealedRef.current) return;
    if (previewing) {
      if (!rich) return;
      revealedRef.current = reveal.nonce;
      openFind(reveal.query);
    } else if (source) {
      revealedRef.current = reveal.nonce;
      if (reveal.line) {
        source.revealLineInCenter(reveal.line);
        source.setPosition({ lineNumber: reveal.line, column: 1 });
      }
    }
  }, [reveal, previewing, rich, source, openFind]);

  if (!isMarkdown) {
    return (
      <div className="text-editor" ref={rootRef}>
        <LspTrustBar language={languageFromPath(path)} />
        <div className="text-editor-body">
          <div className="text-editor-main">
            <CodeEditor path={path} value={value} onChange={onChange} readOnly={readOnly} onMount={setSource} />
          </div>
        </div>
        <CodeStatusBar editor={source} status={status} />
      </div>
    );
  }

  return (
    <div className="text-editor" ref={rootRef}>
      <MarkdownToolbar
        notePath={path}
        mode={previewing ? "rich" : "source"}
        rich={rich}
        source={source}
        readOnly={readOnly}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        onFind={() => openFind()}
        outlineOpen={outlineOpen}
        onToggleOutline={toggleOutline}
      />
      {previewing && rich && <ContextBar editor={rich} readOnly={readOnly} />}
      <div className="text-editor-body">
        <div className="text-editor-main">
          {find && previewing && rich && (
            <FindBar key={find.nonce} editor={rich} initialQuery={find.query} readOnly={readOnly} onClose={() => setFind(null)} />
          )}
          {previewing ? (
            <div className="markdown-preview" style={{ fontSize }} ref={previewRef}>
              <MarkdownRichEditor path={path} value={split.body} onChange={onRichChange} readOnly={readOnly} onEditor={setRich} wikiItems={wikiItems} />
            </div>
          ) : (
            <CodeEditor
              path={path}
              value={value}
              onChange={onChange}
              readOnly={readOnly}
              fontSize={fontSize}
              onMount={setSource}
            />
          )}
        </div>
        {outlineOpen && (
          <SidePanel
            items={items}
            activeIndex={activeIndex}
            onSelect={selectHeading}
            backlinks={backlinks}
            onOpenBacklink={onOpenBacklink}
            markdown={value}
            onMarkdownChange={onChange}
            readOnly={readOnly}
            onClose={toggleOutline}
          />
        )}
      </div>
      <TextStatusBar value={value} previewing={previewing} onModeChange={setPreviewing} status={status} />
    </div>
  );
}
