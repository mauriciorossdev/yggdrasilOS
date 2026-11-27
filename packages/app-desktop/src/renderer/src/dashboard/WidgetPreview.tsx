import { useEffect, useRef, useState } from "react";
import { PluginFrame } from "../plugins/PluginFrame.js";
import type { PluginConsoleEntry, PluginErrorEntry } from "../plugins/pluginTypes.js";
import type { PluginRecord, WidgetDraft } from "../types.js";
import { useI18n } from "../i18n/index.js";

const DEBOUNCE_MS = 500;

type Props = {
  plugin: PluginRecord;
  version: number;
  draft: WidgetDraft;
  onConsole?: (entry: Omit<PluginConsoleEntry, "kind">) => void;
  onError?: (entry: Omit<PluginErrorEntry, "kind">) => void;
  onReady?: () => void;
};

/**
 * A live widget over unsaved settings. The draft reaches main first, then the
 * frame (re)mounts with it; fetches go through the same per-instance cache.
 */
export function WidgetPreview({ plugin, version, draft, onConsole, onError, onReady }: Props) {
  const { t, language } = useI18n();
  const id = draft.instance.instanceId;
  const signature = JSON.stringify(draft);
  const [applied, setApplied] = useState<{ signature: string; draft: WidgetDraft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        first.current = false;
        window.yggdrasil.dashboard
          .setDraft(id, draft)
          .then(() => {
            if (cancelled) return;
            setError(null);
            setApplied({ signature, draft });
          })
          .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
      },
      first.current ? 0 : DEBOUNCE_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `signature` is the draft's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, signature]);

  useEffect(
    () => () => {
      void window.yggdrasil.dashboard.dropDraft(id);
    },
    [id],
  );

  if (error) return <p className="error">{error}</p>;
  if (!applied) return <p className="muted">{t("dashboard.preview.loading")}</p>;
  const { instance } = applied.draft;
  return (
    <PluginFrame
      key={`${applied.signature}:${version}:${language}`}
      plugin={plugin}
      version={version}
      visible
      widget={{ instanceId: instance.instanceId, config: instance.config, size: instance.size, preview: true, language }}
      onConsole={onConsole}
      onError={onError}
      onReady={onReady}
    />
  );
}
