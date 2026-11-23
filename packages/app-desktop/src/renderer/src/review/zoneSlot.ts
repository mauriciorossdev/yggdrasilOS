import type * as Monaco from "monaco-editor";

/** Narrowest a card gets; below that it reaches over the gutter. */
const MIN_WIDTH = 300;

/**
 * Room under a line for interactive content (a comment card or the composer).
 * A view zone reserves the vertical space; an overlay widget on top of it holds
 * the DOM, the way Monaco's own peek view does: view-zone DOM sits inside the
 * text layer, where clicks and keys belong to the editor.
 */
export class ZoneSlot {
  readonly dom: HTMLDivElement;
  private zone: Monaco.editor.IViewZone | null = null;
  private zoneId: string | null = null;
  private readonly widget: Monaco.editor.IOverlayWidget;
  private readonly subs: Monaco.IDisposable[] = [];
  private height = 48;

  constructor(
    private readonly editor: Monaco.editor.ICodeEditor,
    id: string,
    private afterLine: number,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "review-zone";
    this.dom.style.position = "absolute";
    this.dom.style.top = "-10000px";
    // Keep the editor from treating clicks and keys in a card as its own (moving the cursor, running keybindings).
    for (const type of ["mousedown", "keydown", "keyup", "keypress"] as const) {
      this.dom.addEventListener(type, (e) => e.stopPropagation());
    }
    this.widget = { getId: () => `ygg-review-${id}`, getDomNode: () => this.dom, getPosition: () => null };
    editor.addOverlayWidget(this.widget);
    this.addZone();
    this.layoutWidth();
    this.subs.push(editor.onDidLayoutChange(() => this.layoutWidth()));
  }

  private addZone(): void {
    this.editor.changeViewZones((acc) => {
      this.zone = {
        afterLineNumber: this.afterLine,
        heightInPx: this.height,
        domNode: document.createElement("div"),
        onDomNodeTop: (top) => {
          this.dom.style.top = `${top}px`;
        },
      };
      this.zoneId = acc.addZone(this.zone);
    });
  }

  private layoutWidth(): void {
    const info = this.editor.getLayoutInfo();
    const usable = Math.max(0, info.width - info.verticalScrollbarWidth - info.minimap.minimapWidth);
    // A narrow editor (one side of a split diff) would squeeze the card to a word per line: let it
    // reach over the gutter instead, down to the editor's left edge.
    const width = Math.min(usable, Math.max(usable - info.contentLeft, MIN_WIDTH));
    this.dom.style.left = `${usable - width}px`;
    this.dom.style.width = `${width}px`;
  }

  setHeight(px: number): void {
    const h = Math.ceil(px);
    if (h === this.height || !this.zone || !this.zoneId) return;
    this.height = h;
    this.zone.heightInPx = h;
    const id = this.zoneId;
    this.editor.changeViewZones((acc) => acc.layoutZone(id));
  }

  moveTo(afterLine: number): void {
    if (afterLine === this.afterLine || !this.zone || !this.zoneId) return;
    this.afterLine = afterLine;
    this.zone.afterLineNumber = afterLine;
    const id = this.zoneId;
    this.editor.changeViewZones((acc) => acc.layoutZone(id));
  }

  dispose(): void {
    this.subs.forEach((s) => s.dispose());
    const id = this.zoneId;
    this.zone = null;
    this.zoneId = null;
    // The editor may already be gone (a diff that unmounted); its zones went with it.
    try {
      if (id) this.editor.changeViewZones((acc) => acc.removeZone(id));
      this.editor.removeOverlayWidget(this.widget);
    } catch {
      this.dom.remove();
    }
  }
}
