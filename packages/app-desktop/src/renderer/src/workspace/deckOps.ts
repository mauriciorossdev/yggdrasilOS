import { parseDeckMarkdown, type DeckModel, type Slide, type SlideLayout } from "@yggdrasil/tool-office/browser";
import type { DeckSlideInfo, DeckWriteMode } from "./deckRegistry.js";

/** Rules for what an agent may ask of an open presentation, and the slide operations of the editor — pure, so they can be tested. */

export const MAX_DECK_MARKDOWN_CHARS = 200_000;
export const MAX_SLIDES = 300;

const plain = (runs: Array<{ text: string }>) => runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();

export function describeSlides(deck: DeckModel): DeckSlideInfo[] {
  return deck.slides.map((s, index) => ({ index, layout: s.layout, title: plain(s.title) || plain(s.subtitle ?? []) || "(no title)" }));
}

export function applyDeckWrite(deck: DeckModel, op: { mode: DeckWriteMode; markdown?: string; index?: number }): DeckModel {
  const n = deck.slides.length;
  const needsMarkdown = op.mode !== "delete_slide";
  if (needsMarkdown && typeof op.markdown !== "string") throw new Error(`markdown is required for mode "${op.mode}"`);
  if ((op.markdown?.length ?? 0) > MAX_DECK_MARKDOWN_CHARS) throw new Error(`markdown is too long (max ${MAX_DECK_MARKDOWN_CHARS} characters per call)`);

  const at = (): number => {
    const i = op.index;
    if (typeof i !== "number" || !Number.isInteger(i)) throw new Error(`index is required for mode "${op.mode}"`);
    if (i < 0 || i >= n) throw new Error(`index ${i} is out of range: the deck has ${n} slide(s), numbered from 0`);
    return i;
  };

  let next: DeckModel;
  switch (op.mode) {
    case "replace": {
      const parsed = parseDeckMarkdown(op.markdown!);
      next = parsed.slides.length > 0 ? parsed : { theme: parsed.theme, slides: [blankSlide()] };
      break;
    }
    case "append":
      next = { ...deck, slides: [...deck.slides, ...parseDeckMarkdown(op.markdown!, n).slides] };
      break;
    case "insert_after": {
      const i = at();
      next = { ...deck, slides: [...deck.slides.slice(0, i + 1), ...parseDeckMarkdown(op.markdown!, i + 1).slides, ...deck.slides.slice(i + 1)] };
      break;
    }
    case "replace_slide": {
      const i = at();
      next = { ...deck, slides: [...deck.slides.slice(0, i), ...parseDeckMarkdown(op.markdown!, i).slides, ...deck.slides.slice(i + 1)] };
      break;
    }
    case "delete_slide": {
      const i = at();
      next = { ...deck, slides: deck.slides.filter((_, k) => k !== i) };
      if (next.slides.length === 0) next.slides = [blankSlide()];
      break;
    }
    default:
      throw new Error(`unknown mode "${String(op.mode)}"`);
  }
  if (next.slides.length > MAX_SLIDES) throw new Error(`a deck can have at most ${MAX_SLIDES} slides`);
  return next;
}

export function blankSlide(layout: SlideLayout = "content"): Slide {
  return { layout, title: [], body: [] };
}

export function addSlideAfter(deck: DeckModel, index: number, layout: SlideLayout = "content"): DeckModel {
  const slides = [...deck.slides];
  slides.splice(index + 1, 0, blankSlide(layout));
  return { ...deck, slides };
}

export function duplicateSlide(deck: DeckModel, index: number): DeckModel {
  const slides = [...deck.slides];
  slides.splice(index + 1, 0, structuredClone(deck.slides[index]!));
  return { ...deck, slides };
}

export function removeSlide(deck: DeckModel, index: number): DeckModel {
  const slides = deck.slides.filter((_, i) => i !== index);
  return { ...deck, slides: slides.length > 0 ? slides : [blankSlide()] };
}

export function moveSlide(deck: DeckModel, from: number, to: number): DeckModel {
  if (to < 0 || to >= deck.slides.length || from === to) return deck;
  const slides = [...deck.slides];
  const [moved] = slides.splice(from, 1);
  slides.splice(to, 0, moved!);
  return { ...deck, slides };
}

export function updateSlide(deck: DeckModel, index: number, patch: Partial<Slide>): DeckModel {
  return { ...deck, slides: deck.slides.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
}
