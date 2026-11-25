import "./boot.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MinusIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useI18n, type MessageKey } from "../i18n/index.js";
import { loadOnboarding } from "../onboarding/store.js";
import { createAsciiTree, type AsciiTree } from "../onboarding/asciiTree.js";
import type { BootStage } from "../types.js";
import { useBoot } from "./bootStore.js";

const SPIN = ["◐", "◓", "◑", "◒"];
const MARK: Record<BootStage["state"], string> = { pending: "·", active: "", done: "✓", failed: "✕" };

/**
 * Covers the window from the moment it opens until the gateway is connected:
 * the project's name, the real startup stages as they happen, and the ASCII
 * Yggdrasil (one light per stage). On failure it shows the reason with Retry.
 * When the app is connected it hurries the tree, fades out and calls onDone.
 */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { snapshot, connected, connectError } = useBoot();
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [leaving, setLeaving] = useState(false);
  const [spin, setSpin] = useState(0);
  const [copied, setCopied] = useState(false);

  // The UI language lives in the onboarding settings (IPC only, no gateway needed): apply it before the first stage shows.
  useEffect(() => void loadOnboarding(), []);

  // The connect stage is the renderer's: time it from the gateway handover to the authenticated socket.
  const gatewayAt = useRef<number | null>(null);
  const [connectMs, setConnectMs] = useState<number | null>(null);
  useEffect(() => { if (snapshot?.gateway && gatewayAt.current === null) gatewayAt.current = performance.now(); }, [snapshot?.gateway]);
  useEffect(() => { if (connected && gatewayAt.current !== null) setConnectMs(Math.round(performance.now() - gatewayAt.current)); }, [connected]);

  const stages: BootStage[] = (snapshot?.stages ?? []).map((st) =>
    st.id !== "connect" ? st : connected ? { ...st, state: "done", ms: connectMs ?? undefined } : connectError ? { ...st, state: "failed" } : st,
  );
  const error = snapshot?.error?.message ?? connectError;
  const activeIndex = stages.findIndex((st) => st.state === "active");

  // The tree: one realm per stage, lit as stages complete. Started after first paint so the list shows at once.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tree = useRef<AsciiTree | null>(null);
  const realms = stages.length || 4;
  useEffect(() => {
    if (!canvasRef.current) return;
    const tr = createAsciiTree(canvasRef.current, { realms, reducedMotion: reduced });
    tree.current = tr;
    const raf = requestAnimationFrame(() => tr.restart());
    return () => { cancelAnimationFrame(raf); tr.dispose(); tree.current = null; };
  }, [realms, reduced]);
  useEffect(() => { tree.current?.setLit(connected ? realms : activeIndex); }, [activeIndex, connected, realms]);

  useEffect(() => {
    if (activeIndex < 0 || error) return;
    const id = window.setInterval(() => setSpin((n) => n + 1), 110);
    return () => window.clearInterval(id);
  }, [activeIndex, error]);

  // Connected: the tree finishes in a rush, the screen fades, the app is already underneath.
  useEffect(() => {
    if (!connected) return;
    tree.current?.hurry();
    const a = window.setTimeout(() => setLeaving(true), reduced ? 0 : 450);
    const b = window.setTimeout(onDone, reduced ? 0 : 1050);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [connected, onDone, reduced]);

  const retry = () => {
    // A connect failure is the renderer's own: reload to reconnect. Anything earlier: main reruns the boot.
    if (connectError && !snapshot?.error) window.location.reload();
    else void window.yggdrasil.boot.retry();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(error ?? "");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const name = window.yggdrasil.projectName ?? "Yggdrasil";
  const color = window.yggdrasil.projectColor;
  const kind = snapshot?.kind ?? (window.yggdrasil.isDefaultProject ? "launch" : "project");

  return (
    <div
      className={`boot-screen${leaving ? " is-leaving" : ""}`}
      style={color ? ({ "--boot-project": color } as CSSProperties) : undefined}
      role="status"
      aria-live="polite"
      aria-busy={!connected && !error}
    >
      <div className="boot-bar">
        <span className="boot-bar-dot" aria-hidden />
        <b>{name}</b>
        <span>{error ? t("boot.state.fail") : t("boot.state.boot")}</span>
        <span className="boot-bar-spacer" />
        <button type="button" className="boot-bar-btn" title={t("title.minimize")} onClick={() => void window.yggdrasil.window.minimize()}>
          <MinusIcon className="hero-icon" />
        </button>
        <button type="button" className="boot-bar-btn boot-bar-close" title={t("ui.close")} onClick={() => void window.yggdrasil.window.close()}>
          <XMarkIcon className="hero-icon" />
        </button>
      </div>
      <div className="boot-stage">
        <canvas ref={canvasRef} className="boot-tree" aria-hidden />
        <div className="boot-words">
          <div className="boot-eyebrow">{t(kind === "launch" ? "boot.eyebrow.launch" : "boot.eyebrow.project")}</div>
          <h1 className="boot-name">{name}</h1>
          {window.yggdrasil.projectPath && <div className="boot-path">{window.yggdrasil.projectPath}</div>}
          <ul className="boot-steps">
            {stages.map((st) => (
              <li key={st.id} className={`is-${st.state}`}>
                <span className="boot-mark" aria-hidden>{st.state === "active" && !error ? SPIN[spin % 4] : MARK[st.state] || "·"}</span>
                <span>{t(`boot.stage.${st.id}` as MessageKey)}</span>
                <span className="boot-ms">{st.state === "done" && st.ms !== undefined ? `${st.ms} ms` : ""}</span>
              </li>
            ))}
          </ul>
          {error && (
            <div className="boot-error" role="alert">
              <p>{t("boot.failTitle")}</p>
              <code>{error}</code>
              <div className="boot-error-actions">
                <button type="button" className="boot-btn boot-btn--primary" onClick={retry}>
                  {t("boot.retry")}
                </button>
                <button type="button" className="boot-btn" onClick={() => void copy()}>
                  {copied ? t("boot.copied") : t("boot.copy")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
