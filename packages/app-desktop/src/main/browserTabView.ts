import { join } from "node:path";
import { WebContentsView, type BrowserWindow } from "electron";

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

export type BrowserTabHandle = {
  /** Navigates, attaching the view first if it was hidden — matches an address bar's "type a URL, hit Go" always making the page visible. */
  navigate: (url: string) => Promise<void>;
  /** Renderer-driven — BrowserTabView.tsx's placeholder div reports its own real screen rect via ResizeObserver, since a WebContentsView is a native layer composited by Electron, not a DOM node any CSS here can size. */
  setBounds: (bounds: BrowserTabBounds) => void;
  show: () => void;
  hide: () => void;
  getUrl: () => string;
  /** Arms the loaded page's own hover-highlight + click-to-select overlay (browserTabPickerPreload.ts). Resolves with the picked element, or null if the user hits Escape / never picks anything within `timeoutMs`. */
  startPick: (timeoutMs?: number) => Promise<PickedElement | null>;
  destroy: () => void;
};

// Schemes the picker/address-bar (and browser_open, agent-callable) may
// navigate to. Rejects `file://`/`javascript:`/`data:` etc. — this view
// loads arbitrary agent- or user-supplied URLs into a real, unsandboxed-
// from-the-page's-perspective web page; letting it navigate to a local
// file URL would hand a malicious/compromised page read access to the
// filesystem path space, and javascript:/data: are classic XSS-adjacent
// injection vectors with no legitimate "browse to a website" use case here.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("browser: url is required");
  // A bare "example.com" (no scheme) is the common case from an address
  // bar or an agent — default to https, same as every modern browser's own
  // omnibox does for a schemeless input that looks like a host.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`browser: unsupported URL scheme "${parsed.protocol}" — only http/https are allowed`);
  }
  return parsed.toString();
}

/**
 * One WebContentsView per project window, created lazily on first
 * navigate/show — most projects never touch the Browser tab, so nothing
 * spawns a renderer process for it until something actually does.
 * `sandbox`/`contextIsolation` stay on (Electron's secure defaults) since,
 * unlike the app's own window, this one deliberately loads arbitrary
 * remote content the app doesn't control.
 */
export function createBrowserTabView(win: BrowserWindow): BrowserTabHandle {
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
  // Real-page links (target=_blank, window.open) shouldn't spawn more
  // Electron windows/views — same "open in the OS browser instead" posture
  // createProjectBrowserWindow already takes for markdown-rendered links.
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

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
  view.webContents.ipc.on("browserTab:elementPicked", (_event, data) => resolvePick(data as PickedElement));
  view.webContents.ipc.on("browserTab:pickCancelled", () => resolvePick(null));

  let attached = false;
  const show = () => {
    // Re-focus even if already attached — this is also called every time
    // the renderer switches back to the Browser tab (BrowserTabView.tsx's
    // visibility effect), and mouse wheel/trackpad scroll into a
    // WebContentsView is a known no-op in Electron until its webContents
    // actually has focus (attaching the view alone isn't enough) — without
    // this, the page renders and clicks work, but scrolling silently does
    // nothing.
    if (!attached) {
      win.contentView.addChildView(view);
      attached = true;
    }
    view.webContents.focus();
  };
  const hide = () => {
    resolvePick(null);
    if (!attached) return;
    win.contentView.removeChildView(view);
    attached = false;
  };

  return {
    navigate: async (url) => {
      // The page a pick was armed on is about to be gone either way.
      resolvePick(null);
      show();
      await view.webContents.loadURL(normalizeBrowserUrl(url));
      // A fresh page load can drop focus back to the host window — restore
      // it so scroll works immediately without an extra click first.
      view.webContents.focus();
    },
    setBounds: (bounds) => view.setBounds(bounds),
    show,
    hide,
    getUrl: () => view.webContents.getURL(),
    startPick: (timeoutMs = 120_000) => {
      if (pickResolve) resolvePick(null); // one active pick at a time
      show();
      view.webContents.send("browserTab:startPick");
      return new Promise<PickedElement | null>((resolve) => {
        pickResolve = resolve;
        pickTimer = setTimeout(() => {
          view.webContents.send("browserTab:stopPick");
          resolvePick(null);
        }, timeoutMs);
      });
    },
    destroy: () => {
      resolvePick(null);
      hide();
      if (!view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}
