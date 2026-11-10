import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronRightIcon, FolderIcon, ListBulletIcon } from "@heroicons/react/20/solid";
import { buildChangeTree, sortByPath, type ChangeTreeNode, type ChangeViewMode } from "./changeTree.js";
import { useI18n } from "../i18n/index.js";

/** Left padding per tree level, in px. */
export const TREE_INDENT = 14;

export type ChangeRowContext = {
  /** Nesting level: 0 in list mode and for files at the repo root. */
  depth: number;
  /** In a tree the folder is already shown above the row, so the row shows only the file name. */
  tree: boolean;
};

type Props<T> = {
  items: readonly T[];
  getPath: (item: T) => string;
  mode: ChangeViewMode;
  /** Must return an `<li>` (the list is flat, so it stays a valid `<ul>`), keyed by the caller. */
  renderRow: (item: T, ctx: ChangeRowContext) => ReactNode;
};

/**
 * The rows of a change list, flat ("list", ordered by path) or grouped by
 * folder ("tree", collapsible). Callers keep drawing their own file rows, so
 * each list keeps its own actions (stage, discard...).
 */
export function ChangeList<T>({ items, getPath, mode, renderRow }: Props<T>) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const sorted = useMemo(() => (mode === "list" ? sortByPath(items, getPath) : []), [items, getPath, mode]);
  const tree = useMemo(() => (mode === "tree" ? buildChangeTree(items, getPath) : []), [items, getPath, mode]);

  if (mode === "list") return <>{sorted.map((item) => renderRow(item, { depth: 0, tree: false }))}</>;

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNodes = (nodes: ChangeTreeNode<T>[], depth: number): ReactNode =>
    nodes.map((node) => {
      if (node.type === "file") return renderRow(node.item, { depth, tree: true });
      const open = !collapsed.has(node.path);
      return (
        <Fragment key={`dir:${node.path}`}>
          <li className="change-dir">
            <button
              type="button"
              className="change-dir-main"
              style={{ paddingLeft: depth * TREE_INDENT + 6 }}
              aria-expanded={open}
              title={node.path}
              onClick={() => toggle(node.path)}
            >
              <ChevronRightIcon className={`hero-icon change-dir-chevron${open ? " open" : ""}`} />
              <span className="change-dir-name">{node.name}</span>
              <span className="change-dir-count">{node.count}</span>
            </button>
          </li>
          {open && renderNodes(node.children, depth + 1)}
        </Fragment>
      );
    });

  return <>{renderNodes(tree, 0)}</>;
}

/** The list / tree switch, two icon buttons in the existing segmented style. */
export function ChangeViewToggle({ mode, onChange }: { mode: ChangeViewMode; onChange: (mode: ChangeViewMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="repo-segmented change-view-toggle" role="group" aria-label={t("repo.changes.viewMode")}>
      <button
        type="button"
        className={mode === "list" ? "on" : ""}
        aria-pressed={mode === "list"}
        title={t("repo.changes.viewList")}
        aria-label={t("repo.changes.viewList")}
        onClick={() => onChange("list")}
      >
        <ListBulletIcon className="hero-icon" />
      </button>
      <button
        type="button"
        className={mode === "tree" ? "on" : ""}
        aria-pressed={mode === "tree"}
        title={t("repo.changes.viewTree")}
        aria-label={t("repo.changes.viewTree")}
        onClick={() => onChange("tree")}
      >
        <FolderIcon className="hero-icon" />
      </button>
    </div>
  );
}
