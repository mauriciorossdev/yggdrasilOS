import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  CodeBracketSquareIcon,
  CursorArrowRaysIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { onBrowserTabVisibleChange } from "./browserTabBridge.js";
import type { BrowserDownload, BrowserTabState, PickedElement } from "../types.js";

const SESSION_KEY = `ygg.browser.session.${window.yggdrasil.projectId}`;
const MAX_RESTORED_TABS = 8;

type Session = { urls: string[]; active: number };

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    const urls = Array.isArray(parsed.urls) ? parsed.urls.filter((u): u is string => typeof u === "string") : [];
    return { urls: urls.slice(0, MAX_RESTORED_TABS), active: typeof parsed.active === "number" ? parsed.active : 0 };
  } catch {
    return null;
  }
}

function writeSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // storage unavailable — nothing to remember
  }
}

/** What a tab shows in the strip: its title, else its host, else a placeholder. */
function tabLabel(tab: { title: string; url: string }): string {
  if (tab.title) return tab.title;
  try {
    return new URL(tab.url).host || "New tab";
  } catch {
    return "New tab";
  }
}

const EMPTY_STATE: BrowserTabState = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 100,
  error: null,
  tabs: [],
  activeId: null,
};

/**
 * MainTabs' "Browser" tab. Renders no actual page content itself — the real
 * page lives in a WebContentsView main/browserTabView.ts composites as a
 * native layer over the window, entirely outside React's DOM. This
 * component is just the chrome around that hole: an address bar, and a
 * placeholder div whose on-screen rect (ResizeObserver + window resize) is
 * continuously reported to main so it can position the real view exactly
 * behind it. See browserTabBridge.ts for why visibility can't just be a
 * CSS display:none like every other MainTabs panel.
 */
