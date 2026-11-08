/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { ipcRenderer } from "electron";
import { cssSelectorFor, findBySelector } from "./pageSelector.js";

/**
 * The Browser tab's "comment on elements" overlay, drawn *inside* the loaded
 * page: a WebContentsView paints over the app window's DOM, so anything
 * floating above the page has to live in the page itself. Everything sits in
 * one closed shadow root (the page's CSS can't reach it, its JS can't see it)
 * and is built with createElement/CSSOM only — no innerHTML / inline <style>,
 * which strict Trusted-Types / style-src CSPs would reject.
 *
 * main (browserTabView.ts → browserCommentsHost.ts) owns the data; this file is
 * only the view. See browserComments.ts for the persisted shape.
 */

type Comment = {
  id: string;
  selector: string;
  tag: string;
  elId?: string;
  classes?: string;
  text: string;
  outerHtml: string;
  comment: string;
  pageUrl: string;
  pageTitle: string;
  /** Absent on comments saved before captures existed — read as "change". */
  kind?: "change" | "capture";
  scope?: "element" | "article" | "page" | "url";
  /** Absent on comments saved before statuses existed. */
  status?: "idle" | "sent" | "done";
  sentTo?: string;
};
type Status = NonNullable<Comment["status"]>;
const statusOf = (c: Comment): Status => c.status ?? "idle";
const STATUS_LABEL: Record<Status, string> = { idle: "Idle", sent: "Sent", done: "Done" };
type Targets = {
  panes: Array<{ id: string; title: string; command?: string }>;
  providers: Array<{ id: string; label: string; command: string }>;
};

