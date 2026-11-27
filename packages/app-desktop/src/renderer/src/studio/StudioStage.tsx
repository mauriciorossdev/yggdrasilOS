import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PluginView, WidgetSize } from "../types.js";
import { useI18n } from "../i18n/index.js";

const PHONE_W = 390;
const PHONE_H = 844;
/** Bezel padding on each side of the phone screen (.studio-frame-shell in styles.css). */
const BEZEL = 16;

/**
 * Frames whatever it's given as the app would host it: a full tab, a 360px
 * side panel next to a ghost of the app's content, or a 390×844 phone scaled
 * down to fit. One fixed element chain for every view — only classes and
 * styles change — so switching views never remounts `children` (for a
 * plugin iframe, a remount would re-run its scripts and duplicate its
 * console). Used by the live preview and by StudioNew's template samples.
 */
export function StudioStage({ view, widgetSize = "m", children }: { view: PluginView; widgetSize?: WidgetSize; children: ReactNode }) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const [phoneScale, setPhoneScale] = useState(1);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || view !== "mobile") return;
    const fit = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      setPhoneScale(Math.min(1, (h - 24) / (PHONE_H + 2 * BEZEL), (w - 24) / (PHONE_W + 2 * BEZEL)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [view]);

  const outerW = PHONE_W + 2 * BEZEL;
  const outerH = PHONE_H + 2 * BEZEL;
  const phone = view === "mobile";

  return (
    <div className={`studio-preview-stage studio-preview-stage-${view}`}>
      <div className="studio-preview-app-ghost" aria-hidden="true">
        <span />
        <span />
        <span />
        <small>{t("studio.preview.appContent")}</small>
      </div>
      <div className="studio-frame-host" ref={hostRef}>
        <div
          className="studio-frame-scaled"
          style={phone ? { width: outerW * phoneScale, height: outerH * phoneScale } : undefined}
        >
          <div
            className="studio-frame-shell"
            style={phone ? { width: outerW, height: outerH, transform: `scale(${phoneScale})` } : undefined}
          >
            <div className={`studio-preview-frame${view === "widget" ? ` dash-preview-box dash-size-${widgetSize}` : ""}`}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
