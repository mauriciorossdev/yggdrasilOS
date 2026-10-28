import { join } from "node:path";
import { shell, WebContentsView, type BrowserWindow, type DownloadItem, type Input } from "electron";
import { normalizeBrowserUrl, resolveBrowserInput } from "./browserUrl.js";
import { buildClickScript, buildReadScript, buildTypeScript, clampMaxChars } from "./browserPageScripts.js";
import { matchBrowserShortcut, nextZoomFactor, type BrowserShortcutAction } from "./browserShortcuts.js";

export { normalizeBrowserUrl, resolveBrowserInput };

export type BrowserTabBounds = { x: number; y: number; width: number; height: number };

export type PickedElement = {
  tag: string;
  id?: string;
  classes?: string;
  selector: string;
  text: string;
  outerHtml: string;
  rect: { x: number; y: number; width: number; height: number };
  pageUrl: string;
  pageTitle: string;
};

/** One entry of the tab strip. */
export type BrowserTabSummary = { id: string; title: string; url: string; loading: boolean };

/** Navigation state of a single page. */
export type BrowserPageState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Page zoom in percent (100 = default). */
  zoom: number;
  /** Set when the main frame failed to load; cleared by the next navigation. */
  error: string | null;
};

/** Pushed to the renderer on every navigation/loading/tab change (browserTab:state): the active page's state plus the tab strip. */
export type BrowserTabState = BrowserPageState & {
  tabs: BrowserTabSummary[];
  activeId: string | null;
};

/** A finished (or failed) download started from a page; `path` is where it was saved ("" if the user cancelled the save dialog). */
export type BrowserDownload = { name: string; path: string; state: "completed" | "cancelled" | "interrupted" };

/** What an agent gets back from reading the page — all of it page-controlled, untrusted data. */
export type BrowserPageRead = {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  totalChars: number;
  /** Visible interactive elements with a selector browser_click / browser_type accept. */
  elements: Array<{ tag: string; selector: string; text?: string; href?: string; type?: string; placeholder?: string }>;
};

/**
 * The Browser tab as the rest of the app sees it. Page operations (navigate,
 * read, click, ...) always act on the *active* browser tab, so agent tools
 * written before tabs existed keep working unchanged.
 */
export type BrowserTabHandle = {
  /** Navigates the active tab (creating one if there are none), attaching the view first if it was hidden — matches an address bar's "type a URL, hit Go" always making the page visible. */
  navigate: (url: string) => Promise<void>;
  /** Address-bar flavor of navigate: anything that isn't a URL or host becomes a web search, and a failed load is reported through `state.error` instead of rejecting. */
  go: (input: string) => Promise<void>;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  getState: () => BrowserTabState;
  /** Opens a new browser tab and makes it active; with `input` it also navigates it (URL-or-search, like the address bar). Resolves with the new tab's id. */
  newTab: (input?: string) => Promise<string>;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  /** Opens (detached) or closes the active tab's DevTools. */
  toggleDevTools: () => void;
  /** Zooms the active tab one step, or back to 100%. */
  zoom: (direction: "in" | "out" | "reset") => void;
  /** Reveals a downloaded file in the OS file manager — only for paths this tab itself reported as downloaded. */
  showDownload: (path: string) => void;
  /** Throws if no page is loaded. */
  readPage: (maxChars?: number) => Promise<BrowserPageRead>;
  /** PNG of what the view currently shows, downscaled to at most 1280px wide. Throws if no page is loaded. */
  screenshot: () => Promise<{ base64: string; mimeType: "image/png"; width: number; height: number }>;
  /** Clicks the first element matching `selector`; resolves once any navigation it caused has settled. */
  click: (selector: string) => Promise<{ tag: string; text: string; url: string; title: string }>;
  /** Replaces the value of a text field (optionally pressing Enter / submitting its form). */
  type: (selector: string, text: string, submit?: boolean) => Promise<{ tag: string; url: string; title: string }>;
  /** Renderer-driven — BrowserTabView.tsx's placeholder div reports its own real screen rect via ResizeObserver, since a WebContentsView is a native layer composited by Electron, not a DOM node any CSS here can size. */
  setBounds: (bounds: BrowserTabBounds) => void;
  show: () => void;
  hide: () => void;
  getUrl: () => string;
  /** Arms the loaded page's own hover-highlight + click-to-select overlay (browserTabPickerPreload.ts). Resolves with the picked element, or null if the user hits Escape / never picks anything within `timeoutMs`. */
  startPick: (timeoutMs?: number) => Promise<PickedElement | null>;
  destroy: () => void;
};

