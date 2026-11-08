import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftIcon,
  CodeBracketSquareIcon,
  CpuChipIcon,
  CursorArrowRaysIcon,
  DevicePhoneMobileIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import {
  getBrowserTabOcclusion,
  onBrowserTabCoverChange,
  onBrowserTabOcclusionChange,
  onBrowserTabVisibleChange,
  setBrowserTabCovered,
} from "./browserTabBridge.js";
import { useI18n } from "../i18n/index.js";
import { clampDockWidth } from "./browserAgentState.js";
import { findViewportPreset, fitViewport, VIEWPORT_PRESETS, uncoveredWidth } from "./browserViewports.js";
import {
  dockPane,
  requestCreateBrowserAgent,
  setBrowserAgentSlot,
  setDockOpen,
  setDockWidth,
  toggleDockOpen,
  useBrowserAgent,
} from "./browserAgentStore.js";
import { requestFocusPane, useTerminalPanes } from "../terminal/terminalPanesStore.js";
import { getActiveTab } from "../ui/mainTabsStore.js";
import { notifyTerminalTabVisible } from "../terminal/terminalBridge.js";
import { terminalLaunchClis } from "../onboarding/harnessFilter.js";
import { useOnboarding } from "../onboarding/store.js";
import type { BrowserDownload, BrowserTabState, PickedElement } from "../types.js";