const CSS_TEXT = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.hl { position: fixed; border: 2px solid #6bd08a; background: rgba(107,208,138,.15); border-radius: 2px; display: none; pointer-events: none; }
.flash { position: fixed; border: 2px solid #f2c94c; background: rgba(242,201,76,.2); border-radius: 2px; pointer-events: none; }
.badge { position: fixed; width: 20px; height: 20px; border-radius: 10px; background: #6bd08a; color: #10150f; font-weight: 700; display: flex; align-items: center; justify-content: center; pointer-events: auto; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
.panel { position: fixed; top: 12px; right: 12px; width: 320px; max-height: 70vh; display: flex; flex-direction: column; background: #1b1d21; color: #e6e6e6; border: 1px solid #3a3d44; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.5); pointer-events: auto; }
.head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #3a3d44; cursor: move; user-select: none; }
.head .title { flex: 1; font-weight: 600; }
.list { overflow: auto; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
.item { border: 1px solid #3a3d44; border-radius: 6px; padding: 8px; background: #23262b; }
.item .top { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.item .num { flex: none; width: 18px; height: 18px; border-radius: 9px; background: #6bd08a; color: #10150f; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.badge.st-idle, .item .num.st-idle { background: #9aa0aa; }
.badge.st-sent, .item .num.st-sent { background: #f2c94c; }
.badge.st-done, .item .num.st-done { background: #6bd08a; }
.chip { flex: 0 1 auto; min-width: 0; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 6px; border-radius: 8px; font-size: 11px; font-weight: 600; color: #10150f; }
.chip.st-idle { background: #9aa0aa; }
.chip.st-sent { background: #f2c94c; }
.chip.st-done { background: #6bd08a; }
.item .el { flex: 1; min-width: 0; color: #9aa0aa; font-family: ui-monospace, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item .label { margin: 6px 0; white-space: pre-wrap; word-break: break-word; }
.row { display: flex; gap: 6px; justify-content: flex-end; position: relative; }
textarea { width: 100%; min-height: 60px; resize: vertical; background: #14161a; color: #e6e6e6; border: 1px solid #3a3d44; border-radius: 4px; padding: 6px; }
button { background: #2f333a; color: #e6e6e6; border: 1px solid #3a3d44; border-radius: 4px; padding: 3px 8px; cursor: pointer; }
button:hover { background: #3a3f47; }
button.primary { background: #6bd08a; color: #10150f; border-color: #6bd08a; font-weight: 600; }
button.danger:hover { background: #7a2e2e; }
.composer { position: fixed; width: 280px; padding: 8px; background: #1b1d21; color: #e6e6e6; border: 1px solid #6bd08a; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.5); pointer-events: auto; display: flex; flex-direction: column; gap: 6px; }
.pop { position: fixed; pointer-events: auto; min-width: 200px; max-height: 240px; overflow: auto; background: #1b1d21; border: 1px solid #3a3d44; border-radius: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.5); padding: 4px; }
.pop .sec { padding: 4px 8px; color: #9aa0aa; font-size: 11px; text-transform: uppercase; }
.pop button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 5px 8px; }
.pop button:hover { background: #2f333a; }
.status { padding: 6px 10px; border-top: 1px solid #3a3d44; color: #9aa0aa; }
.status.err { color: #ff8a8a; }
select { width: 100%; background: #14161a; color: #e6e6e6; border: 1px solid #3a3d44; border-radius: 4px; padding: 4px 6px; }
.subhead { display: flex; gap: 6px; padding: 6px 10px; border-bottom: 1px solid #3a3d44; }
.capform { padding: 8px 10px; border-bottom: 1px solid #3a3d44; display: flex; flex-direction: column; gap: 6px; }
.hint { padding: 12px; color: #9aa0aa; text-align: center; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<{ className: string; text: string; title: string }> = {},
  ...children: Array<Node | null>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

function btn(label: string, onClick: (e: MouseEvent) => void, cls = ""): HTMLButtonElement {
  const b = el("button", { text: label, className: cls });
  b.type = "button";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

export function initPageComments(): void {
  let mode = false;
  let comments: Comment[] = [];
  let collapsed = false;
  // The panel's own close button; turning comment mode on (or clicking a badge) brings it back.
  let panelHidden = false;
  let editingId: string | null = null;
  let pageCapture: "page" | "url" | null = null;
  let popoverFor: string | "all" | null = null;
  let popoverIds: string[] | undefined;
  let popoverAnchor: DOMRect | null = null;
  let targets: Targets | null = null;
  let status: { text: string; err: boolean } | null = null;
  let lastPageUrl = location.href;

  let host: HTMLDivElement | null = null;
  let root: ShadowRoot | null = null;
  let layer: HTMLDivElement;
  let hl: HTMLDivElement;
  let badgeBox: HTMLDivElement;
  let panelBox: HTMLDivElement;
  let composerBox: HTMLDivElement;
  let popBox: HTMLDivElement;
  let panelDragged: { x: number; y: number } | null = null;

  const pageKey = (url: string): string => {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return url;
    }
  };

  function ensureHost(): void {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement("div");
    root = host.attachShadow({ mode: "closed" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS_TEXT);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement("style");
      style.textContent = CSS_TEXT;
      root.appendChild(style);
    }
    layer = el("div", { className: "layer" });
    hl = el("div", { className: "hl" });
    badgeBox = el("div");
    panelBox = el("div");
    composerBox = el("div");
    popBox = el("div");
    layer.append(hl, badgeBox, panelBox, composerBox, popBox);
    // Click anywhere non-button in the overlay dismisses the send popover.
    layer.addEventListener("click", () => {
      if (popoverFor) {
        popoverFor = null;
        render();
      }
    });
    root.appendChild(layer);
    // Keep the page's own handlers (click-outside-to-close, hotkeys…) from reacting to the overlay.
    for (const type of ["click", "mousedown", "mouseup", "pointerdown", "keydown", "keyup", "keypress", "wheel", "focusin"]) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    document.documentElement.appendChild(host);
    render();
  }

  const inOverlay = (e: Event): boolean => !!host && e.composedPath().includes(host);

  // ---- data -----------------------------------------------------------
  async function reload(): Promise<void> {
    lastPageUrl = location.href;
    try {
      comments = (await ipcRenderer.invoke("browserTab:comments:list", location.href)) as Comment[];
    } catch {
      comments = [];
    }
    if (comments.length > 0 || mode) ensureHost();
    render();
  }

  type Draft = { kind: "change" | "capture"; scope?: "element" | "article" | "page" | "url" };

  async function addComment(target: Element | null, text: string, draft: Draft): Promise<void> {
    const created = (await ipcRenderer.invoke("browserTab:comments:add", {
      // Whole-page / link captures have no element behind them.
      selector: target ? cssSelectorFor(target) : "",
      tag: target ? target.tagName.toLowerCase() : "page",
      elId: target?.id || undefined,
      classes: target && typeof target.className === "string" && target.className ? target.className : undefined,
      text: target ? (target.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 200) : "",
      outerHtml: target ? target.outerHTML.slice(0, 500) : "",
      comment: text,
      kind: draft.kind,
      scope: draft.scope,
      pageUrl: location.href,
      pageTitle: document.title,
    })) as Comment;
    comments = [...comments, created];
    render();
  }

  async function send(ids: string[] | undefined, target: { kind: "pane"; paneId: string; name?: string } | { kind: "new"; command: string; label: string }, name: string): Promise<void> {
    popoverFor = null;
    status = { text: `Sending to ${name}…`, err: false };
    render();
    const res = (await ipcRenderer.invoke("browserTab:comments:send", { pageUrl: location.href, ids, target })) as {
      ok: boolean;
      error?: string;
    };
    status = res.ok ? { text: `Sent to ${name}`, err: false } : { text: res.error ?? "Send failed", err: true };
    // main persisted the new statuses; re-read so chips/badges reflect them.
    await reload();
    render();
    setTimeout(() => {
      status = null;
      render();
    }, 4000);
  }

  // ---- mode: pick an element to comment on ----------------------------
  function onMove(e: MouseEvent): void {
    if (inOverlay(e) || !(e.target instanceof Element)) {
      hl.style.display = "none";
      return;
    }
    const r = e.target.getBoundingClientRect();
    Object.assign(hl.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  function onClickPage(e: MouseEvent): void {
    if (inOverlay(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target instanceof Element) openComposer(e.target);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key !== "Escape" || inOverlay(e)) return;
    if (composerBox.firstChild) closeComposer();
    else setMode(false, true);
  }

  function setMode(on: boolean, notify = false): void {
    if (on === mode) return;
    mode = on;
    if (on) {
      panelHidden = false;
      ensureHost();
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClickPage, true);
      document.addEventListener("keydown", onKey, true);
      document.body?.style.setProperty("cursor", "crosshair", "important");
    } else {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClickPage, true);
      document.removeEventListener("keydown", onKey, true);
      document.body?.style.removeProperty("cursor");
      if (host) {
        hl.style.display = "none";
        closeComposer();
      }
      if (notify) ipcRenderer.send("browserTab:comments:modeOff");
    }
    render();
  }

  function openComposer(target: Element): void {
    closeComposer();
    hl.style.display = "none";
    const r = target.getBoundingClientRect();
    const ta = el("textarea");
    const kindSel = el("select");
    const OPTIONS: Array<[string, string]> = [
      ["change", "Change (edit the code)"],
      ["element", "Save this element"],
      ["article", "Save the article"],
    ];
    for (const [value, label] of OPTIONS) {
      const o = el("option", { text: label });
      o.value = value;
      kindSel.appendChild(o);
    }
    const syncPlaceholder = () => {
      ta.placeholder =
        kindSel.value === "change"
          ? "Describe the change for this element…"
          : "Instruction (optional): summarized, download the image, save in notes/competitors/…";
    };
    kindSel.addEventListener("change", syncPlaceholder);
    syncPlaceholder();
    const submit = () => {
      const text = ta.value.trim();
      const draft: Draft = kindSel.value === "change" ? { kind: "change" } : { kind: "capture", scope: kindSel.value as Draft["scope"] };
      // A change needs a description; a capture works without one (default: save everything under notes/).
      if (!text && draft.kind === "change") return;
      closeComposer();
      void addComment(target, text, draft);
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
    });
    const box = el(
      "div",
      { className: "composer" },
      el("div", { text: `<${target.tagName.toLowerCase()}>`, className: "el" }),
      kindSel,
      ta,
      el("div", { className: "row" }, btn("Cancel", closeComposer), btn("Add", submit, "primary")),
    );
    box.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 296))}px`;
    const below = r.bottom + 8;
    box.style.top = `${below + 210 > window.innerHeight ? Math.max(8, r.top - 210) : below}px`;
    composerBox.replaceChildren(box);
    ta.focus();
  }
  function closeComposer(): void {
    composerBox?.replaceChildren();
  }

  // ---- rendering ------------------------------------------------------
  function elementLabel(c: Comment): string {
    if (c.kind === "capture") {
      if (c.scope === "page") return "Save page";
      if (c.scope === "url") return "Save link";
      if (c.scope === "article") return "Save article";
      return `Save <${c.tag}>`;
    }
    const sel = c.selector.length > 48 ? `…${c.selector.slice(-47)}` : c.selector;
    return `<${c.tag}> ${sel}`;
  }

  function flash(c: Comment): void {
    const target = findBySelector(c.selector);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      const r = target.getBoundingClientRect();
      const f = el("div", { className: "flash" });
      Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      layer.appendChild(f);
      setTimeout(() => f.remove(), 1200);
    }, 350);
  }

  function popover(ids: string[] | undefined): HTMLElement {
    const pop = el("div", { className: "pop" });
    if (!targets) {
      pop.appendChild(el("div", { className: "sec", text: "Loading…" }));
      return pop;
    }
    pop.appendChild(el("div", { className: "sec", text: "Agents" }));
    if (targets.panes.length === 0) pop.appendChild(el("div", { className: "sec", text: "No running agents" }));
    for (const p of targets.panes) {
      pop.appendChild(btn(p.title + (p.command ? ` (${p.command})` : ""), () => void send(ids, { kind: "pane", paneId: p.id, name: p.title }, p.title)));
    }
    pop.appendChild(el("div", { className: "sec", text: "New agent" }));
    for (const p of targets.providers) {
      pop.appendChild(btn(p.label, () => void send(ids, { kind: "new", command: p.command, label: p.label }, p.label)));
    }
    return pop;
  }

  function sendButton(key: string, ids: string[] | undefined, label: string): HTMLElement {
    return btn(label, (e) => {
      if (popoverFor === key) {
        popoverFor = null;
      } else {
        popoverFor = key;
        popoverIds = ids;
        popoverAnchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
        targets = null;
        void (ipcRenderer.invoke("browserTab:comments:targets") as Promise<Targets>).then((t) => {
          targets = t;
          render();
        });
      }
      render();
    }, "primary");
  }

  // Lives in the top-level layer (not inside the panel's scrolling list, which would clip it),
  // placed above the anchor button when there is room, else below, and clamped to the viewport.
  function renderPopover(): void {
    if (!popoverFor || !popoverAnchor) {
      popBox.replaceChildren();
      return;
    }
    const pop = popover(popoverIds);
    pop.style.visibility = "hidden";
    popBox.replaceChildren(pop);
    const h = pop.getBoundingClientRect().height;
    const w = pop.getBoundingClientRect().width;
    const a = popoverAnchor;
    const top = a.top - h - 4 >= 8 ? a.top - h - 4 : Math.min(a.bottom + 4, window.innerHeight - h - 8);
    pop.style.top = `${Math.max(8, top)}px`;
    pop.style.left = `${Math.max(8, Math.min(a.right - w, window.innerWidth - w - 8))}px`;
    pop.style.visibility = "visible";
  }

  function headerText(): string {
    const n = (s: Status) => comments.filter((c) => statusOf(c) === s).length;
    const parts = [`Comments (${comments.length})`];
    if (n("sent")) parts.push(`${n("sent")} sent`);
    if (n("done")) parts.push(`${n("done")} done`);
    return parts.join(" · ");
  }

  async function setStatus(c: Comment, status: Status): Promise<void> {
    await ipcRenderer.invoke("browserTab:comments:setStatus", [c.id], status);
    comments = comments.map((x) => (x.id === c.id ? { ...x, status, sentTo: status === "idle" ? undefined : x.sentTo } : x));
    render();
  }

  function renderPanel(): void {
    if (panelHidden || (comments.length === 0 && !mode)) {
      panelBox.replaceChildren();
      return;
    }
    const head = el("div", { className: "head" }, el("span", { className: "title", text: headerText() }));
    if (comments.length > 1) head.appendChild(sendButton("all", undefined, "Send all"));
    head.appendChild(btn(collapsed ? "▾" : "▴", () => { collapsed = !collapsed; render(); }));
    const closeBtn = btn("✕", () => {
      panelHidden = true;
      // Leaving comment mode too, so the toolbar button stops reading "Click an element…".
      if (mode) setMode(false, true);
      else render();
    });
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close comments panel");
    head.appendChild(closeBtn);
    const panel = el("div", { className: "panel" }, head);
    if (!collapsed) {
      panel.appendChild(
        el(
          "div",
          { className: "subhead" },
          btn("Save page", () => { pageCapture = pageCapture === "page" ? null : "page"; render(); }),
          btn("Save link", () => { pageCapture = pageCapture === "url" ? null : "url"; render(); }),
        ),
      );
      if (pageCapture) panel.appendChild(renderPageCaptureForm(pageCapture));
    }
    if (panelDragged) Object.assign(panel.style, { left: `${panelDragged.x}px`, top: `${panelDragged.y}px`, right: "auto" });
    head.addEventListener("mousedown", (e) => {
      if ((e.target as Element).closest("button")) return;
      const r = panel.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const move = (m: MouseEvent) => {
        panelDragged = { x: Math.max(0, m.clientX - dx), y: Math.max(0, m.clientY - dy) };
        Object.assign(panel.style, { left: `${panelDragged.x}px`, top: `${panelDragged.y}px`, right: "auto" });
      };
      const up = () => {
        window.removeEventListener("mousemove", move, true);
        window.removeEventListener("mouseup", up, true);
      };
      window.addEventListener("mousemove", move, true);
      window.addEventListener("mouseup", up, true);
    });

    if (!collapsed) {
      const list = el("div", { className: "list" });
      if (comments.length === 0) list.appendChild(el("div", { className: "hint", text: "Click an element on the page to comment on it, or save the whole page above." }));
      comments.forEach((c, i) => list.appendChild(renderItem(c, i)));
      panel.appendChild(list);
    }
    if (status) panel.appendChild(el("div", { className: status.err ? "status err" : "status", text: status.text }));
    panelBox.replaceChildren(panel);
  }

  function renderPageCaptureForm(scope: "page" | "url"): HTMLElement {
    const ta = el("textarea");
    ta.placeholder = "Instruction (optional): summarized, only the price table, save in notes/competitors/…";
    const submit = () => {
      pageCapture = null;
      void addComment(null, ta.value.trim(), { kind: "capture", scope });
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
    });
    queueMicrotask(() => ta.focus());
    return el(
      "div",
      { className: "capform" },
      el("div", { className: "el", text: scope === "page" ? "Save the whole page" : "Save the link only" }),
      ta,
      el("div", { className: "row" }, btn("Cancel", () => { pageCapture = null; render(); }), btn("Add", submit, "primary")),
    );
  }

  function renderItem(c: Comment, i: number): HTMLElement {
    const st = statusOf(c);
    const chipText = st === "sent" && c.sentTo ? `Sent · ${c.sentTo}` : STATUS_LABEL[st];
    const top = el(
      "div",
      { className: "top" },
      el("span", { className: `num st-${st}`, text: st === "done" ? "✓" : String(i + 1) }),
      el("span", { className: "el", text: elementLabel(c), title: c.selector }),
      el("span", { className: `chip st-${st}`, text: chipText }),
    );
    top.addEventListener("click", () => flash(c));
    const item = el("div", { className: "item" }, top);

    if (editingId === c.id) {
      const ta = el("textarea");
      ta.value = c.comment;
      const save = async () => {
        const text = ta.value.trim();
        if (!text) return;
        await ipcRenderer.invoke("browserTab:comments:update", location.href, c.id, text);
        comments = comments.map((x) => (x.id === c.id ? { ...x, comment: text } : x));
        editingId = null;
        render();
      };
      item.append(el("div", { className: "label" }, ta), el("div", { className: "row" }, btn("Cancel", () => { editingId = null; render(); }), btn("Save", () => void save(), "primary")));
      queueMicrotask(() => ta.focus());
    } else {
      item.append(
        el("div", { className: "label", text: c.comment }),
        el(
          "div",
          { className: "row" },
          st === "sent" ? btn("Mark done", () => void setStatus(c, "done")) : null,
          st === "done" ? btn("Reopen", () => void setStatus(c, "idle")) : null,
          btn("Change", () => { editingId = c.id; render(); }),
          btn("Delete", () => {
            void ipcRenderer.invoke("browserTab:comments:remove", location.href, c.id).then(() => {
              comments = comments.filter((x) => x.id !== c.id);
              render();
            });
          }, "danger"),
          sendButton(c.id, [c.id], "Send"),
        ),
      );
    }
    return item;
  }

  function renderBadges(): void {
    const frag: Node[] = [];
    comments.forEach((c, i) => {
      const target = findBySelector(c.selector);
      if (!target) return;
      const r = target.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const st = statusOf(c);
      const b = el("div", { className: `badge st-${st}`, text: st === "done" ? "✓" : String(i + 1), title: `${STATUS_LABEL[st]}: ${c.comment}` });
      b.style.left = `${Math.max(0, r.left - 6)}px`;
      b.style.top = `${Math.max(0, r.top - 6)}px`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        collapsed = false;
        panelHidden = false;
        render();
        flash(c);
      });
      frag.push(b);
    });
    badgeBox.replaceChildren(...frag);
  }

  let rafPending = false;
  function render(): void {
    if (!host) return;
    renderPanel();
    renderBadges();
    renderPopover();
  }
  function scheduleBadges(): void {
    if (rafPending || !host) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderBadges();
    });
  }

  // ---- wiring ---------------------------------------------------------
  ipcRenderer.on("browserTab:comments:changed", () => void reload());
  ipcRenderer.on("browserTab:comments:mode", (_e, on: boolean) => setMode(Boolean(on)));
  const boot = () => {
    void reload();
    void (ipcRenderer.invoke("browserTab:comments:getMode") as Promise<boolean>).then((on) => on && setMode(true));
    window.addEventListener("scroll", scheduleBadges, true);
    window.addEventListener("resize", scheduleBadges);
    new MutationObserver(scheduleBadges).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    // SPA route changes (pushState) are invisible from this isolated world; poll for them.
    setInterval(() => {
      if (pageKey(location.href) !== pageKey(lastPageUrl)) void reload();
      else scheduleBadges();
    }, 1000);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