type PageHooks = {
  /** Anything the tab strip or toolbar mirrors changed (title, loading, URL, ...). */
  onChange: () => void;
  /** The page asked for a new window (target=_blank, window.open). */
  onOpenWindow: (url: string) => void;
  /** The page is about to show its first content — time to attach its view. */
  onFirstNavigation: () => void;
  onDownload: (download: BrowserDownload) => void;
  onShortcut: (action: BrowserShortcutAction) => void;
};

/**
 * One page: a WebContentsView plus its navigation/read/act logic. Attaching it
 * to the window, sizing it, and deciding which page is active is the manager's
 * job (createBrowserTabView below). `sandbox`/`contextIsolation` stay on
 * (Electron's secure defaults) since, unlike the app's own window, this one
 * deliberately loads arbitrary remote content the app doesn't control.
 */
function createPage(win: BrowserWindow, hooks: PageHooks) {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Runs inside whatever arbitrary page gets loaded here — see
      // browserTabPickerPreload.ts's own header comment for why a sandboxed
      // preload (no contextBridge exposure) is safe to hand to untrusted
      // content. electron-vite builds it as its own entry alongside the
      // app's main preload (see electron.vite.config.ts) — same directory,
      // hence the relative "../preload/..." from this bundle's own output
      // location (dist/main/).
      preload: join(__dirname, "../preload/browserTabPicker.cjs"),
    },
  });
  const wc = view.webContents;

  // Real-page links (target=_blank, window.open) shouldn't spawn more
  // Electron windows — they open as a new browser tab instead (http/https
  // only, same as every other entry point).
  wc.setWindowOpenHandler(({ url }) => {
    try {
      hooks.onOpenWindow(normalizeBrowserUrl(url));
    } catch {
      // unsupported scheme — drop it
    }
    return { action: "deny" };
  });

  let loadError: string | null = null;
  const nav = wc.navigationHistory;
  const getState = (): BrowserPageState => ({
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: nav.canGoBack(),
    canGoForward: nav.canGoForward(),
    zoom: Math.round(wc.getZoomFactor() * 100),
    error: loadError,
  });
  const requireLoadedPage = (): void => {
    if (!wc.getURL() || /^(about:blank|chrome-error:)/.test(wc.getURL())) {
      throw new Error("No page is loaded in the Browser tab — call browser_open first.");
    }
  };
  /** Runs a page script, unwrapping its `{ ok, error }` envelope. */
  async function runPageScript<T extends { ok: boolean }>(script: string): Promise<T> {
    requireLoadedPage();
    const result = (await wc.executeJavaScript(script)) as T & { error?: string };
    if (!result.ok) throw new Error(result.error ?? "page script failed");
    return result;
  }
  /** After an action that may navigate: give it a beat to start, then wait (bounded) for loading to finish. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (!wc.isLoading()) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wc.removeListener("did-stop-loading", done);
        resolve();
      };
      const timer = setTimeout(done, 8000);
      wc.once("did-stop-loading", done);
    });
  }

  wc.on("did-start-loading", () => {
    loadError = null;
    hooks.onChange();
  });
  wc.on("did-stop-loading", hooks.onChange);
  wc.on("did-navigate", hooks.onChange);
  wc.on("did-navigate-in-page", hooks.onChange);
  wc.on("page-title-updated", hooks.onChange);
  wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED: a superseded navigation (user clicked again, redirect), not a failure.
    if (!isMainFrame || errorCode === -3) return;
    loadError = `${errorDescription} (${validatedURL})`;
    hooks.onChange();
  });

  let pickResolve: ((el: PickedElement | null) => void) | null = null;
  let pickTimer: ReturnType<typeof setTimeout> | null = null;
  function resolvePick(el: PickedElement | null): void {
    if (pickTimer) {
      clearTimeout(pickTimer);
      pickTimer = null;
    }
    const resolve = pickResolve;
    pickResolve = null;
    resolve?.(el);
  }
  // ipc (not the global ipcMain) scopes these listeners to messages from
  // *this* view's webContents specifically — see WebContents#ipc.
  wc.ipc.on("browserTab:elementPicked", (_event, data) => resolvePick(data as PickedElement));
  wc.ipc.on("browserTab:pickCancelled", () => resolvePick(null));

  // Shortcuts while focus is inside the page (the app window's own input goes
  // through the manager's win.webContents listener instead).
  wc.on("before-input-event", (event, input: Input) => {
    const action = matchBrowserShortcut(input, process.platform === "darwin");
    if (!action) return;
    event.preventDefault();
    hooks.onShortcut(action);
  });

  // Downloads use Electron's default save dialog; this only reports the outcome.
  // `will-download` fires on the (shared) session, so ignore other webContents.
  const session = wc.session;
  const onWillDownload = (_event: unknown, item: DownloadItem, source: unknown) => {
    if (source !== wc) return;
    item.once("done", (_doneEvent, state) => {
      hooks.onDownload({ name: item.getFilename(), path: item.getSavePath(), state });
    });
  };
  session.on("will-download", onWillDownload);

  let attached = false;
  // A tab that never navigated stays unattached: its native view is an opaque
  // blank rectangle that would cover the renderer's "enter a URL" placeholder.
  let started = false;

  return {
    getState,
    hasContent: () => started || !!wc.getURL(),
    getUrl: () => wc.getURL(),
    isAttached: () => attached,
    attach(bounds: BrowserTabBounds | null): void {
      if (!attached) {
        win.contentView.addChildView(view);
        attached = true;
      }
      if (bounds) view.setBounds(bounds);
      // Re-focus even if already attached — this runs every time the renderer
      // switches back to the Browser tab, and mouse wheel/trackpad scroll into
      // a WebContentsView is a known no-op in Electron until its webContents
      // actually has focus (attaching the view alone isn't enough).
      wc.focus();
    },
    detach(): void {
      resolvePick(null);
      if (!attached) return;
      win.contentView.removeChildView(view);
      attached = false;
    },
    setBounds: (bounds: BrowserTabBounds) => view.setBounds(bounds),
    focus: () => wc.focus(),
    async navigate(url: string): Promise<void> {
      // The page a pick was armed on is about to be gone either way.
      resolvePick(null);
      const target = normalizeBrowserUrl(url);
      if (!started) {
        started = true;
        hooks.onFirstNavigation();
      }
      await wc.loadURL(target);
      // A fresh page load can drop focus back to the host window — restore
      // it so scroll works immediately without an extra click first.
      wc.focus();
    },
    async go(input: string): Promise<void> {
      try {
        await this.navigate(resolveBrowserInput(input));
      } catch (err) {
        // loadURL rejects on any failed load; did-fail-load already put it in state.error.
        // A bad scheme throws before loading — surface that the same way.
        const message = err instanceof Error ? err.message : String(err);
        if (/ERR_ABORTED/.test(message)) return; // superseded by a newer navigation
        if (!loadError) loadError = message;
        hooks.onChange();
      }
    },
    back: () => {
      if (nav.canGoBack()) nav.goBack();
    },
    forward: () => {
      if (nav.canGoForward()) nav.goForward();
    },
    reload: () => wc.reload(),
    reloadHard: () => wc.reloadIgnoringCache(),
    stop: () => wc.stop(),
    zoom(direction: "in" | "out" | "reset"): void {
      wc.setZoomFactor(direction === "reset" ? 1 : nextZoomFactor(wc.getZoomFactor(), direction));
      hooks.onChange();
    },
    toggleDevTools(): void {
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: "detach" });
    },
    async readPage(maxChars?: number): Promise<BrowserPageRead> {
      const r = await runPageScript<{ ok: true } & BrowserPageRead>(buildReadScript(clampMaxChars(maxChars)));
      return {
        url: r.url,
        title: r.title,
        text: r.text,
        truncated: r.truncated,
        totalChars: r.totalChars,
        elements: r.elements,
      };
    },
    async screenshot() {
      requireLoadedPage();
      const image = await wc.capturePage();
      if (image.isEmpty()) {
        throw new Error("The page could not be captured — make sure the Browser tab is visible.");
      }
      const MAX_WIDTH = 1280;
      const size = image.getSize();
      const scaled = size.width > MAX_WIDTH ? image.resize({ width: MAX_WIDTH }) : image;
      const out = scaled.getSize();
      return {
        base64: scaled.toPNG().toString("base64"),
        mimeType: "image/png" as const,
        width: out.width,
        height: out.height,
      };
    },
    async click(selector: string) {
      const r = await runPageScript<{ ok: true; tag: string; text: string }>(buildClickScript(selector));
      await settle();
      return { tag: r.tag, text: r.text, url: wc.getURL(), title: wc.getTitle() };
    },
    async type(selector: string, text: string, submit = false) {
      const r = await runPageScript<{ ok: true; tag: string }>(buildTypeScript(selector, text, submit));
      if (submit) await settle();
      return { tag: r.tag, url: wc.getURL(), title: wc.getTitle() };
    },
    startPick(timeoutMs = 120_000): Promise<PickedElement | null> {
      if (pickResolve) resolvePick(null); // one active pick at a time
      wc.send("browserTab:startPick");
      return new Promise<PickedElement | null>((resolve) => {
        pickResolve = resolve;
        pickTimer = setTimeout(() => {
          wc.send("browserTab:stopPick");
          resolvePick(null);
        }, timeoutMs);
      });
    },
    destroy(): void {
      resolvePick(null);
      this.detach();
      session.removeListener("will-download", onWillDownload);
      if (!wc.isDestroyed()) wc.close();
    },
  };
}

type Page = ReturnType<typeof createPage>;

const EMPTY_PAGE_STATE: BrowserPageState = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 100,
  error: null,
};

/**
 * The Browser tab of one project window: any number of pages (each its own
 * WebContentsView, created lazily — most projects never touch the Browser tab,
 * so nothing spawns a renderer process until something actually does), of
 * which only the active one is attached to the window, and only while the
 * Browser tab is the section on screen.
 */
