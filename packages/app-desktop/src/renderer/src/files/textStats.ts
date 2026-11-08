const WORDS_PER_MINUTE = 220;

/**
 * Words in a markdown document, ignoring its syntax: front matter, code fence
 * markers, heading/list/quote prefixes, emphasis marks, and the URL part of links
 * and images (their visible text still counts).
 */
export function countWords(markdown: string): number {
  const text = markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/^\s*(```|~~~).*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, " ")
    .replace(/[*_~`|]+/g, " ");
  return (text.match(/[^\s]+/g) ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Reading time in whole minutes: nothing for an empty note, at least one minute otherwise. */
export function readingMinutes(words: number): number {
  return words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
