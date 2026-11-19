import { useEffect, useRef, useState } from "react";
import { blocksToMarkdown, deckToMarkdown, LAYOUTS, parseBlocks, parseInline, runsToMarkdown, THEMES, type DeckModel, type DeckTheme, type SlideBlock, type SlideLayout } from "@yggdrasil/tool-office/browser";
import { useI18n } from "../i18n/index.js";
import { addSlideAfter, applyDeckWrite, describeSlides, duplicateSlide, moveSlide, removeSlide, updateSlide } from "./deckOps.js";
import { failDeckOpen, registerDeckController, type DeckController } from "./deckRegistry.js";
import { lossyNames } from "./lossyNames.js";
import { SlideView } from "./SlideView.js";
import { openWorkspaceTab } from "./workspaceStore.js";

type Props = { path: string; active: boolean };
type SaveState = "saved" | "unsaved" | "saving" | "error";

const SAVE_DEBOUNCE_MS = 800;

const LABELS = {
  en: { layout: "Layout", theme: "Theme", title: "Title", subtitle: "Subtitle", body: "Content (Markdown)", body2: "Right column (Markdown)", notes: "Speaker notes", add: "Add slide", duplicate: "Duplicate", remove: "Delete", up: "Move up", down: "Move down", slides: "Slides", saved: "Saved", images: "pictures kept", layouts: { title: "Title", content: "Content", section: "Section", "two-column": "Two columns", blank: "Blank" }, themes: { light: "Light", dark: "Dark", accent: "Accent" } },
  es: { layout: "Diseño", theme: "Tema", title: "Título", subtitle: "Subtítulo", body: "Contenido (Markdown)", body2: "Columna derecha (Markdown)", notes: "Notas del orador", add: "Agregar diapositiva", duplicate: "Duplicar", remove: "Eliminar", up: "Subir", down: "Bajar", slides: "Diapositivas", saved: "Guardado", images: "imágenes conservadas", layouts: { title: "Título", content: "Contenido", section: "Sección", "two-column": "Dos columnas", blank: "En blanco" }, themes: { light: "Claro", dark: "Oscuro", accent: "Acento" } },
} as const;

const isImage = (b: SlideBlock) => b.type === "image";
/** A text field edits everything but pictures; the pictures ride along unchanged. */
const withImages = (edited: SlideBlock[], previous: SlideBlock[]): SlideBlock[] => [...edited, ...previous.filter(isImage)];

type Loaded = { deck: DeckModel; lossy: string[] };

