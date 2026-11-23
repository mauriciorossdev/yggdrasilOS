import { useEffect } from "react";
import { useI18n } from "../i18n/index.js";
import { dismissDroppedQueue, useDroppedQueue } from "./queueStore.js";

const SHOW_MS = 10_000;

/** "‹pane› closed with 2 messages queued": those messages were never sent. Hides by itself. */
export function QueueDroppedNotice() {
  const { t } = useI18n();
  const dropped = useDroppedQueue();
  useEffect(() => {
    if (!dropped) return;
    const timer = setTimeout(dismissDroppedQueue, SHOW_MS);
    return () => clearTimeout(timer);
  }, [dropped]);
  if (!dropped) return null;
  return (
    <div className="queue-dropped" role="status">
      <span>{dropped.count === 1 ? t("queue.droppedOne", { title: dropped.title }) : t("queue.dropped", { title: dropped.title, count: dropped.count })}</span>
      <button type="button" className="queue-act" onClick={dismissDroppedQueue}>
        {t("term.pane.dismiss")}
      </button>
    </div>
  );
}
