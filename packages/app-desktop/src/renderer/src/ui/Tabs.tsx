export type TabItem = { id: string; label: string; closable?: boolean };

type Props = {
  tabs: TabItem[];
  active: string | null;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  /** Right-click on a tab (e.g. a context menu). */
  onContextMenu?: (id: string, event: React.MouseEvent) => void;
};

/** Underlined tab strip, for documents and other open-item lists. */
export function Tabs({ tabs, active, onSelect, onClose, onContextMenu }: Props) {
  return (
    <div className="ygg-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={`ygg-tab${tab.id === active ? " ygg-tab--active" : ""}`}
          onClick={() => onSelect(tab.id)}
          onContextMenu={onContextMenu ? (e) => onContextMenu(tab.id, e) : undefined}
        >
          {tab.label}
          {tab.closable && onClose && (
            <span
              className="ygg-tab__close"
              aria-label={`Cerrar ${tab.label}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              ×
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
