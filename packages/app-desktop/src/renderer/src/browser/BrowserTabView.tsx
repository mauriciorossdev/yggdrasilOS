import { useEffect, useRef, useState } from "react";
import { CursorArrowRaysIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { onBrowserTabVisibleChange } from "./browserTabBridge.js";
import type { PickedElement } from "../types.js";

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
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedElement | null>(null);

  useEffect(() => {
    return onBrowserTabVisibleChange((next) => {
      setVisible(next);
      void (next ? window.yggdrasil.browserTab.show() : window.yggdrasil.browserTab.hide());
    });
  }, []);

  // Seeds the address bar from whatever's already loaded — e.g. a
  // browser_open call (an agent) that navigated before this tab was ever
  // switched to.
  useEffect(() => {
    void window.yggdrasil.browserTab.getUrl().then((url) => {
      if (url) setAddressInput(url);
    });
  }, []);

  // An agent's browser_open switches MainTabs here itself (see MainTabs.tsx)
  // — this just keeps the address bar in sync with wherever that landed.
  useEffect(() => {
    return window.yggdrasil.browserTab.onRequestShow(() => {
      void window.yggdrasil.browserTab.getUrl().then((url) => {
        if (url) setAddressInput(url);
      });
    });
  }, []);

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

  const navigate = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setPicked(null);
    void window.yggdrasil.browserTab.navigate(trimmed);
  };

  const startPick = () => {
    if (picking || !addressInput) return;
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
      <form
        className="browser-tab-bar"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(addressInput);
        }}
      >
        <input
          className="browser-tab-address"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          placeholder="Enter a URL…"
          spellCheck={false}
        />
        <button type="submit">Go</button>
        <button
          type="button"
          className={picking ? "browser-tab-pick-btn active" : "browser-tab-pick-btn"}
          disabled={!addressInput}
          onClick={startPick}
          title="Click an element on the page to inspect it"
        >
          <CursorArrowRaysIcon className="hero-icon" />
          {picking ? "Click an element…" : "Pick element"}
        </button>
      </form>
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
        {!addressInput && <p className="muted browser-tab-empty">No page loaded — enter a URL above.</p>}
      </div>
    </div>
  );
}