export function BrowserTabView() {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [addressInput, setAddressInput] = useState("");
  const [visible, setVisible] = useState(false);
  const [nav, setNav] = useState<BrowserTabState>(EMPTY_STATE);
  const editingRef = useRef(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const [download, setDownload] = useState<BrowserDownload | null>(null);
  const [localPorts, setLocalPorts] = useState<number[]>([]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedElement | null>(null);

  useEffect(() => {
    return onBrowserTabVisibleChange((next) => {
      setVisible(next);
      void (next ? window.yggdrasil.browserTab.show() : window.yggdrasil.browserTab.hide());
      // First time the tab is shown with nothing open: reopen the tabs the
      // user left off with. Done lazily here (not on mount) so a project that
      // never opens this tab never spawns a page's renderer process.
      if (next && !restoredRef.current) {
        void restoreSession().finally(() => {
          restoredRef.current = true;
        });
      }
    });
  }, []);

  // Mirrors the real page's state (url/title/loading/history/error). Seeds
  // from whatever is already loaded — e.g. a browser_open call (an agent)
  // that navigated before this tab was ever switched to — then follows pushes.
  useEffect(() => {
    void window.yggdrasil.browserTab.getState().then((state) => {
      if (state) setNav(state);
    });
    return window.yggdrasil.browserTab.onState(setNav);
  }, []);

  // Ctrl+L / Ctrl+T (handled in main, see browserShortcuts.ts): focus the address bar.
  useEffect(() => {
    return window.yggdrasil.browserTab.onFocusAddress(() => {
      editingRef.current = true;
      setPicked(null);
      addressRef.current?.focus();
      addressRef.current?.select();
    });
  }, []);

  useEffect(() => window.yggdrasil.browserTab.onDownload(setDownload), []);

  // While there's nothing to show, offer whatever dev servers are listening
  // locally. Polled only while this empty state is actually on screen.
  const isEmpty = !nav.url && !nav.loading;
  useEffect(() => {
    if (!visible || !isEmpty) return;
    let cancelled = false;
    const scan = () =>
      void window.yggdrasil.browserTab.scanPorts().then((ports) => {
        if (!cancelled) setLocalPorts((prev) => (prev.join() === ports.join() ? prev : ports));
      });
    scan();
    const timer = setInterval(scan, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible, isEmpty]);

  // Keep the address bar on the page's real URL (redirects, link clicks),
  // except while the user is typing in it. Also re-runs on a tab switch, so
  // the bar shows the newly active tab's URL even if it equals the old one's.
  useEffect(() => {
    if (!editingRef.current) setAddressInput(nav.url);
  }, [nav.url, nav.activeId]);

  // Remember the open tabs (only real http(s) pages — not chrome-error:// and
  // friends, which shouldn't become what we reopen on). Held back until the
  // first-show restore has had its chance, or the still-empty initial state
  // would overwrite the saved session before it was read.
  useEffect(() => {
    if (!restoredRef.current) return;
    const open = nav.tabs.filter((t) => /^https?:/i.test(t.url));
    const activeIndex = open.findIndex((t) => t.id === nav.activeId);
    writeSession({ urls: open.map((t) => t.url), active: Math.max(0, activeIndex) });
  }, [nav.tabs, nav.activeId]);

  // An agent's browser_open switches MainTabs here itself (see MainTabs.tsx)
  // — the state push above already follows wherever that landed.

  useEffect(() => {
    if (!visible) return;
    const el = placeholderRef.current;
    if (!el) return;

    const reportBounds = () => {
      const rect = el.getBoundingClientRect();
      void window.yggdrasil.browserTab.setBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    reportBounds();
    const observer = new ResizeObserver(reportBounds);
    observer.observe(el);
    window.addEventListener("resize", reportBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reportBounds);
    };
  }, [visible]);

  const restoreSession = async () => {
    const current = await window.yggdrasil.browserTab.getState();
    if (current && current.tabs.length > 0) return; // an agent already opened something
    const session = readSession();
    if (!session || session.urls.length === 0) return;
    // Tabs are created in call order (main creates each one synchronously
    // before its first await); the loads themselves then run in parallel.
    const ids = await Promise.all(session.urls.map((url) => window.yggdrasil.browserTab.newTab(url)));
    const target = ids[Math.min(session.active, ids.length - 1)];
    if (target) void window.yggdrasil.browserTab.activateTab(target);
  };

  const openNewTab = () => {
    setPicked(null);
    editingRef.current = true;
    void window.yggdrasil.browserTab.newTab().then(() => addressRef.current?.focus());
  };

  const navigate = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setPicked(null);
    editingRef.current = false;
    void window.yggdrasil.browserTab.go(trimmed);
  };

  const startPick = () => {
    if (picking || !nav.url) return;
    setPicked(null);
    setPicking(true);
    void window.yggdrasil.browserTab
      .startPick()
      .then(setPicked)
      .catch((err: unknown) => console.error("browserTab.startPick failed", err))
      .finally(() => setPicking(false));
  };

  return (
    <div className="browser-tab">
      <div className="browser-tab-strip" role="tablist">
        {nav.tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === nav.activeId}
            className={`browser-tab-item${tab.id === nav.activeId ? " active" : ""}`}
          >
            <button
              type="button"
              className="browser-tab-item-label"
              title={tab.url || tabLabel(tab)}
              onClick={() => {
                setPicked(null);
                editingRef.current = false;
                void window.yggdrasil.browserTab.activateTab(tab.id);
              }}
            >
              {tab.loading && <span className="browser-tab-item-spinner" aria-hidden="true" />}
              <span className="browser-tab-item-text">{tabLabel(tab)}</span>
            </button>
            <button
              type="button"
              className="browser-tab-item-close"
              title="Close tab"
              onClick={() => void window.yggdrasil.browserTab.closeTab(tab.id)}
            >
              <XMarkIcon className="hero-icon" />
            </button>
          </div>
        ))}
        <button type="button" className="browser-tab-new" title="New tab" onClick={openNewTab}>
          <PlusIcon className="hero-icon" />
        </button>
      </div>
      <form
        className="browser-tab-bar"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(addressInput);
        }}
      >
        <button
          type="button"
          className="browser-tab-nav-btn"
          disabled={!nav.canGoBack}
          onClick={() => void window.yggdrasil.browserTab.back()}
          title="Back"
        >
          <ArrowLeftIcon className="hero-icon" />
        </button>
        <button
          type="button"
          className="browser-tab-nav-btn"
          disabled={!nav.canGoForward}
          onClick={() => void window.yggdrasil.browserTab.forward()}
          title="Forward"
        >
          <ArrowRightIcon className="hero-icon" />
        </button>
        <button
          type="button"
          className="browser-tab-nav-btn"
          disabled={!nav.url && !nav.loading}
          onClick={() => void (nav.loading ? window.yggdrasil.browserTab.stop() : window.yggdrasil.browserTab.reload())}
          title={nav.loading ? "Stop loading" : "Reload"}
        >
          {nav.loading ? <XMarkIcon className="hero-icon" /> : <ArrowPathIcon className="hero-icon" />}
        </button>
        <input
          ref={addressRef}
          className="browser-tab-address"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onFocus={(e) => {
            editingRef.current = true;
            e.currentTarget.select();
          }}
          // No reset to nav.url here: clicking "Go" blurs the input first, and
          // resetting would swap the typed text out before the submit reads it.
          onBlur={() => {
            editingRef.current = false;
          }}
          placeholder="Search or enter a URL…"
          title={nav.title || undefined}
          spellCheck={false}
        />
        {nav.zoom !== 100 && (
          <button
            type="button"
            className="browser-tab-zoom"
            title="Reset zoom (Ctrl+0)"
            onClick={() => void window.yggdrasil.browserTab.zoom("reset")}
          >
            {nav.zoom}%
          </button>
        )}
        <button type="submit">Go</button>
        <button
          type="button"
          className={picking ? "browser-tab-pick-btn active" : "browser-tab-pick-btn"}
          disabled={!nav.url}
          onClick={startPick}
          title="Click an element on the page to inspect it"
        >
          <CursorArrowRaysIcon className="hero-icon" />
          {picking ? "Click an element…" : "Pick element"}
        </button>
        <button
          type="button"
          className="browser-tab-nav-btn"
          disabled={!nav.url}
          onClick={() => void window.yggdrasil.browserTab.toggleDevTools()}
          title="Developer tools (F12)"
        >
          <CodeBracketSquareIcon className="hero-icon" />
        </button>
      </form>
      <div className={`browser-tab-progress${nav.loading ? " loading" : ""}`} aria-hidden="true" />
      {nav.error && (
        // Layout sibling for the same reason as .browser-tab-picked below.
        <div className="browser-tab-error" role="alert">
          <span>Couldn't load the page: {nav.error}</span>
          <button type="button" className="browser-tab-picked-close" onClick={() => setNav((n) => ({ ...n, error: null }))} title="Dismiss">
            <XMarkIcon className="hero-icon" />
          </button>
        </div>
      )}
      {download && (
        // Layout sibling for the same reason as .browser-tab-picked below.
        <div className="browser-tab-download" role="status">
          <span className="browser-tab-download-text">
            {download.state === "completed"
              ? `Downloaded ${download.name}`
              : download.state === "cancelled"
                ? `Download cancelled: ${download.name}`
                : `Download failed: ${download.name}`}
          </span>
          {download.state === "completed" && download.path && (
            <button
              type="button"
              className="browser-tab-download-btn"
              onClick={() => void window.yggdrasil.browserTab.showDownload(download.path)}
            >
              Show in folder
            </button>
          )}
          <button type="button" className="browser-tab-picked-close" onClick={() => setDownload(null)} title="Dismiss">
            <XMarkIcon className="hero-icon" />
          </button>
        </div>
      )}
      {picked && (
        // A normal flex row here, not a floating overlay — the WebContentsView
        // behind .browser-tab-viewport is a native layer Electron always
        // composites ON TOP of this window's own DOM, so any CSS-positioned
        // overlay drawn *within the viewport's screen rect* (position:absolute,
        // z-index, whatever) would render underneath it, invisible. Sitting
        // here as a real layout sibling — above the viewport, shrinking its
        // reported bounds via the ResizeObserver in the effect above — is the
        // only way this is guaranteed visible regardless of what's loaded.
        <div className="browser-tab-picked">
          <div className="browser-tab-picked-header">
            <strong>{picked.selector}</strong>
            <button type="button" className="browser-tab-picked-close" onClick={() => setPicked(null)} title="Dismiss">
              <XMarkIcon className="hero-icon" />
            </button>
          </div>
          {picked.text && <p className="browser-tab-picked-text">{picked.text}</p>}
          <code className="browser-tab-picked-html">{picked.outerHtml}</code>
        </div>
      )}
      <div className="browser-tab-viewport" ref={placeholderRef}>
        {isEmpty && (
          <div className="browser-tab-empty-state">
            <p className="muted browser-tab-empty">No page loaded — search or enter a URL above.</p>
            {localPorts.length > 0 && (
              <div className="browser-tab-local">
                <span className="muted">Running locally</span>
                <div className="browser-tab-local-list">
                  {localPorts.map((port) => (
                    <button
                      key={port}
                      type="button"
                      className="browser-tab-local-chip"
                      onClick={() => navigate(`localhost:${port}`)}
                    >
                      localhost:{port}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
