import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { PluginRecord } from "../types.js";
import { createPluginHost } from "./pluginHost.js";
import type { PluginConsoleEntry, PluginErrorEntry } from "./pluginTypes.js";

type Props = {
  plugin: PluginRecord;
  version: number;
  visible: boolean;
  onOpenFile?: (relativePath: string) => void;
  onOpenTab?: (tab: string) => void;
  /** Unsolicited console.log/warn/error forwarded by pluginSdk.ts — see StudioPreview.tsx. Ordinary (non-Studio) uses just omit this. */
  onConsole?: (entry: Omit<PluginConsoleEntry, "kind">) => void;
  /** Same, for window.onerror/unhandledrejection. */
  onError?: (entry: Omit<PluginErrorEntry, "kind">) => void;
};

/** Imperative API for a parent holding a ref — currently just tool-call dispatch, used by PluginToolRuntime.tsx to invoke a plugin's own ygg.tools.register handlers, visible or not. */
export type PluginFrameHandle = {
  callTool: (tool: string, params: unknown) => Promise<unknown>;
};

// Generous but bounded — a plugin that never loads (broken script, stuck
// network) must not hang a tool call forever.
const READY_TIMEOUT_MS = 10_000;
// Mirrors pluginSdk.ts's own internal `call()` timeout, for symmetry.
const TOOL_CALL_TIMEOUT_MS = 30_000;

// Deliberately no "allow-same-origin" or "allow-popups"/"allow-top-navigation"
// — see pluginSdk.ts's doc comment for what dropping allow-same-origin buys
// (an opaque per-document origin, no shared localStorage between plugins, no
// cross-plugin fetch) and how the postMessage bridge below copes with it
// (`event.source` identity instead of an origin string). The other four ARE
// needed for a plugin to behave like an ordinary page instead of a crippled
// one: allow-modals (alert/confirm/prompt — blocked with just allow-scripts,
// Chromium silently no-ops the call rather than erroring, so this was easy
// to miss until a scaffolded plugin actually called prompt()), allow-downloads
// (an <a download> or a File System Access save — also silently a no-op
// without it, same as modals), allow-popups-to-escape-sandbox (a download
// opened via window.open still needs this even with allow-downloads present,
// since the popup itself would otherwise inherit the sandbox and get blocked
// too), and allow-forms (native <form> submission/validation UI).
const PLUGIN_IFRAME_SANDBOX = "allow-scripts allow-forms allow-modals allow-downloads allow-popups-to-escape-sandbox";

type PendingToolCall = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * Renders one complemento's own document in a sandboxed iframe — see
 * PLUGIN_IFRAME_SANDBOX above for exactly which capabilities that grants.
 * `forwardRef`-based imperative `callTool` is additive: every existing
 * caller (MainTabs' dynamic plugin tabs, PluginPanel.tsx, StudioPreview.tsx)
 * renders `<PluginFrame .../>` with no ref at all, unaffected.
 */
export const PluginFrame = forwardRef<PluginFrameHandle, Props>(function PluginFrame(
  { plugin, version, visible, onOpenFile, onOpenTab, onConsole, onError },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { call, onEvent } = useGateway();
  // Keyed by plugin.key via the parent's own `key` prop convention (callers
  // remount this component per plugin key) — a fresh host per mount is fine,
  // it holds no state worth surviving an unmount.
  const host = useMemo(
    () => createPluginHost({ plugin, onOpenFile, onOpenTab, gatewayCall: call }),
    [plugin, onOpenFile, onOpenTab, call],
  );

  // Resolves once this mount's iframe has announced ygg:ready (see the
  // message listener below) — reset on every real reload (a new plugin.url
  // or a bumped version, both mean a fresh document, hence a fresh
  // handshake). callTool awaits this before sending a toolcall, so it never
  // races a not-yet-loaded/not-yet-registered plugin.
  const readyResolveRef = useRef<(() => void) | null>(null);
  const readyPromiseRef = useRef<Promise<void>>(new Promise(() => {}));
  useEffect(() => {
    readyPromiseRef.current = new Promise((resolve) => {
      readyResolveRef.current = resolve;
    });
  }, [plugin.url, version]);

  const pendingToolCalls = useRef(new Map<string, PendingToolCall>());

  // Only a plugin that declared "fs" gets the workspace's own fs.changed
  // stream — the same permission that gates ygg.fs.list/read in pluginHost.ts.
  useEffect(() => {
    if (!(plugin.manifest.permissions ?? []).includes("fs")) return;
    return onEvent((ev) => {
      if (ev.event === "fs.changed") host.pushEvent("fs.changed", ev.payload);
    });
  }, [host, onEvent, plugin.manifest.permissions]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const msg = event.data as { type?: unknown } | null;
      if (msg?.type === "ygg:console") {
        onConsole?.(msg as Omit<PluginConsoleEntry, "kind">);
        return;
      }
      if (msg?.type === "ygg:error") {
        onError?.(msg as Omit<PluginErrorEntry, "kind">);
        return;
      }
      if (msg?.type === "ygg:toolresult") {
        const { callId, ok, result, error } = msg as {
          callId: string;
          ok: boolean;
          result?: unknown;
          error?: string;
        };
        const pending = pendingToolCalls.current.get(callId);
        if (!pending) return; // already timed out, or a stray/duplicate reply
        pendingToolCalls.current.delete(callId);
        if (ok) pending.resolve(result);
        else pending.reject(new Error(error || "tool call failed"));
        return;
      }
      // Observed in parallel, not in place of, the existing ygg:ready →
      // host.handleMessage flow below (that's what actually replies with
      // the "init" event the plugin's own ygg.ready() promise waits on) —
      // this just also unblocks callTool's own readiness wait, the instant
      // the SDK's message listener (and thus its toolHandlers registration)
      // is guaranteed live.
      if (msg?.type === "ygg:ready") readyResolveRef.current?.();
      void host.handleMessage(msg, (m) => win.postMessage(m, "*"));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [host, onConsole, onError]);

  useEffect(() => () => host.dispose(), [host]);

  useEffect(() => {
    host.setVisible(visible);
  }, [host, visible]);

  useImperativeHandle(
    ref,
    () => ({
      async callTool(tool, params) {
        await Promise.race([
          readyPromiseRef.current,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`complemento "${plugin.manifest.name}" no respondió (timeout de arranque)`)), READY_TIMEOUT_MS),
          ),
        ]);
        const win = iframeRef.current?.contentWindow;
        if (!win) throw new Error(`complemento "${plugin.manifest.name}" no está cargado`);
        const callId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingToolCalls.current.delete(callId);
            reject(new Error(`tool "${tool}" superó el tiempo de espera`));
          }, TOOL_CALL_TIMEOUT_MS);
          pendingToolCalls.current.set(callId, {
            resolve: (v) => {
              clearTimeout(timer);
              resolve(v);
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          });
          win.postMessage({ type: "ygg:toolcall", callId, tool, params }, "*");
        });
      },
    }),
    [plugin.manifest.name],
  );

  if (plugin.error || !plugin.url) {
    return (
      <div className="plugin-frame-error">
        <p>Complemento roto: {plugin.manifest.name}</p>
        {plugin.error && <pre>{plugin.error}</pre>}
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      className="plugin-frame"
      sandbox={PLUGIN_IFRAME_SANDBOX}
      allow="microphone"
      src={`${plugin.url}?v=${version}`}
      title={plugin.manifest.name}
    />
  );
});
