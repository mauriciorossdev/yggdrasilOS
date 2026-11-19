import type { Block, Run } from "../docx/model.js";

/**
 * A deck as a person would describe it: slides with a layout, a title, content and notes. Structured on
 * purpose (no free-form shapes): it is what the in-app editor edits and what an agent can reason about.
 * Plain JSON, no Node or browser dependencies. Not modelled: free positioning, shapes, charts, animations,
 * transitions, speaker timing, custom masters and themes — a deck from another app has those (see inspect.ts).
 */

export type SlideLayout = "title" | "content" | "section" | "two-column" | "blank";
export type DeckTheme = "light" | "dark" | "accent";

export const LAYOUTS: SlideLayout[] = ["title", "content", "section", "two-column", "blank"];
export const THEMES: DeckTheme[] = ["light", "dark", "accent"];

/** The blocks a slide's content can hold: paragraphs, lists, tables, pictures and code. */
export type SlideBlock = Extract<Block, { type: "paragraph" | "heading" | "list" | "table" | "image" | "code" }>;

export type Slide = {
  layout: SlideLayout;
  title: Run[];
  /** Under the title on "title" and "section" slides. */
  subtitle?: Run[];
  body: SlideBlock[];
  /** The right column of a "two-column" slide. */
  body2?: SlideBlock[];
  notes?: string;
};

export type DeckModel = { theme: DeckTheme; slides: Slide[] };

export const EMPTY_SLIDE: Slide = { layout: "content", title: [], body: [] };

export function emptyDeck(theme: DeckTheme = "light"): DeckModel {
  return { theme, slides: [{ layout: "title", title: [{ text: "Untitled" }], body: [] }] };
}
