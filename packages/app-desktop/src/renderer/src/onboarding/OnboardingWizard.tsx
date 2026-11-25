import "./onboarding.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { getLanguage, useI18n, type MessageKey } from "../i18n/index.js";
import type { CliId, DetectedCli, OnboardingSettings } from "../types.js";
import type { WizardDraft, WizardUpdate } from "./draft.js";
import { closeWizard, saveOnboarding, useOnboarding } from "./store.js";
import { createAsciiTree, type AsciiTree } from "./asciiTree.js";
import { LanguageStep } from "./steps/LanguageStep.js";
import { NameStep } from "./steps/NameStep.js";
import { AgentsStep } from "./steps/AgentsStep.js";
import { ModelsStep, applyOllamaDefault } from "./steps/ModelsStep.js";
import { EditorStep } from "./steps/EditorStep.js";
import { SummaryStep } from "./steps/SummaryStep.js";

/** Bump together with ONBOARDING_VERSION in main/onboardingSettings.ts. */
const ONBOARDING_VERSION = 1;
const STEPS = ["lang", "name", "agents", "models", "editor", "done"] as const;
type StepId = (typeof STEPS)[number];
/** Steps the user may skip; skipping leaves that part of their setup as it was. */
const OPTIONAL: ReadonlySet<StepId> = new Set(["name", "agents", "models", "editor"]);
const WORD = "Yggdrasil";

// Full screen is held while any wizard instance is mounted. Releasing is deferred a tick so
// StrictMode's mount → unmount → mount doesn't toggle the window mid-transition (which would make
// main remember "was full screen" and leave the window that way after the wizard closes).
let fullScreenHolders = 0;
let fullScreenOn = false;
let fullScreenOffTimer = 0;
function holdFullScreen(): () => void {
  fullScreenHolders++;
  window.clearTimeout(fullScreenOffTimer);
  if (!fullScreenOn) {
    fullScreenOn = true;
    void window.yggdrasil.window.setFullScreen(true).catch(() => {});
  }
  return () => {
    fullScreenHolders--;
    fullScreenOffTimer = window.setTimeout(() => {
      if (fullScreenHolders > 0 || !fullScreenOn) return;
      fullScreenOn = false;
      void window.yggdrasil.window.setFullScreen(false).catch(() => {});
    }, 0);
  };
}

function useReducedMotion(): boolean {
  return useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
}

/** The wizard's voice: the line types itself out, then calls onDone. */
function TypedLine({ text, reduced, onDone }: { text: string; reduced: boolean; onDone: () => void }) {
  const [shown, setShown] = useState(reduced ? text.length : 0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (reduced) { setShown(text.length); done.current(); return; }
    setShown(0);
    let i = 0, timer = 0;
    const tick = () => {
      i++;
      setShown(i);
      if (i < text.length) timer = window.setTimeout(tick, /[,.?¿]/.test(text[i - 1]) ? 160 : 24);
      else done.current();
    };
    timer = window.setTimeout(tick, 250);
    return () => window.clearTimeout(timer);
  }, [text, reduced]);
  const typing = shown < text.length;
  return (
    <h2 className="ob-say" aria-label={text}>
      <span aria-hidden>{text.slice(0, shown)}</span>
      {typing && <span className="ob-caret" aria-hidden />}
    </h2>
  );
}

