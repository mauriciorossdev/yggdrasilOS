import { useEffect, useMemo, useRef } from "react";
import { PluginFrame, type PluginFrameHandle } from "./PluginFrame.js";
import type { PluginRecord } from "../types.js";

type Props = { plugins: PluginRecord[] };

/**
 * Keeps one hidden, always-live iframe per PUBLISHED complemento that
 * declares at least one tool — so a `claude`/`agy` terminal session can call
 * `ygg.tools.register`-ed handlers via the `plugins` MCP tool even when the
 * complemento isn't open in any tab/panel (headless execution). Mounted
 * once per project window (see ChatView.tsx), sibling to MainTabs, fed the
 * same `usePlugins()` list ChatView already holds — not tied to any single
 * tab, so it survives switching away from Estudio/wherever.
 *
 * `display:none` on the wrapper, not conditional (un)mounting: Chromium
 * keeps running a `display:none` iframe's JS/timers/postMessage handling
 * normally, it just stops painting — irrelevant here, these have no visible
 * UI at all.
 */
export function PluginToolRuntime({ plugins }: Props) {
  const refs = useRef(new Map<string, PluginFrameHandle>());

  const toolable = useMemo(
    () => plugins.filter((p) => p.manifest.status !== "draft" && !p.error && (p.manifest.tools?.length ?? 0) > 0),
    [plugins],
  );

  useEffect(
    () =>
      window.yggdrasil.plugins.onToolCallRequest(async ({ callId, scope, id, tool, params }) => {
        const key = `${scope}:${id}`;
        let handle = refs.current.get(key);
        if (!handle) {
          // A plugin published (or edited to add a tool) moments ago may not
          // have a mounted hidden frame yet — usePlugins' own refresh (on
          // plugins:changed) races this call. One short retry covers the
          // common case instead of failing outright.
          await new Promise((resolve) => setTimeout(resolve, 400));
          handle = refs.current.get(key);
        }
        if (!handle) {
          await window.yggdrasil.plugins.toolCallResult(
            callId,
            false,
            "complemento no disponible todavía — probá de nuevo en un momento",
          );
          return;
        }
        try {
          const result = await handle.callTool(tool, params);
          await window.yggdrasil.plugins.toolCallResult(callId, true, result);
        } catch (err) {
          await window.yggdrasil.plugins.toolCallResult(callId, false, err instanceof Error ? err.message : String(err));
        }
      }),
    [],
  );

  return (
    <div style={{ display: "none" }}>
      {toolable.map((p) => (
        <PluginFrame
          key={p.key}
          ref={(handle) => {
            if (handle) refs.current.set(p.key, handle);
            else refs.current.delete(p.key);
          }}
          plugin={p}
          version={0}
          visible={false}
        />
      ))}
    </div>
  );
}