export function createBrowserTabView(win: BrowserWindow): BrowserTabHandle {
  const pages = new Map<string, Page>();
  let order: string[] = [];
  let activeId: string | null = null;
  let visible = false;
  let bounds: BrowserTabBounds | null = null;
  let counter = 0;
  /** Files this window's tabs reported as downloaded — the only paths showDownload will reveal. */
  const downloadedPaths = new Set<string>();

  const active = (): Page | undefined => (activeId ? pages.get(activeId) : undefined);

  const getState = (): BrowserTabState => ({
    ...(active()?.getState() ?? EMPTY_PAGE_STATE),
    tabs: order.map((id) => {
      const s = pages.get(id)!.getState();
      return { id, title: s.title, url: s.url, loading: s.loading };
    }),
    activeId,
  });
  const pushState = () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send("browserTab:state", getState());
  };

  /** Attach the active page (when the Browser tab is showing) and detach every other one. */
  const applyActive = () => {
    for (const [id, page] of pages) {
      if (id !== activeId || !visible || !page.hasContent()) page.detach();
    }
    const current = active();
    if (visible && current?.hasContent()) current.attach(bounds);
  };

  const activate = (id: string) => {
    if (!pages.has(id) || id === activeId) return;
    activeId = id;
    applyActive();
    pushState();
  };

  const createTab = (): string => {
    const id = `tab-${++counter}`;
    const page = createPage(win, {
      onChange: pushState,
      onOpenWindow: (url) => void handle.newTab(url),
      onFirstNavigation: applyActive,
      onDownload: (download) => {
        if (download.state === "completed" && download.path) downloadedPaths.add(download.path);
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("browserTab:download", download);
      },
      onShortcut: (action) => runShortcut(action),
    });
    pages.set(id, page);
    order.push(id);
    activate(id);
    return id;
  };
  const ensureActive = (): Page => {
    if (!active()) createTab();
    return active()!;
  };
  const requireActive = (): Page => {
    const page = active();
    if (!page) throw new Error("No page is loaded in the Browser tab — call browser_open first.");
    return page;
  };

  /** Moves the keyboard to the renderer's address bar (which focuses and selects itself on this event). */
  const focusAddress = () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.focus();
    win.webContents.send("browserTab:focusAddress");
  };
  const cycleTab = (step: 1 | -1) => {
    if (order.length < 2 || !activeId) return;
    const next = order[(order.indexOf(activeId) + step + order.length) % order.length]!;
    activate(next);
  };
  function runShortcut(action: BrowserShortcutAction): void {
    switch (action) {
      case "newTab":
        void handle.newTab().then(focusAddress);
        break;
      case "closeTab":
        if (activeId) handle.closeTab(activeId);
        break;
      case "focusAddress":
        focusAddress();
        break;
      case "reload":
        active()?.reload();
        break;
      case "hardReload":
        active()?.reloadHard();
        break;
      case "back":
        active()?.back();
        break;
      case "forward":
        active()?.forward();
        break;
      case "zoomIn":
        active()?.zoom("in");
        break;
      case "zoomOut":
        active()?.zoom("out");
        break;
      case "zoomReset":
        active()?.zoom("reset");
        break;
      case "nextTab":
        cycleTab(1);
        break;
      case "prevTab":
        cycleTab(-1);
        break;
      case "devTools":
        active()?.toggleDevTools();
        break;
    }
  }

  const handle: BrowserTabHandle = {
    navigate: async (url) => {
      const page = ensureActive();
      handle.show();
      await page.navigate(url);
    },
    go: async (input) => {
      const page = ensureActive();
      handle.show();
      await page.go(input);
    },
    back: () => active()?.back(),
    forward: () => active()?.forward(),
    reload: () => active()?.reload(),
    stop: () => active()?.stop(),
    getState,
    newTab: async (input) => {
      const id = createTab();
      handle.show();
      if (input?.trim()) await pages.get(id)!.go(input);
      return id;
    },
    closeTab: (id) => {
      const page = pages.get(id);
      if (!page) return;
      const index = order.indexOf(id);
      page.destroy();
      pages.delete(id);
      order = order.filter((t) => t !== id);
      if (activeId === id) activeId = order[index] ?? order[index - 1] ?? null;
      applyActive();
      pushState();
    },
    activateTab: activate,
    toggleDevTools: () => active()?.toggleDevTools(),
    zoom: (direction) => active()?.zoom(direction),
    showDownload: (path) => {
      if (downloadedPaths.has(path)) shell.showItemInFolder(path);
    },
    readPage: (maxChars) => requireActive().readPage(maxChars),
    screenshot: () => requireActive().screenshot(),
    click: (selector) => requireActive().click(selector),
    type: (selector, text, submit) => requireActive().type(selector, text, submit),
    setBounds: (next) => {
      bounds = next;
      active()?.setBounds(next);
    },
    show: () => {
      visible = true;
      applyActive();
    },
    hide: () => {
      visible = false;
      applyActive();
    },
    getUrl: () => active()?.getUrl() ?? "",
    startPick: (timeoutMs) => {
      const page = ensureActive();
      handle.show();
      return page.startPick(timeoutMs);
    },
    destroy: () => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.removeListener("before-input-event", onWindowInput);
      }
      for (const page of pages.values()) page.destroy();
      pages.clear();
      order = [];
      activeId = null;
    },
  };
  // Shortcuts while focus is in the app window itself (address bar, tab strip).
  // Only while the Browser section is showing, so Ctrl+T / Ctrl+W / Ctrl+R keep
  // their usual meaning everywhere else.
  const onWindowInput = (event: { preventDefault: () => void }, input: Input) => {
    if (!visible) return;
    const action = matchBrowserShortcut(input, process.platform === "darwin");
    if (!action) return;
    event.preventDefault();
    runShortcut(action);
  };
  win.webContents.on("before-input-event", onWindowInput);

  return handle;
}