export function OnboardingWizard() {
  const { t } = useI18n();
  const { call } = useGateway();
  const { settings } = useOnboarding();
  const reduced = useReducedMotion();

  const [phase, setPhase] = useState<"boot" | "steps" | "leaving">("boot");
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<ReadonlySet<StepId>>(new Set());
  const [bodyIn, setBodyIn] = useState(false);
  const [bootIn, setBootIn] = useState(0); // 0 nothing, 1 letters, 2 tagline, 3 button
  const [clis, setClis] = useState<DetectedCli[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<WizardDraft>(() => ({
    language: getLanguage(),
    userName: settings?.userName ?? "",
    enabled: (settings?.enabledHarnesses ?? []) as CliId[],
    usage: settings?.usage ?? [],
    ideId: null,
    ideLabel: null,
    ollamaModel: null,
    apiProviders: [],
  }));
  const update: WizardUpdate = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), []);

  // Start from the IDE already configured (re-running from Settings), if any.
  const [ideLoaded, setIdeLoaded] = useState(false);
  const [hadIde, setHadIde] = useState(false);
  useEffect(() => {
    void window.yggdrasil.ide
      .getSettings()
      .then(async (ide) => {
        if (ide.configuredId) {
          const catalog = await window.yggdrasil.ide.listCatalog().catch(() => []);
          const label = ide.configuredId === "custom" ? (ide.customLabel ?? "Custom") : catalog.find((c) => c.id === ide.configuredId)?.label;
          update({ ideId: ide.configuredId, ideLabel: label ?? ide.configuredId });
          setHadIde(true);
        }
        setIdeLoaded(true);
      })
      .catch(() => setIdeLoaded(true));
  }, [update]);

  // The whole screen while setup runs; the window gets its previous state back on the way out.
  useEffect(() => holdFullScreen(), []);

  // The ASCII tree: one realm per step lights up as the user advances.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tree = useRef<AsciiTree | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const tr = createAsciiTree(canvasRef.current, { realms: STEPS.length, reducedMotion: reduced });
    tree.current = tr;
    tr.restart();
    return () => { tr.dispose(); tree.current = null; };
  }, [reduced]);
  useEffect(() => { tree.current?.setLit(phase === "boot" ? -1 : step); }, [phase, step]);

  // Boot: the name fades in letter by letter, then the tagline, then the button.
  useEffect(() => {
    if (phase !== "boot") return;
    const d = reduced ? 0 : 1;
    const timers = [
      window.setTimeout(() => setBootIn(1), 900 * d),
      window.setTimeout(() => setBootIn(2), (900 + (WORD.length + 2) * 110 + 300) * d),
      window.setTimeout(() => setBootIn(3), (900 + (WORD.length + 2) * 110 + 1100) * d),
    ];
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [phase, reduced]);
  const beginRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (bootIn === 3) beginRef.current?.focus({ preventScroll: true }); }, [bootIn]);

  const id = STEPS[step];
  const go = (i: number) => { setBodyIn(false); setStep(i); setPhase("steps"); };

  const finish = async (skipAll: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const skip = (s: StepId) => skipAll || skipped.has(s);
      if (!skip("editor")) {
        const ide = await window.yggdrasil.ide.getSettings();
        if (draft.ideId !== ide.configuredId) await window.yggdrasil.ide.saveSettings({ ...ide, configuredId: draft.ideId });
      }
      // Rewrites the default agent, so only when the user actually chose a local model and didn't skip the step.
      if (!skip("models") && draft.usage.includes("local") && draft.ollamaModel) {
        await applyOllamaDefault(call, draft.ollamaModel).catch(() => {});
      }
      const next: OnboardingSettings = {
        completedAt: new Date().toISOString(),
        version: ONBOARDING_VERSION,
        language: draft.language,
        // Skipping leaves things as they were; a step the user went through records the choice.
        enabledHarnesses: skip("agents") ? (settings?.enabledHarnesses ?? null) : draft.enabled,
        usage: skip("models") ? (settings?.usage ?? []) : draft.usage,
        showAllClis: settings?.showAllClis ?? false,
        userName: skip("name") ? (settings?.userName ?? null) : draft.userName.trim() || null,
      };
      await saveOnboarding(next);
      if (!skipAll && !reduced) {
        setPhase("leaving");
        tree.current?.bloom();
        await new Promise((r) => window.setTimeout(r, 1800));
      }
      closeWizard();
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    if (phase === "boot") return go(0);
    if (id === "done") return void finish(false);
    // Going through a step (even one skipped earlier) records its choice.
    setSkipped((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
    go(step + 1);
  };
  const skipStep = () => {
    setSkipped((s) => new Set(s).add(id));
    go(step + 1);
  };

  // Enter moves on, except from controls that use it themselves (buttons, selects, API key fields).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || busy || phase === "leaving") return;
    const el = e.target as HTMLElement;
    if (el.closest("button, select, textarea, [role=link], [data-no-enter]")) return;
    e.preventDefault();
    advance();
  };

  const say: Record<StepId, string> = {
    lang: t("ob.lang.say"),
    name: t("ob.name.say"),
    agents: t("ob.agents.say"),
    models: t("ob.models.say"),
    editor: t("ob.editor.say"),
    done: draft.userName.trim() && !skipped.has("name") ? t("ob.done.sayName", { name: draft.userName.trim() }) : t("ob.done.say"),
  };
  const hint: Record<StepId, MessageKey> = {
    lang: "ob.lang.hint",
    name: "ob.name.hint",
    agents: "ob.cli.hint",
    models: "ob.models.hint",
    editor: "ob.ide.hint",
    done: "ob.done.hint",
  };
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className={`ob-screen ob-screen--${phase}`} role="dialog" aria-modal="true" aria-label={t("ob.aria")} onKeyDown={onKeyDown}>
      <canvas ref={canvasRef} className="ob-tree" aria-hidden />
      <div className="ob-drag" aria-hidden />
      <section className="ob-left">
        <header className={`ob-top${phase === "steps" ? " is-on" : ""}`}>
          <span>{t("ob.brand")}</span>
          <div className="ob-top-right">
            {phase === "steps" && id !== "done" && (
              <button type="button" className="ob-quiet ob-quiet--mono" onClick={() => void finish(true)} disabled={busy}>
                {t("ob.skipAll")}
              </button>
            )}
            <div className="ob-progress" aria-hidden>
              {STEPS.map((s, i) => (
                <i key={s} className={phase !== "steps" ? "" : i < step ? "is-done" : i === step ? "is-now" : ""} />
              ))}
            </div>
          </div>
        </header>

        <div className="ob-stage" aria-live="polite">
          {phase === "boot" ? (
            <div className="ob-boot">
              <h1 aria-label="YggdrasilOS">
                {[...WORD].map((c, i) => (
                  <span key={i} className={bootIn >= 1 ? "is-in" : ""} style={{ transitionDelay: `${i * 110}ms` }}>
                    {c}
                  </span>
                ))}
                <span className={`ob-os${bootIn >= 1 ? " is-in" : ""}`} style={{ transitionDelay: `${WORD.length * 110}ms` }}>
                  OS
                </span>
              </h1>
              <p className={`ob-tag${bootIn >= 2 ? " is-in" : ""}`}>{t("ob.tag")}</p>
              <div className={`ob-go${bootIn >= 3 ? " is-in" : ""}`}>
                <button ref={beginRef} type="button" className="ob-btn ob-btn--primary" onClick={() => go(0)} tabIndex={bootIn >= 3 ? 0 : -1}>
                  {t("ob.begin")} <span className="ob-arrow">→</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="ob-step" key={`${id}-${draft.language}`}>
              <div className="ob-eyebrow">
                {pad(step + 1)} / {pad(STEPS.length)} · {t(`ob.step.${id}` as MessageKey)}
              </div>
              <TypedLine text={say[id]} reduced={reduced} onDone={() => setBodyIn(true)} />
              <p className="ob-hint">{t(hint[id])}</p>
              <div className={`ob-body${bodyIn ? " is-in" : ""}`}>
                {id === "lang" && <LanguageStep draft={draft} update={update} />}
                {id === "name" && <NameStep draft={draft} update={update} />}
                {id === "agents" && (
                  <AgentsStep draft={draft} update={update} clis={clis} onClis={setClis} preselectInstalled={settings?.enabledHarnesses == null} />
                )}
                {id === "models" && <ModelsStep draft={draft} update={update} />}
                {id === "editor" && ideLoaded && <EditorStep draft={draft} update={update} recommendFirst={!hadIde} />}
                {id === "done" && <SummaryStep draft={draft} clis={clis} skipped={skipped} />}
              </div>
            </div>
          )}
        </div>

        {phase === "steps" && (
          <footer className="ob-foot">
            {step > 0 && (
              <button type="button" className="ob-btn" onClick={() => go(step - 1)} disabled={busy}>
                ← {t("ob.back")}
              </button>
            )}
            <button type="button" className="ob-btn ob-btn--primary" onClick={advance} disabled={busy}>
              {id === "done" ? t("ob.enter") : t("ob.next")} <span className="ob-arrow">→</span>
            </button>
            {OPTIONAL.has(id) && (
              <button type="button" className="ob-btn ob-btn--ghost" onClick={skipStep} disabled={busy}>
                {t("ob.skipStep")}
              </button>
            )}
            <span className="ob-spacer" />
            {id === "done" && <span className="ob-kbd">{t("ob.enterHint")}</span>}
          </footer>
        )}
      </section>
      <div className="ob-veil" aria-hidden>
        <p>{t("ob.opening")}</p>
      </div>
    </div>
  );
}
