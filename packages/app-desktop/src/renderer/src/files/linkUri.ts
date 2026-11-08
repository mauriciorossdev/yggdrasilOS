const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Which addresses the rich editor's links may have. TipTap's own check refuses a relative path that starts with a
 * folder name (`Arquitectura/contrato.md`) and draws the link with an empty `href`, which breaks both the click
 * and the note-link styling, so a path with no scheme is accepted here; anything with a scheme (`https:`,
 * `mailto:`, `javascript:`) still goes through TipTap's own list.
 */
export function isAllowedLinkUri(url: string, defaultValidate: (url: string) => boolean): boolean {
  const trimmed = url.trim();
  if (!HAS_SCHEME.test(trimmed)) return true;
  return defaultValidate(trimmed);
}
