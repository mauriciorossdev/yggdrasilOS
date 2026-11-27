import { useEffect, useRef, useState, type DragEvent } from "react";
import { PluginFrame, type PluginFrameHandle } from "../plugins/PluginFrame.js";
import type { PluginRecord, WidgetInstance, WidgetSize } from "../types.js";
import { useI18n } from "../i18n/index.js";
import { Button, IconButton } from "../ui/index.js";
import { isRefreshDue, netDomainsOf } from "./dashboardLogic.js";
import { agoLabel, refreshLabel } from "./format.js";
import { SIZES } from "./WidgetConfigDialog.js";

const TICK_MS = 15_000;

type Props = {
  instance: WidgetInstance;
  /** Absent when the complemento was deleted, is broken, or is no longer a published widget. */
  plugin?: PluginRecord;
  version: number;
  visible: boolean;
  order: number;
  count: number;
  editing: boolean;
  onConfigure: () => void;
  onRemove: () => void;
  onMove: (to: number) => void;
  onResize: (size: WidgetSize) => void;
  onDrop: (draggedId: string) => void;
};

const DRAG_TYPE = "application/x-ygg-widget";

/** One instance. The host sets the pace: it asks the widget to refresh, and only while visible. */
export function WidgetCard({ instance, plugin, version, visible, order, count, editing, onConfigure, onRemove, onMove, onResize, onDrop }: Props) {
  const { t, language } = useI18n();
  const frame = useRef<PluginFrameHandle>(null);
  const lastAttempt = useRef(0);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const online = !!plugin && netDomainsOf(plugin).length > 0;
  // A domain an update added has to be allowed before the widget runs again.
  const ungranted = plugin ? netDomainsOf(plugin).filter((d) => !instance.grantedDomains.includes(d)) : [];
  // Changing any of these needs a fresh document.
  const frameKey = JSON.stringify([instance.config, instance.size, instance.grantedDomains, instance.refreshSeconds, version, language]);

  useEffect(() => {
    setProblem(null);
    lastAttempt.current = 0;
  }, [frameKey]);

  useEffect(() => {
    if (!visible || !online) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (isRefreshDue(instance.refreshSeconds, lastAttempt.current, time)) {
        lastAttempt.current = time;
        frame.current?.emit("refresh", {});
      }
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [visible, online, instance.refreshSeconds]);

  const refreshNow = async () => {
    await window.yggdrasil.dashboard.invalidate(instance.instanceId);
    setProblem(null);
    lastAttempt.current = Date.now();
    frame.current?.emit("refresh", {});
  };

  const dragProps = editing
    ? {
        draggable: true,
        onDragStart: (e: DragEvent) => e.dataTransfer.setData(DRAG_TYPE, instance.instanceId),
        onDragOver: (e: DragEvent) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          const id = e.dataTransfer.getData(DRAG_TYPE);
          if (id && id !== instance.instanceId) onDrop(id);
        },
      }
    : {};

  const title = instance.title || plugin?.manifest.name || instance.pluginKey;

  return (
    <section className={`dash-card dash-size-${instance.size}${problem ? " dash-card--error" : ""}`} style={{ order }} aria-label={title} {...dragProps}>
      <header className="dash-card-head">
        <strong className="dash-card-title">{title}</strong>
        {online && !editing && (
          <>
            <span className="muted dash-card-meta">
              {fetchedAt > 0 ? `${agoLabel(fetchedAt, now)} · ` : ""}
              {instance.refreshSeconds > 0 ? t("dashboard.card.every", { interval: refreshLabel(instance.refreshSeconds) }) : refreshLabel(0)}
            </span>
            <IconButton label={t("dashboard.card.refresh")} onClick={() => void refreshNow()}>
              ↻
            </IconButton>
          </>
        )}
        {!editing && plugin && (
          <IconButton label={t("dashboard.card.configure")} onClick={onConfigure}>
            ⋯
          </IconButton>
        )}
      </header>
      {editing && (
        <div className="dash-card-edit">
          <IconButton label={t("dashboard.edit.earlier")} disabled={order === 0} onClick={() => onMove(order - 1)}>
            ←
          </IconButton>
          <IconButton label={t("dashboard.edit.later")} disabled={order === count - 1} onClick={() => onMove(order + 1)}>
            →
          </IconButton>
          {SIZES.map((size) => (
            <Button key={size} size="sm" variant={instance.size === size ? "primary" : "secondary"} aria-pressed={instance.size === size} onClick={() => onResize(size)}>
              {size.toUpperCase()}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={onRemove}>
            {t("dashboard.config.remove")}
          </Button>
        </div>
      )}
      {problem && (
        <p className="dash-card-problem" role="alert">
          {problem}{" "}
          <button type="button" className="dash-link" onClick={onConfigure}>
            {t("dashboard.card.review")}
          </button>
        </p>
      )}
      <div className="dash-card-body">
        {!plugin ? (
          <div className="dash-card-note">
            <p className="muted">{t("dashboard.card.unavailable")}</p>
            <Button size="sm" onClick={onRemove}>
              {t("dashboard.config.remove")}
            </Button>
          </div>
        ) : ungranted.length > 0 ? (
          <div className="dash-card-note">
            <p>{t("dashboard.card.needsPermission", { domain: ungranted.join(", ") })}</p>
            <Button size="sm" onClick={onConfigure}>
              {t("dashboard.card.review")}
            </Button>
          </div>
        ) : (
          <PluginFrame
            key={frameKey}
            ref={frame}
            plugin={plugin}
            version={version}
            visible={visible}
            widget={{ instanceId: instance.instanceId, config: instance.config, size: instance.size, preview: false, language }}
            onWidgetFetch={(outcome) => {
              // A cached answer is as old as it is: the next refresh counts from when it was fetched.
              lastAttempt.current = outcome.fetchedAt ?? Date.now();
              if (outcome.fetchedAt) setFetchedAt(outcome.fetchedAt);
              setNow(Date.now());
              if (outcome.error) setProblem(t("dashboard.card.failed", { message: outcome.error }));
              else if (outcome.status === 401 || outcome.status === 403) setProblem(t("dashboard.card.rejected", { status: outcome.status }));
              else if (outcome.status && outcome.status >= 400) setProblem(t("dashboard.card.status", { status: outcome.status }));
              else setProblem(null);
            }}
            onError={(entry) => setProblem(t("dashboard.card.crashed", { message: entry.message }))}
          />
        )}
      </div>
    </section>
  );
}
