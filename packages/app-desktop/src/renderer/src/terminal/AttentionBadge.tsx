import { CheckIcon } from "@heroicons/react/20/solid";
import { Chip } from "../ui/index.js";
import { useI18n } from "../i18n/index.js";
import { agoParts, usePaneAttention } from "./attentionStore.js";

/**
 * A pane header's attention state: waiting (amber, the agent's question in the
 * tooltip), done (green, how long ago) or working (a quiet blue spinner).
 * Nothing when the pane has nothing pending. See attentionStore.ts.
 */
export function AttentionBadge({ paneId }: { paneId: string }) {
  const { t } = useI18n();
  const state = usePaneAttention(paneId);
  if (!state) return null;

  if (state.status === "waiting") {
    return (
      <Chip tone="working" dot className="attention-badge" title={state.message ?? t("attn.waitingFallback")}>
        {t("attn.waiting")}
      </Chip>
    );
  }
  if (state.status === "done") {
    const ago = agoParts(state.since, Date.now());
    return (
      <Chip tone="ready" className="attention-badge">
        <CheckIcon className="hero-icon attention-badge-check" aria-hidden />
        {t("attn.doneAgo", { ago: t(ago.key, { n: ago.n }) })}
      </Chip>
    );
  }
  return (
    <span className="attention-badge attention-badge--working">
      <span className="attention-spinner" aria-hidden />
      {t("attn.working")}
    </span>
  );
}
