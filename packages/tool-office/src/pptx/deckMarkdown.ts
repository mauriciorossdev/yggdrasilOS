import { blocksToMarkdown, parseBlocks, parseInline, runsToMarkdown } from "../markdown.js";
import { LAYOUTS, THEMES, type DeckModel, type DeckTheme, type Slide, type SlideBlock, type SlideLayout } from "./model.js";

/**
 * The Markdown dialect for a whole deck — what agents read and write:
 *
 *   <!-- theme: dark -->            (optional, once, at the top)
 *   # Deck title                     the first heading of a slide is its title
 *   A subtitle                       (title and section slides)
 *   ---                              a line with only --- starts the next slide
 *   <!-- layout: two-column -->     title | content (default) | section | two-column | blank
 *   ## Slide title
 *   - left content
 *   <!-- col -->                    the right column of a two-column slide
 *   - right content
 *   <!-- notes: speaker notes -->   may span several lines
 */

const COMMENT = /<!--\s*([\s\S]*?)\s*-->/g;
const FENCE = /^\s*```/;

/** Splits on lines that are only `---`, ignoring any inside a fenced code block. */
function splitSlides(markdown: string): string[] {
  const chunks: string[][] = [[]];
  let inFence = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && /^\s*---\s*$/.test(line)) chunks.push([]);
    else chunks[chunks.length - 1]!.push(line);
  }
  return chunks.map((c) => c.join("\n"));
}

const asBlocks = (md: string): SlideBlock[] => parseBlocks(md) as SlideBlock[];

function parseSlide(chunk: string, index: number): { slide: Slide; theme?: DeckTheme } {
  let layout: SlideLayout | undefined;
  let theme: DeckTheme | undefined;
  let notes: string | undefined;
  let hasColumnBreak = false;
  const content = chunk.replace(COMMENT, (_all, inner: string) => {
    const note = /^notes:\s*([\s\S]*)$/.exec(inner);
    const key = /^(layout|theme):\s*(\S+)\s*$/.exec(inner);
    if (note) notes = note[1]!.trim();
    else if (key?.[1] === "layout" && LAYOUTS.includes(key[2] as SlideLayout)) layout = key[2] as SlideLayout;
    else if (key?.[1] === "theme" && THEMES.includes(key[2] as DeckTheme)) theme = key[2] as DeckTheme;
    else if (/^col$/i.test(inner.trim())) {
      hasColumnBreak = true;
      return "\n<<<COL>>>\n";
    }
    return "";
  });

  const [left, ...rest] = content.split("\n<<<COL>>>\n");
  const blocks = asBlocks(left ?? "");
  const headingAt = blocks.findIndex((b) => b.type === "heading");
  const heading = headingAt >= 0 ? (blocks[headingAt] as Extract<SlideBlock, { type: "heading" }>) : undefined;
  const body = heading ? blocks.filter((_, i) => i !== headingAt) : blocks;
  const title = heading?.runs ?? [];

  const inferred: SlideLayout = hasColumnBreak ? "two-column" : index === 0 && body.every((b) => b.type === "paragraph") && body.length <= 1 ? "title" : body.length === 0 && !!heading ? "section" : "content";
  const finalLayout = layout ?? inferred;

  const slide: Slide = { layout: finalLayout, title, body };
  if ((finalLayout === "title" || finalLayout === "section") && body[0]?.type === "paragraph") {
    slide.subtitle = body[0].runs;
    slide.body = body.slice(1);
  }
  if (finalLayout === "two-column") slide.body2 = asBlocks(rest.join("\n"));
  if (notes) slide.notes = notes;
  return { slide, theme };
}

/** `firstIndex` is where the first slide will sit in its deck: only slide 0 is inferred to be a title slide. */
export function parseDeckMarkdown(markdown: string, firstIndex = 0): DeckModel {
  const slides: Slide[] = [];
  let theme: DeckTheme = "light";
  splitSlides(markdown).forEach((chunk, i) => {
    // A chunk with nothing in it (e.g. a leading `---`) is not a slide.
    if (!chunk.replace(COMMENT, "").trim() && !/<!--\s*(layout|notes)/.test(chunk)) {
      const t = /<!--\s*theme:\s*(\S+)\s*-->/.exec(chunk)?.[1];
      if (t && THEMES.includes(t as DeckTheme)) theme = t as DeckTheme;
      return;
    }
    const parsed = parseSlide(chunk, firstIndex + slides.length);
    if (parsed.theme && slides.length === 0 && firstIndex === 0) theme = parsed.theme;
    slides.push(parsed.slide);
    void i;
  });
  return { theme, slides };
}

export function slideToMarkdown(slide: Slide, index = 0): string {
  const parts: string[] = [];
  // What parseSlide would infer from the text written below; anything else is written out explicitly.
  // The subtitle is written as a paragraph ahead of the body, so it counts as part of the parsed body.
  const parsedBody: SlideBlock[] = [...(slide.subtitle && slide.subtitle.length > 0 ? [{ type: "paragraph" as const, runs: slide.subtitle }] : []), ...slide.body];
  const hasHeading = slide.title.length > 0;
  const inferred = (): SlideLayout =>
    slide.layout === "two-column"
      ? "two-column"
      : index === 0 && parsedBody.every((b) => b.type === "paragraph") && parsedBody.length <= 1
        ? "title"
        : parsedBody.length === 0 && hasHeading
          ? "section"
          : "content";
  if (slide.layout !== inferred()) parts.push(`<!-- layout: ${slide.layout} -->`);
  const hashes = slide.layout === "title" || slide.layout === "section" ? "#" : "##";
  if (slide.title.length > 0) parts.push(`${hashes} ${runsToMarkdown(slide.title)}`);
  if (slide.subtitle && slide.subtitle.length > 0) parts.push(runsToMarkdown(slide.subtitle));
  if (slide.body.length > 0) parts.push(blocksToMarkdown(slide.body));
  if (slide.layout === "two-column") parts.push("<!-- col -->", slide.body2 && slide.body2.length > 0 ? blocksToMarkdown(slide.body2) : "");
  if (slide.notes) parts.push(`<!-- notes: ${slide.notes} -->`);
  return parts.filter((p) => p !== "").join("\n\n");
}

export function deckToMarkdown(deck: DeckModel): string {
  const head = deck.theme !== "light" ? `<!-- theme: ${deck.theme} -->\n\n` : "";
  return head + deck.slides.map((s, i) => slideToMarkdown(s, i)).join("\n\n---\n\n");
}

export { parseInline };
