/**
 * Groups changed files by folder for the "tree" view of a change list
 * (Repositorio → Changes, and the sidebar's Remote Diff). Folders first, then
 * files, each alphabetical; a chain of folders that each hold only one folder
 * is shown as a single node ("apps/nextjs/src"), like VS Code does.
 */

export type ChangeViewMode = "list" | "tree";

export type ChangeTreeFile<T> = { type: "file"; name: string; path: string; item: T };
export type ChangeTreeDir<T> = {
  type: "dir";
  /** Display name — several segments joined by "/" when compacted. */
  name: string;
  /** Full folder path, unique per node: the collapse-state key. */
  path: string;
  /** Files anywhere below this folder. */
  count: number;
  children: ChangeTreeNode<T>[];
};
export type ChangeTreeNode<T> = ChangeTreeFile<T> | ChangeTreeDir<T>;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** List view: ordered by full path, so files of the same folder sit together. */
export function sortByPath<T>(items: readonly T[], getPath: (item: T) => string): T[] {
  return [...items].sort((a, b) => collator.compare(getPath(a), getPath(b)));
}

type Building<T> = { dirs: Map<string, Building<T>>; files: ChangeTreeFile<T>[] };

export function buildChangeTree<T>(items: readonly T[], getPath: (item: T) => string): ChangeTreeNode<T>[] {
  const root: Building<T> = { dirs: new Map(), files: [] };
  for (const item of items) {
    const path = getPath(item);
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop() ?? path;
    let node = root;
    for (const part of parts) {
      let next = node.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        node.dirs.set(part, next);
      }
      node = next;
    }
    node.files.push({ type: "file", name, path, item });
  }
  return finish(root, "");
}

function finish<T>(node: Building<T>, prefix: string): ChangeTreeNode<T>[] {
  const dirs: ChangeTreeDir<T>[] = [];
  for (const [segment, child] of node.dirs) {
    let name = segment;
    let path = prefix ? `${prefix}/${segment}` : segment;
    let current = child;
    // Compact "a" → "b" → "c" when each level holds only one folder and no files.
    while (current.files.length === 0 && current.dirs.size === 1) {
      const [nextSegment, next] = current.dirs.entries().next().value as [string, Building<T>];
      name = `${name}/${nextSegment}`;
      path = `${path}/${nextSegment}`;
      current = next;
    }
    const children = finish(current, path);
    dirs.push({ type: "dir", name, path, children, count: countFiles(children) });
  }
  dirs.sort((a, b) => collator.compare(a.name, b.name));
  const files = [...node.files].sort((a, b) => collator.compare(a.name, b.name));
  return [...dirs, ...files];
}

function countFiles<T>(nodes: ChangeTreeNode<T>[]): number {
  return nodes.reduce((sum, n) => sum + (n.type === "file" ? 1 : n.count), 0);
}
