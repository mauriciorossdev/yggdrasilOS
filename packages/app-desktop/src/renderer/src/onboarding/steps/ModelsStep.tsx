import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { Button, Card, Chip } from "../../ui/index.js";
import { useI18n } from "../../i18n/index.js";
import { ProvidersSection, buildProvidersPatch } from "../../settings/sections/ProvidersSection.js";
import type { ConfigGetResult, ConfigShape, OllamaStatus, ProviderInfo } from "../../types.js";
import { toggle, type WizardDraft, type WizardUpdate } from "../draft.js";

type Props = { draft: WizardDraft; update: WizardUpdate };

const OLLAMA_DOWNLOAD = "https://ollama.com/download";

export function ModelsStep({ draft, update }: Props) {
  const { t } = useI18n();
  const { call } = useGateway();

  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [apiKeyEdits, setApiKeyEdits] = useState<Record<string, string>>({});
  const [apiMessage, setApiMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const [ollamaApplied, setOllamaApplied] = useState<string | null>(null);

  const scanOllama = useCallback(async () => {
    setScanning(true);
    try {
      const status = await window.yggdrasil.onboarding.detectOllama();
      setOllama(status);
      if (status.models.length > 0 && !draft.ollamaModel) update({ ollamaModel: status.models[0] });
    } catch {
      setOllama({ installed: false, running: false, models: [] });
    } finally {
      setScanning(false);
    }
  }, [draft.ollamaModel, update]);

  useEffect(() => {
    void scanOllama();
    void (async () => {
      try {
        const [cfg, list] = await Promise.all([
          call<ConfigGetResult>("config.get"),
          call<{ providers: ProviderInfo[] }>("providers.list"),
        ]);
        setConfig(cfg.config);
        setProviders(list.providers ?? []);
      } catch {
        // Gateway hiccup: the cards below simply stay in their loading state.
      }
    })();
    // Load once on first show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useOllamaModel = async () => {
    if (!config || !draft.ollamaModel) return;
    const model = draft.ollamaModel;
    const agents = [...(config.agents ?? [])];
    const defaultId = config.defaultAgent ?? agents[0]?.id ?? "default";
    const index = agents.findIndex((a) => a.id === defaultId);
    if (index >= 0) agents[index] = { ...agents[index], provider: "ollama", model };
    else agents.push({ id: defaultId, provider: "ollama", model });
    const nextProviders = { ...config.providers, ollama: { ...config.providers?.ollama, defaultModel: model } };
    await call("config.patch", { agents, providers: nextProviders });
    setConfig({ ...config, agents, providers: nextProviders });
    setOllamaApplied(model);
    update({ usage: toggle(draft.usage, "local", true) });
  };

  const saveProviders = async () => {
    if (!config) return;
    setApiMessage(null);
    try {
      await call("config.patch", { providers: buildProvidersPatch(config, apiKeyEdits) });
      const list = await call<{ providers: ProviderInfo[] }>("providers.list");
      setProviders(list.providers ?? []);
      setApiKeyEdits({});
      const failing = (list.providers ?? []).find((p) => p.id === "openai-compat" && p.error);
      if (failing) {
        setApiMessage({ ok: false, text: t("ob.api.error", { error: failing.error ?? "" }) });
      } else {
        setApiMessage({ ok: true, text: t("ob.api.saved") });
        update({ usage: toggle(draft.usage, "api", true) });
      }
    } catch (err) {
      setApiMessage({ ok: false, text: t("ob.api.error", { error: err instanceof Error ? err.message : String(err) }) });
    }
  };

  return (
    <div className="onboarding-step">
      <h2>{t("ob.s2.title")}</h2>
      <p className="muted">{t("ob.s2.hint")}</p>

      <Card accent={draft.usage.includes("local")} className="onboarding-card onboarding-card--wide">
        <div className="onboarding-section-head">
          <h3>{t("ob.ollama.title")}</h3>
          <Button size="sm" onClick={() => void scanOllama()} disabled={scanning}>
            {scanning ? t("ob.scanning") : t("ob.scan")}
          </Button>
        </div>

        {ollama === null ? (
          <p className="muted">{t("ob.scanning")}</p>
        ) : !ollama.installed ? (
          <div className="onboarding-card-row">
            <p className="muted">{t("ob.ollama.missing")}</p>
            <button
              type="button"
              className="onboarding-link"
              onClick={() => void window.yggdrasil.onboarding.openExternal(OLLAMA_DOWNLOAD)}
            >
              {t("ob.ollama.install")}
            </button>
          </div>
        ) : !ollama.running ? (
          <p className="muted">{t("ob.ollama.notRunning")}</p>
        ) : ollama.models.length === 0 ? (
          <>
            <Chip tone="ready">{t("ob.ollama.running")}</Chip>
            <p className="muted">{t("ob.ollama.noModels")}</p>
          </>
        ) : (
          <>
            <Chip tone="ready">{t("ob.ollama.running")}</Chip>
            <label className="onboarding-field">
              <span>{t("ob.ollama.model")}</span>
              <select value={draft.ollamaModel ?? ""} onChange={(e) => update({ ollamaModel: e.target.value })}>
                {ollama.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <div className="onboarding-card-row">
              <Button variant="primary" size="sm" onClick={() => void useOllamaModel()} disabled={!config}>
                {t("ob.ollama.use")}
              </Button>
              {ollamaApplied && <span className="onboarding-ok">{t("ob.ollama.applied", { model: ollamaApplied })}</span>}
            </div>
          </>
        )}
      </Card>

      <Card accent={draft.usage.includes("api")} className="onboarding-card onboarding-card--wide">
        <h3>{t("ob.api.title")}</h3>
        <p className="muted">{t("ob.api.hint")}</p>
        {config && (
          <ProvidersSection
            config={config}
            setConfig={setConfig}
            providers={providers}
            apiKeyEdits={apiKeyEdits}
            setApiKeyEdits={setApiKeyEdits}
          />
        )}
        <div className="onboarding-card-row">
          <Button size="sm" onClick={() => void saveProviders()} disabled={!config}>
            {t("ob.api.save")}
          </Button>
          {apiMessage && <span className={apiMessage.ok ? "onboarding-ok" : "error"}>{apiMessage.text}</span>}
        </div>
      </Card>
    </div>
  );
}