/** One PowerPoint presentation in the workspace: edit it by hand, and an agent can read/write the same open deck through its controller. */
export default function DeckEditor({ path, active }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    window.yggdrasil.office.deckLoad(path).then(
      (res) => !cancelled && setLoaded({ deck: res.deck as DeckModel, lossy: res.lossy }),
      (err) => {
        if (cancelled) return;
        const failure = err instanceof Error ? err : new Error(String(err));
        failDeckOpen(path, failure);
        setError(failure.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) return <p className="error sheet-error">{error}</p>;
  if (!loaded) return <p className="muted sheet-loading">…</p>;
  return <DeckSurface path={path} active={active} initial={loaded.deck} lossy={loaded.lossy} />;
}

function DeckSurface({ path, active, initial, lossy }: { path: string; active: boolean; initial: DeckModel; lossy: string[] }) {
  const { t, language } = useI18n();
  const L = LABELS[language];
  const [deck, setDeckState] = useState<DeckModel>(initial);
  const [selected, setSelected] = useState(0);
  /** Bumped when the deck changes from outside the text fields (an agent, a structural edit): their drafts reset. */
  const [rev, setRev] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copy, setCopy] = useState<{ path: string } | { error: string } | null>(null);
  const deckRef = useRef(initial);
  const savedRef = useRef(JSON.stringify(initial));
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Writes the deck now; resolves to whether what is on screen is on disk. */
  const save = async (): Promise<boolean> => {
    if (lossy.length > 0) return false;
    clearTimeout(timerRef.current);
    const signature = JSON.stringify(deckRef.current);
    if (signature === savedRef.current) {
      dirtyRef.current = false;
      setSaveState("saved");
      return true;
    }
    setSaveState("saving");
    try {
      await window.yggdrasil.office.deckSave(path, deckRef.current);
      savedRef.current = signature;
      dirtyRef.current = false;
      setSaveError(null);
      setSaveState("saved");
      return true;
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const commit = (next: DeckModel, external = false) => {
    deckRef.current = next;
    setDeckState(next);
    if (external) setRev((r) => r + 1);
    if (lossy.length > 0) return;
    dirtyRef.current = true;
    setSaveState("unsaved");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };

  useEffect(() => {
    const controller: DeckController = {
      info: () => ({ slides: deckRef.current.slides.length }),
      read: () => ({ slides: describeSlides(deckRef.current), markdown: deckToMarkdown(deckRef.current) }),
      async write(op) {
        commit(applyDeckWrite(deckRef.current, op), true);
        setSelected((s) => Math.min(s, deckRef.current.slides.length - 1));
        const slides = deckRef.current.slides.length;
        if (lossy.length > 0) {
          return { slides, saved: false, note: `Not saved to the file: it has ${lossy.join(", ")}, which the editor can't keep yet. The change is on screen only; the user can save a copy.` };
        }
        // Report what really happened, not what was hoped for: a failed write is on screen only.
        return (await save()) ? { slides, saved: true } : { slides, saved: false, note: "The change is on screen but saving the file failed; the user sees the error in the editor." };
      },
    };
    const unregister = registerDeckController(path, controller);
    return () => {
      unregister();
      clearTimeout(timerRef.current);
      // Closing the tab right after an edit must not lose it.
      if (dirtyRef.current) void save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const index = Math.min(selected, deck.slides.length - 1);
  const slide = deck.slides[index]!;
  const patch = (p: Parameters<typeof updateSlide>[2]) => commit(updateSlide(deckRef.current, index, p));
  const structural = (next: DeckModel, focus: number) => {
    commit(next, true);
    setSelected(Math.max(0, Math.min(focus, next.slides.length - 1)));
  };

  const saveCopy = async () => {
    try {
      setCopy({ path: await window.yggdrasil.office.deckSaveCopy(path, deckRef.current) });
    } catch (err) {
      setCopy({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  const key = `${index}-${rev}`;
  const mdOf = (blocks: SlideBlock[]) => blocksToMarkdown(blocks.filter((b) => !isImage(b)));
  const imageCount = (b: SlideBlock[]) => b.filter(isImage).length;

  return (
    <div className="deck-editor" data-active={active ? "1" : "0"}>
      {lossy.length > 0 && (
        <div className="sheet-lossy" role="alert">
          <span>{t("workspace.lossyBanner", { features: lossyNames(lossy, language) })}</span>
          <button type="button" onClick={() => void saveCopy()}>
            {t("workspace.saveCopy")}
          </button>
          {copy && "path" in copy && (
            <>
              <span className="muted">{t("workspace.copySaved", { path: copy.path })}</span>
              <button type="button" onClick={() => openWorkspaceTab("deck", copy.path)}>
                {t("workspace.openCopy")}
              </button>
            </>
          )}
          {copy && "error" in copy && <span className="error">{copy.error}</span>}
        </div>
      )}
      <div className="deck-main">
        <div className="deck-rail" aria-label={L.slides}>
          {deck.slides.map((s, i) => (
            <button key={i} type="button" className={`deck-thumb${i === index ? " active" : ""}`} onClick={() => setSelected(i)} aria-label={`${L.slides} ${i + 1}`}>
              <span className="deck-thumb-n">{i + 1}</span>
              <span className="deck-thumb-frame">
                <SlideView slide={s} theme={deck.theme} />
              </span>
            </button>
          ))}
          <button type="button" className="deck-add" onClick={() => structural(addSlideAfter(deckRef.current, deck.slides.length - 1), deck.slides.length)}>
            + {L.add}
          </button>
        </div>
        <div className="deck-stage">
          <div className="deck-canvas">
            <SlideView slide={slide} theme={deck.theme} />
          </div>
          <div className="deck-form">
            <div className="deck-row">
              <label>
                {L.layout}
                <select value={slide.layout} onChange={(e) => patch({ layout: e.target.value as SlideLayout, ...(e.target.value === "two-column" && !slide.body2 ? { body2: [] } : {}) })}>
                  {LAYOUTS.map((l) => (
                    <option key={l} value={l}>
                      {L.layouts[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {L.theme}
                <select value={deck.theme} onChange={(e) => commit({ ...deckRef.current, theme: e.target.value as DeckTheme })}>
                  {THEMES.map((th) => (
                    <option key={th} value={th}>
                      {L.themes[th]}
                    </option>
                  ))}
                </select>
              </label>
              <span className="deck-actions">
                <button type="button" title={L.up} aria-label={L.up} disabled={index === 0} onClick={() => structural(moveSlide(deckRef.current, index, index - 1), index - 1)}>↑</button>
                <button type="button" title={L.down} aria-label={L.down} disabled={index === deck.slides.length - 1} onClick={() => structural(moveSlide(deckRef.current, index, index + 1), index + 1)}>↓</button>
                <button type="button" onClick={() => structural(duplicateSlide(deckRef.current, index), index + 1)}>{L.duplicate}</button>
                <button type="button" onClick={() => structural(removeSlide(deckRef.current, index), index)}>{L.remove}</button>
              </span>
            </div>
            <label>
              {L.title}
              <input key={`t-${key}`} defaultValue={runsToMarkdown(slide.title)} onChange={(e) => patch({ title: parseInline(e.target.value) })} />
            </label>
            {(slide.layout === "title" || slide.layout === "section") && (
              <label>
                {L.subtitle}
                <input key={`s-${key}`} defaultValue={runsToMarkdown(slide.subtitle ?? [])} onChange={(e) => patch({ subtitle: parseInline(e.target.value) })} />
              </label>
            )}
            <label>
              {L.body} {imageCount(slide.body) > 0 && <span className="muted">· {imageCount(slide.body)} {L.images}</span>}
              <textarea key={`b-${key}`} rows={6} defaultValue={mdOf(slide.body)} onChange={(e) => patch({ body: withImages(parseBlocks(e.target.value) as SlideBlock[], deckRef.current.slides[index]!.body) })} />
            </label>
            {slide.layout === "two-column" && (
              <label>
                {L.body2} {imageCount(slide.body2 ?? []) > 0 && <span className="muted">· {imageCount(slide.body2 ?? [])} {L.images}</span>}
                <textarea key={`c-${key}`} rows={6} defaultValue={mdOf(slide.body2 ?? [])} onChange={(e) => patch({ body2: withImages(parseBlocks(e.target.value) as SlideBlock[], deckRef.current.slides[index]!.body2 ?? []) })} />
              </label>
            )}
            <label>
              {L.notes}
              <textarea key={`n-${key}`} rows={3} defaultValue={slide.notes ?? ""} onChange={(e) => patch({ notes: e.target.value || undefined })} />
            </label>
          </div>
        </div>
      </div>
      {saveState === "error" && saveError && <span className="error sheet-save-message" role="alert">{saveError}</span>}
      <span className={`sheet-save sheet-save-${lossy.length > 0 ? "error" : saveState}`} title={saveState === "saved" ? L.saved : (saveError ?? undefined)}>
        {lossy.length > 0 ? "⚠" : saveState === "saved" ? "✓" : saveState === "saving" ? "…" : saveState === "unsaved" ? "●" : "!"}
      </span>
    </div>
  );
}

