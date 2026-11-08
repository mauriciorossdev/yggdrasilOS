import type { Editor } from "@tiptap/react";
import { altFromFileName, imageFileName, isImageFile } from "./imageNames.js";

/** What to insert for a stored image. */
type ImageNode = { type: "image"; attrs: { src: string; alt: string } };

/** Stores the image in `assets/` next to the note; returns the address to link (relative to the note) and a readable alt text. */
export async function storeImageFile(notePath: string, file: File): Promise<{ src: string; alt: string }> {
  const name = imageFileName(file, new Date());
  const { src } = await window.yggdrasil.files.saveAsset(notePath, name, await file.arrayBuffer());
  return { src, alt: altFromFileName(name) };
}

async function storeImage(notePath: string, file: File): Promise<ImageNode> {
  const { src, alt } = await storeImageFile(notePath, file);
  return imageNodeFor(src, alt);
}

/** The images among a set of files (paste, drop or file picker), in order. */
export function imagesIn(files: Iterable<File>): File[] {
  return [...files].filter(isImageFile);
}

/**
 * Stores each image in `assets/` next to the note and inserts it at `position` (default: the cursor). Images
 * that can't be stored (too big, not an image type) are reported together at the end rather than stopping the
 * rest. Returns how many were inserted.
 */
export async function insertImageFiles(editor: Editor, notePath: string, files: File[], position?: number): Promise<number> {
  const nodes: Array<ImageNode | { type: "text"; text: string }> = [];
  const failures: string[] = [];
  for (const file of imagesIn(files)) {
    try {
      if (nodes.length > 0) nodes.push({ type: "text", text: " " });
      nodes.push(await storeImage(notePath, file));
    } catch (err) {
      nodes.pop();
      failures.push(`${file.name || "imagen"}: ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err)}`);
    }
  }
  if (nodes.length > 0) {
    const chain = editor.chain().focus();
    if (position === undefined) chain.insertContent(nodes).run();
    else chain.insertContentAt(position, nodes).run();
  }
  if (failures.length > 0) window.alert(`No se pudo guardar:\n${failures.join("\n")}`);
  return nodes.filter((n) => n.type === "image").length;
}

/** An image already in the project (dragged from the file tree): linked in place, not copied. */
export function imageNodeFor(src: string, alt: string): ImageNode {
  return { type: "image", attrs: { src, alt } };
}
