/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// DOM-typed like browserTabPickerPreload.ts (the only preload code that runs
// inside a loaded page) — see the note at the top of that file.

function shortSelectorFor(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < 5; depth++) {
    let part = node.tagName.toLowerCase();
    if (node.classList.length > 0) {
      part += [...node.classList]
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join("");
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTagSiblings = [...parent.children].filter((c) => c.tagName === node!.tagName);
      if (sameTagSiblings.length > 1) part += `:nth-of-type(${sameTagSiblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    if (node.id) {
      parts[0] = `#${CSS.escape(node.id)}`;
      break;
    }
    node = parent;
  }
  return parts.join(" > ");
}

// Absolute path from <html>: ugly but guaranteed to match exactly one element.
function absoluteSelectorFor(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const parent: Element | null = node.parentElement;
    const index = parent ? [...parent.children].indexOf(node) + 1 : 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    node = parent;
  }
  return `html > ${parts.join(" > ")}`;
}

function isUnique(selector: string, el: Element): boolean {
  try {
    const found = document.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** Readable selector when it happens to be unique, otherwise an exact nth-child path — comments are re-located by this later, so it must not be ambiguous. */
export function cssSelectorFor(el: Element): string {
  const short = shortSelectorFor(el);
  return isUnique(short, el) ? short : absoluteSelectorFor(el);
}

export function findBySelector(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}