const VIEWPORT_KEY = "yggdrasil.browser.viewport";
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
function tabLabel(tab: { title: string; url: string }, newTabLabel: string): string {
  if (tab.title) return tab.title;
  try {
    return new URL(tab.url).host || newTabLabel;
  } catch {
    return newTabLabel;
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
type DockProps = { launchClis: Array<{ id: string; label: string; command: string }>; bodyRef: React.RefObject<HTMLDivElement | null> };

/**
 * Right-hand column of the Browser tab holding the Browser agent: a real
 * terminal pane (rendered here by TerminalContainer through a portal into the
 * slot below — see browserAgentStore.ts). A layout column, not an overlay: the
 * native page view would paint over anything floating above it.
 */
function AgentDock({ launchClis, bodyRef }: DockProps) {
  const { t } = useI18n();
  const agent = useBrowserAgent();
  const { panes } = useTerminalPanes();
  const free = panes.filter((p) => !p.docked);

  // Dragging the edge over the page would hand the mouse to the native view, so the page is swapped for a still image meanwhile.
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setBrowserTabCovered(true);
    const move = (m: PointerEvent) => {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDockWidth(clampDockWidth(rect.right - m.clientX, rect.width));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setBrowserTabCovered(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <aside className="browser-agent-dock" style={{ width: agent.width }} aria-label={t("browser.agent.title")}>
      <div className="browser-agent-resize" onPointerDown={startResize} role="separator" aria-orientation="vertical" />
      <div className="browser-agent-header">
        <span className="browser-agent-title">{t("browser.agent.title")}</span>
        {agent.dockedId && (
          <button
            type="button"
            className="icon-btn"
            title={t("browser.agent.moveToTerminal")}
            onClick={() => {
              const id = agent.dockedId;
              dockPane(null);
              setDockOpen(false);
              if (id) requestFocusPane(id);
            }}
          >
            <ArrowTopRightOnSquareIcon className="hero-icon" />
          </button>
        )}
        <button type="button" className="icon-btn" title={t("browser.agent.hide")} onClick={() => setDockOpen(false)}>
          <XMarkIcon className="hero-icon" />
        </button>
      </div>
      {agent.dockedId ? (
        <div className="browser-agent-slot" ref={setBrowserAgentSlot} />
      ) : (
        <div className="browser-agent-empty">
          <p className="muted">{t("browser.agent.emptyIntro")}</p>
          <div className="browser-agent-empty-list">
            {launchClis.map((cli) => (
              <button
                key={cli.id}
                type="button"
                className="new-chat"
                onClick={() => requestCreateBrowserAgent({ command: cli.command, label: cli.label })}
              >
                {t("browser.agent.start", { label: cli.label })}
              </button>
            ))}
          </div>
          {free.length > 0 && (
            <>
              <p className="muted">{t("browser.agent.orRunning")}</p>
              <div className="browser-agent-empty-list">
                {free.map((p) => (
                  <button key={p.id} type="button" className="session-item" onClick={() => dockPane(p.id)}>
                    {p.title}
                    {p.command && <span className="scope-tag">{p.command}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

export function BrowserTabView() {
  const { t } = useI18n();
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [viewportId, setViewportId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(VIEWPORT_KEY);
    } catch {
      return null;
    }
  });
  const [viewportBarOpen, setViewportBarOpen] = useState(() => findViewportPreset(viewportId) !== null);
  const viewportPreset = findViewportPreset(viewportId);
  const viewportPresetRef = useRef(viewportPreset);
  viewportPresetRef.current = viewportPreset;
  const chooseViewport = (id: string | null) => {
    setViewportId(id);
    try {
      if (id) localStorage.setItem(VIEWPORT_KEY, id);
      else localStorage.removeItem(VIEWPORT_KEY);
    } catch {
      // storage unavailable — the choice just won't persist
    }
  };
  const [addressInput, setAddressInput] = useState("");
  // Seeded from the tab store (not `false`): if this view remounts while the Browser tab is showing, the visibility bridge below only fires on the next tab switch.
  const [visible, setVisible] = useState(() => getActiveTab() === "browser");
  const [nav, setNav] = useState<BrowserTabState>(EMPTY_STATE);
  const editingRef = useRef(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const [download, setDownload] = useState<BrowserDownload | null>(null);
  const [localPorts, setLocalPorts] = useState<number[]>([]);
  // Still image standing in for the page while a sidebar flyout covers the area
  // (the native view would otherwise paint over it) — see browserTabBridge.ts.
  const [frozen, setFrozen] = useState<{ src: string; width: number | null } | null>(null);
  // Width the page is cut to under a floating side panel; a snapshot only holds that part.
  const cropWidthRef = useRef<number | null>(null);
  const visibleRef = useRef(getActiveTab() === "browser");
  const coverToken = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const agent = useBrowserAgent();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedElement | null>(null);

  useEffect(() => {
    return onBrowserTabVisibleChange((next) => {
      visibleRef.current = next;
      setVisible(next);
      // A docked agent pane was laid out while this tab was hidden (zero size): have it refit.
      if (next) notifyTerminalTabVisible();
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

  useEffect(
    () =>
      onBrowserTabCoverChange((covered) => {
        const token = ++coverToken.current;
        if (covered) {
          if (!visibleRef.current) return;
          // Read now: the panel may already have moved by the time the snapshot arrives.
          const width = cropWidthRef.current;
          void window.yggdrasil.browserTab.snapshot().then((shot) => {
            // Uncovered (or tab switched) while the snapshot was being taken: leave the view alone.
            if (token !== coverToken.current || !visibleRef.current) return;
            if (shot) setFrozen({ src: `data:${shot.mimeType};base64,${shot.base64}`, width });
            void window.yggdrasil.browserTab.hide();
          });
        } else {
          if (visibleRef.current) void window.yggdrasil.browserTab.show();
          setFrozen(null);
        }
      }),
    [],
  );

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

  // Comment mode: the page's own injected overlay does the clicking/listing
  // (a native view can't be drawn over from here); this only toggles it and
  // follows the page when it leaves the mode itself (Escape).
  const [commenting, setCommenting] = useState(false);
  useEffect(() => window.yggdrasil.browserTab.comments.onMode(setCommenting), []);
  useEffect(() => setCommenting(false), [nav.activeId]);
  const toggleComments = () => {
    const next = !commenting;
    setCommenting(next);
    void window.yggdrasil.browserTab.comments.setMode(next);
  };

  // Main needs the launchable CLIs for the in-page "New agent" popover.
  const { settings: onboardingSettings } = useOnboarding();
  const launchClis = terminalLaunchClis(onboardingSettings);
  const providersKey = launchClis.map((c) => `${c.id}:${c.command}`).join(",");
  useEffect(() => {
    void window.yggdrasil.browserTab.comments.setProviders(launchClis.map(({ id, label, command }) => ({ id, label, command })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- providersKey is the stable digest of launchClis
  }, [providersKey]);

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
      const preset = viewportPresetRef.current;
      const visibleWidth = uncoveredWidth(rect, window.innerWidth, getBrowserTabOcclusion());
      if (!preset) {
        const cropped = visibleWidth < rect.width;
        cropWidthRef.current = cropped ? Math.round(visibleWidth) : null;
        void window.yggdrasil.browserTab.setBounds({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(visibleWidth),
          height: Math.round(rect.height),
          crop: cropped ? { width: Math.round(rect.width), height: Math.round(rect.height) } : undefined,
        });
        return;
      }
      cropWidthRef.current = null;
      // Device preset: the page lays out at the preset's CSS size (device emulation
      // in main) and is scaled down to fit, centered in the area.
      const fit = fitViewport(preset, { width: visibleWidth, height: rect.height });
      void window.yggdrasil.browserTab.setBounds({
        x: Math.round(rect.x + (visibleWidth - fit.width) / 2),
        y: Math.round(rect.y + (rect.height - fit.height) / 2),
        width: fit.width,
        height: fit.height,
        emulate: { width: preset.width, height: preset.height, mobile: preset.mobile },
      });
    };

    reportBounds();
    const observer = new ResizeObserver(reportBounds);
    observer.observe(el);
    window.addEventListener("resize", reportBounds);
    window.addEventListener("focus", reportBounds);
    document.addEventListener("visibilitychange", reportBounds);
    // Safety net: the native view ignores CSS entirely, so one missed
    // ResizeObserver/resize event (macOS fullscreen transitions, moving between
    // displays, a remount) would leave it at stale bounds — a page cropped inside
    // a larger area. Re-sending the rect is a tiny IPC, only while this tab is visible.
    const timer = setInterval(reportBounds, 500);
    const offOcclusion = onBrowserTabOcclusionChange(reportBounds);
    return () => {
      offOcclusion();
      observer.disconnect();
      window.removeEventListener("resize", reportBounds);
      window.removeEventListener("focus", reportBounds);
      document.removeEventListener("visibilitychange", reportBounds);
      clearInterval(timer);
    };
  }, [visible, viewportId]);

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
              title={tab.url || tabLabel(tab, t("browser.newTab"))}
              onClick={() => {
                setPicked(null);
                editingRef.current = false;
                void window.yggdrasil.browserTab.activateTab(tab.id);
              }}
            >
              {tab.loading && <span className="browser-tab-item-spinner" aria-hidden="true" />}
              <span className="browser-tab-item-text">{tabLabel(tab, t("browser.newTab"))}</span>
            </button>
            <button
              type="button"
              className="browser-tab-item-close"
              title={t("browser.tab.close")}
              onClick={() => void window.yggdrasil.browserTab.closeTab(tab.id)}
            >
              <XMarkIcon className="hero-icon" />
            </button>
          </div>
        ))}
        <button type="button" className="browser-tab-new" title={t("browser.newTab")} onClick={openNewTab}>
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
          title={t("browser.back")}
        >
          <ArrowLeftIcon className="hero-icon" />
        </button>
        <button
          type="button"
          className="browser-tab-nav-btn"
          disabled={!nav.canGoForward}
          onClick={() => void window.yggdrasil.browserTab.forward()}
          title={t("browser.forward")}
        >
          <ArrowRightIcon className="hero-icon" />
        </button>
        <button
          type="button"
          className="browser-tab-nav-btn"
          disabled={!nav.url && !nav.loading}
          onClick={() => void (nav.loading ? window.yggdrasil.browserTab.stop() : window.yggdrasil.browserTab.reload())}
          title={nav.loading ? t("browser.stopLoading") : t("browser.reload")}
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
          placeholder={t("browser.addressPlaceholder")}
          title={nav.title || undefined}
          spellCheck={false}
        />
        {nav.zoom !== 100 && (
          <button
            type="button"
            className="browser-tab-zoom"
            title={t("browser.zoomReset")}
            onClick={() => void window.yggdrasil.browserTab.zoom("reset")}
          >
            {nav.zoom}%
          </button>
        )}
        <button type="submit">{t("browser.go")}</button>
        <button
          type="button"
          className={picking ? "browser-tab-pick-btn active" : "browser-tab-pick-btn"}
          disabled={!nav.url}
          onClick={startPick}
          title={t("browser.pick.title")}
        >
          <CursorArrowRaysIcon className="hero-icon" />
          {picking ? t("browser.pick.clickElement") : t("browser.pick.button")}
        </button>
        <button
          type="button"
          className={commenting ? "browser-tab-pick-btn active" : "browser-tab-pick-btn"}
          disabled={!nav.url}
          onClick={toggleComments}
          title={t("browser.comment.title")}
          aria-pressed={commenting}
        >
          <ChatBubbleLeftIcon className="hero-icon" />
          {commenting ? t("browser.pick.clickElement") : t("browser.comment.button")}
        </button>
        <button
          type="button"
          className={viewportBarOpen || viewportPreset ? "browser-tab-pick-btn active" : "browser-tab-pick-btn"}
          onClick={() => setViewportBarOpen((open) => !open)}
          title={t("browser.viewport.title")}
          aria-pressed={viewportBarOpen}
        >
          <DevicePhoneMobileIcon className="hero-icon" />
          {viewportPreset ? `${viewportPreset.width}×${viewportPreset.height}` : t("browser.viewport.button")}
        </button>
        <button
          type="button"
          className={agent.open ? "browser-tab-pick-btn active" : "browser-tab-pick-btn"}
          onClick={toggleDockOpen}
          title={t("browser.agent.buttonTitle")}
          aria-pressed={agent.open}
        >
          <CpuChipIcon className="hero-icon" />
          {t("browser.agent.button")}
        </button>
        <button
          type="button"
          className="browser-tab-nav-btn"
          disabled={!nav.url}
          onClick={() => void window.yggdrasil.browserTab.toggleDevTools()}
          title={t("browser.devtools")}
        >
          <CodeBracketSquareIcon className="hero-icon" />
        </button>
      </form>
      <div className={`browser-tab-progress${nav.loading ? " loading" : ""}`} aria-hidden="true" />
      {nav.error && (
        // Layout sibling for the same reason as .browser-tab-picked below.
        <div className="browser-tab-error" role="alert">
          <span>{t("browser.loadError", { error: nav.error })}</span>
          <button type="button" className="browser-tab-picked-close" onClick={() => setNav((n) => ({ ...n, error: null }))} title={t("browser.dismiss")}>
            <XMarkIcon className="hero-icon" />
          </button>
        </div>
      )}
      {download && (
        // Layout sibling for the same reason as .browser-tab-picked below.
        <div className="browser-tab-download" role="status">
          <span className="browser-tab-download-text">
            {download.state === "completed"
              ? t("browser.download.completed", { name: download.name })
              : download.state === "cancelled"
                ? t("browser.download.cancelled", { name: download.name })
                : t("browser.download.failed", { name: download.name })}
          </span>
          {download.state === "completed" && download.path && (
            <button
              type="button"
              className="browser-tab-download-btn"
              onClick={() => void window.yggdrasil.browserTab.showDownload(download.path)}
            >
              {t("browser.download.show")}
            </button>
          )}
          <button type="button" className="browser-tab-picked-close" onClick={() => setDownload(null)} title={t("browser.dismiss")}>
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
            <button type="button" className="browser-tab-picked-close" onClick={() => setPicked(null)} title={t("browser.dismiss")}>
              <XMarkIcon className="hero-icon" />
            </button>
          </div>
          {picked.text && <p className="browser-tab-picked-text">{picked.text}</p>}
          <code className="browser-tab-picked-html">{picked.outerHtml}</code>
        </div>
      )}
      {viewportBarOpen && (
        // Layout row (not a dropdown): a menu drawn over the page area would sit
        // under the native WebContentsView and never be visible.
        <div className="browser-tab-viewport-bar" role="group" aria-label={t("browser.viewport.group")}>
          <button
            type="button"
            className={!viewportPreset ? "browser-tab-local-chip active" : "browser-tab-local-chip"}
            onClick={() => chooseViewport(null)}
          >
            {t("browser.viewport.responsive")}
          </button>
          {VIEWPORT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={preset.id === viewportId ? "browser-tab-local-chip active" : "browser-tab-local-chip"}
              onClick={() => chooseViewport(preset.id)}
              title={`${preset.width}×${preset.height}`}
            >
              {preset.labelKey ? t(preset.labelKey) : preset.label} <span className="muted">{preset.width}×{preset.height}</span>
            </button>
          ))}
        </div>
      )}
      <div className="browser-tab-body" ref={bodyRef}>
      <div className="browser-tab-viewport" ref={placeholderRef}>
        {frozen && (
          <img
            className="browser-tab-frozen"
            src={frozen.src}
            style={frozen.width === null ? undefined : { width: frozen.width }}
            alt=""
            draggable={false}
          />
        )}
        {isEmpty && (
          <div className="browser-tab-empty-state">
            <p className="muted browser-tab-empty">{t("browser.empty")}</p>
            {localPorts.length > 0 && (
              <div className="browser-tab-local">
                <span className="muted">{t("browser.runningLocally")}</span>
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
      {agent.open && <AgentDock launchClis={launchClis} bodyRef={bodyRef} />}
      </div>
    </div>
  );
}
