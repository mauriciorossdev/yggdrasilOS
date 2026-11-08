import { Node, mergeAttributes } from "@tiptap/core";

export type ImageAttrs = { src: string; alt?: string | null; title?: string | null };

/**
 * What the editor draws for an image. `src` is the address as written in the markdown (so saving gives the same
 * text back); the browser loads `displaySrc`, and `data-src` carries the original so a copy-paste inside the
 * editor doesn't turn the address into the loadable one.
 */
export function imageRenderSpec(attrs: ImageAttrs, displaySrc: string): ["img", Record<string, string>] {
  const out: Record<string, string> = { src: displaySrc, "data-src": attrs.src };
  if (attrs.alt) out.alt = attrs.alt;
  if (attrs.title) out.title = attrs.title;
  return ["img", out];
}

/** The attributes of an `<img>` read back into a node: the markdown address wins over the loadable one. */
export function imageAttrsFromElement(get: (name: string) => string | null): ImageAttrs | false {
  const src = get("data-src") ?? get("src");
  if (!src) return false;
  return { src, alt: get("alt"), title: get("title") };
}

/**
 * Inline image node, named `image` so tiptap-markdown writes it back as `![alt](src "title")`. Without it
 * the editor has no place for an image and drops it, and the next save deletes it from the file.
 * `resolveSrc` maps a markdown address to something the page can load (it reads the open note's path).
 */
export function createImageNode(resolveSrc: (src: string) => string) {
  return Node.create({
    name: "image",
    inline: true,
    group: "inline",
    draggable: true,
    selectable: true,

    addAttributes() {
      return { src: { default: "" }, alt: { default: null }, title: { default: null } };
    },

    parseHTML() {
      return [
        {
          tag: "img[src]",
          getAttrs: (el) => imageAttrsFromElement((name) => (el as HTMLElement).getAttribute(name)),
        },
      ];
    },

    renderHTML({ node, HTMLAttributes }) {
      const [tag, attrs] = imageRenderSpec(node.attrs as ImageAttrs, resolveSrc(String(node.attrs.src)));
      return [tag, mergeAttributes(HTMLAttributes, attrs, { class: "markdown-image" })];
    },
  });
}
