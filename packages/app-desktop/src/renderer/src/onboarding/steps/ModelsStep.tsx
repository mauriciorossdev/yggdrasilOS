import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { useI18n } from "../../i18n/index.js";
import type { ConfigGetResult, ConfigProvider, ConfigShape, OllamaStatus, OnboardingUsage, ProviderInfo } from "../../types.js";
import { toggle, type WizardDraft, type WizardUpdate } from "../draft.js";
import { Option } from "./Option.js";

type Props = { draft: WizardDraft; update: WizardUpdate };
type Call = ReturnType<typeof useGateway>["call"];

const OLLAMA_DOWNLOAD = "https://ollama.com/download";
const ANTHROPIC = "anthropic";
/** The gateway has a single OpenAI-compatible provider (one base URL, one key), so its presets are mutually exclusive. */
const COMPAT = "openai-compat";
const COMPAT_PRESETS = [
  { id: "openai", label: "OpenAI", url: "https://api.openai.com/v1", ph: "sk-…" },
  { id: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/api/v1", ph: "sk-or-…" },
  { id: "other", label: null, url: "", ph: "…" },
] as const;
type PresetId = (typeof COMPAT_PRESETS)[number]["id"];

type Status = { state: "testing" } | { state: "ok"; models: number } | { state: "error"; error: string };

/**
 * Makes `model` (from Ollama) the default agent's model. Called by the wizard on finish only,
 * since it rewrites the default agent: browsing the step must not change anything.
 */
export async function applyOllamaDefault(call: Call, model: string): Promise<void> {
  const { config } = await call<ConfigGetResult>("config.get");
  const agents = [...(config.agents ?? [])];
  const defaultId = config.defaultAgent ?? agents[0]?.id ?? "default";
  const index = agents.findIndex((a) => a.id === defaultId);
  if (index >= 0) agents[index] = { ...agents[index], provider: "ollama", model };
  else agents.push({ id: defaultId, provider: "ollama", model });
  // Only the fields that change: providers save globally (notes/features/global-providers.md).
  await call("config.patch", { agents, providers: { ollama: { defaultModel: model } } });
}

export function ModelsStep({ draft, update }: Props) {
  const { t } = useI18n();
  const { call } = useGateway();
  const has = (u: OnboardingUsage) => draft.usage.includes(u);
  const flip = (u: OnboardingUsage) => update({ usage: toggle(draft.usage, u, !has(u)) });

  // --- Ollama ---
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanOllama = useCallback(async () => {
    setScanning(true);
    try {
      const status = await window.yggdrasil.onboarding.detectOllama();
      setOllama(status);
      // Embedding models (nomic-embed-text…) can't chat: never offer one as the default.
      const chat = status.models.find((m) => !/embed/i.test(m)) ?? status.models[0];
      if (chat && !draft.ollamaModel) update({ ollamaModel: chat });
    } catch {
      setOllama({ installed: false, running: false, models: [] });
    } finally {
      setScanning(false);
    }
  }, [draft.ollamaModel, update]);

  // --- API providers ---
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [anthropicOn, setAnthropicOn] = useState(true);
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [otherUrl, setOtherUrl] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});

  useEffect(() => {
    void scanOllama();
    void (async () => {
      try {
        const [cfg, list] = await Promise.all([call<ConfigGetResult>("config.get"), call<{ providers: ProviderInfo[] }>("providers.list")]);
        setConfig(cfg.config);
        setProviders(list.providers ?? []);
        // Start from what's already set up (re-running the wizard from Settings).
        const url = cfg.config.providers?.[COMPAT]?.baseUrl ?? "";
        const known = COMPAT_PRESETS.find((p) => p.url && p.url === url);
        if (known) setPreset(known.id);
        else if (url) { setPreset("other"); setOtherUrl(url); }
      } catch {
        // Gateway hiccup: the provider fields just stay empty.
      }
    })();
    // Load once on first show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const info = (id: string) => providers.find((p) => p.id === id);
  const presetLabel = (id: PresetId | null) => (id === "other" ? t("ob.api.compatOther") : COMPAT_PRESETS.find((p) => p.id === id)?.label ?? "");

  // Persist only what the user typed or changed (key, base URL), globally, then re-list to show the real outcome.
  const saveAndTest = async (id: string) => {
    setStatus((s) => ({ ...s, [id]: { state: "testing" } }));
    try {
      const patch: ConfigProvider = {};
      if (keys[id]) patch.apiKey = keys[id];
      if (id === COMPAT && preset) {
        const url = preset === "other" ? otherUrl.trim() : COMPAT_PRESETS.find((p) => p.id === preset)!.url;
        if (url !== (config?.providers?.[COMPAT]?.baseUrl ?? "")) patch.baseUrl = url;
      }
      if (Object.keys(patch).length) await call("config.patch", { providers: { [id]: patch } });
      const [cfg, list] = await Promise.all([call<ConfigGetResult>("config.get"), call<{ providers: ProviderInfo[] }>("providers.list")]);
      setConfig(cfg.config);
      setProviders(list.providers ?? []);
      setKeys(({ [id]: _sent, ...rest }) => rest);
      const p = (list.providers ?? []).find((x) => x.id === id);
      if (!p || p.error || p.configured === false) {
        setStatus((s) => ({ ...s, [id]: { state: "error", error: p?.error ?? "—" } }));
      } else {
        setStatus((s) => ({ ...s, [id]: { state: "ok", models: p.models.length } }));
        const label = id === ANTHROPIC ? "Anthropic" : presetLabel(preset);
        update({ apiProviders: [...draft.apiProviders.filter((l) => l !== label), label] });
      }
    } catch (err) {
      setStatus((s) => ({ ...s, [id]: { state: "error", error: err instanceof Error ? err.message : String(err) } }));
    }
  };

  const providerBlock = (id: string, label: string, placeholder: string, extra?: ReactNode) => {
    const st = status[id];
    const saved = info(id)?.configured && !!config?.providers?.[id]?.apiKey;
    return (
      <div className="ob-provider" key={id}>
        {extra}
        <label className="ob-field">
          <span>{t("ob.api.keyFor", { provider: label })}</span>
          <input
            className="ob-input"
            type="password"
            data-no-enter
            autoComplete="off"
            spellCheck={false}
            placeholder={saved ? t("ob.api.keySaved") : placeholder}
            value={keys[id] ?? ""}
            onChange={(e) => setKeys((k) => ({ ...k, [id]: e.target.value }))}
            // A typed key is saved (and tested) as soon as the field loses focus, so "Next" never drops it.
            onBlur={() => { if (keys[id]?.trim() && st?.state !== "testing") void saveAndTest(id); }}
          />
        </label>
        <div className="ob-provider-row">
          <button type="button" className="ob-quiet" disabled={st?.state === "testing"} onClick={() => void saveAndTest(id)}>
            {st?.state === "testing" ? t("ob.api.testing") : t("ob.api.test")}
          </button>
          {st?.state === "ok" && <span className="ob-status ob-status--ok">{t("ob.api.connected", { count: st.models })}</span>}
          {st?.state === "error" && <span className="ob-status ob-status--warn">{t("ob.api.error", { error: st.error })}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="ob-options">
      <Option kind="check" selected={has("cli")} onSelect={() => flip("cli")} label={t("ob.models.cli")} sub={t("ob.models.cliSub")} />

      <Option kind="check" selected={has("local")} onSelect={() => flip("local")} label={t("ob.models.local")} sub={t("ob.models.localSub")} />
      {has("local") && (
        <div className="ob-sub">
          {ollama === null ? (
            <p className="ob-muted">{t("ob.scanning")}</p>
          ) : !ollama.installed ? (
            <p className="ob-muted">
              {t("ob.ollama.missing")}{" "}
              <button type="button" className="ob-link" onClick={() => void window.yggdrasil.onboarding.openExternal(OLLAMA_DOWNLOAD)}>
                {t("ob.ollama.install")} ↗
              </button>
            </p>
          ) : !ollama.running ? (
            <p className="ob-muted">{t("ob.ollama.notRunning")}</p>
          ) : ollama.models.length === 0 ? (
            <p className="ob-muted">{t("ob.ollama.noModels")}</p>
          ) : (
            <>
              <p className="ob-status ob-status--ok">
                <span className="ob-dot" aria-hidden />
                {t("ob.ollama.running", { count: ollama.models.length })}
              </p>
              <label className="ob-field">
                <span>{t("ob.ollama.model")}</span>
                <select className="ob-select" value={draft.ollamaModel ?? ""} onChange={(e) => update({ ollamaModel: e.target.value })}>
                  {ollama.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {ollama !== null && (!ollama.running || ollama.models.length === 0) && (
            <button type="button" className="ob-quiet" onClick={() => void scanOllama()} disabled={scanning}>
              {scanning ? t("ob.scanning") : t("ob.scan")}
            </button>
          )}
        </div>
      )}

      <Option kind="check" selected={has("api")} onSelect={() => flip("api")} label={t("ob.models.api")} sub={t("ob.models.apiSub")} />
      {has("api") && (
        <div className="ob-sub">
          <div className="ob-field">
            <span>{t("ob.api.provider")}</span>
            <div className="ob-chips">
              <button type="button" className="ob-chip" aria-pressed={anthropicOn} onClick={() => setAnthropicOn((v) => !v)}>
                Anthropic
              </button>
              {COMPAT_PRESETS.map((p) => (
                <button key={p.id} type="button" className="ob-chip" aria-pressed={preset === p.id} onClick={() => setPreset((cur) => (cur === p.id ? null : p.id))}>
                  {presetLabel(p.id)}
                </button>
              ))}
            </div>
            <small className="ob-muted">{t("ob.api.compatNote")}</small>
          </div>
          {anthropicOn && providerBlock(ANTHROPIC, "Anthropic", "sk-ant-…")}
          {preset &&
            providerBlock(
              COMPAT,
              presetLabel(preset),
              COMPAT_PRESETS.find((p) => p.id === preset)!.ph,
              preset === "other" ? (
                <label className="ob-field">
                  <span>{t("ob.api.baseUrl")}</span>
                  <input
                    className="ob-input"
                    data-no-enter
                    spellCheck={false}
                    placeholder="https://…/v1"
                    value={otherUrl}
                    onChange={(e) => setOtherUrl(e.target.value)}
                    onBlur={() => { if (otherUrl.trim() && otherUrl.trim() !== (config?.providers?.[COMPAT]?.baseUrl ?? "")) void saveAndTest(COMPAT); }}
                  />
                </label>
              ) : undefined,
            )}
        </div>
      )}
    </div>
  );
}
