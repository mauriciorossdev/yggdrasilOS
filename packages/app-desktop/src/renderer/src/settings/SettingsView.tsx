import { useCallback, useEffect, useRef, useState } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import type {
  ConfigGetResult,
  ConfigPatchResult,
  ConfigShape,
  ProviderSources,
  HarnessInfo,
  McpServerStatus,
  ProviderInfo,
  McpTestResult,
} from "../types.js";
import { GeneralSection } from "./sections/GeneralSection.js";
import { AgentSection } from "@yggdrasil/ui-kit";
import { ProvidersSection } from "@yggdrasil/ui-kit";
import { buildProvidersPatch, splitProvidersPatch } from "@yggdrasil/ui-kit";
import {
  ALL_PARTS,
  changedParts,
  DEFERRED_PARTS,
  incompleteMcpServers,
  mcpPart,
  NO_PROVIDER_EDITS,
  settingsParts,
  TYPING_PARTS,
  type SettingsForm,
  type SettingsPart,
  type SettingsParts,
} from "./autosave.js";
import { HarnessSection } from "./sections/HarnessSection.js";
import { CliAgentsSection } from "./sections/CliAgentsSection.js";
import { ChannelsSection } from "./sections/ChannelsSection.js";
import { McpSection, buildMcpServersPatch } from "./sections/McpSection.js";
import { OnboardingSection } from "./sections/OnboardingSection.js";
import { WhisperSection } from "./sections/WhisperSection.js";
import { PairedDevicesSection } from "./sections/PairedDevicesSection.js";
import { PhoneLinkSection } from "./sections/PhoneLinkSection.js";
import { ConnectorsSection } from "./sections/ConnectorsSection.js";
import { IdeSection } from "./sections/IdeSection.js";
import { SkillsSection } from "./sections/SkillsSection.js";
import { SyncSection } from "./sections/SyncSection.js";
import { AutomationSection } from "./sections/AutomationSection.js";
import { VoiceSection } from "./sections/VoiceSection.js";
import { TransferSection } from "./sections/TransferSection.js";
import { AppearanceSection } from "./sections/AppearanceSection.js";
import { EditorSection } from "./sections/EditorSection.js";
import { WorkspaceSection } from "./sections/WorkspaceSection.js";
import type { IdeSettings, SttSettings, SyncSettings, WhisperSettings } from "../types.js";
import { useI18n, type MessageKey } from "../i18n/index.js";
import { useGatewayLanUrl } from "../boot/bootStore.js";

export type SettingsSection =
  | "onboarding"
  | "general"
  | "appearance"
  | "editor"
  | "workspace"
  | "agent"
  | "providers"
  | "mcp"
  | "cliAgents"
  | "channels"
  | "voice"
  | "devices"
  | "phone"
  | "connectors"
  | "ide"
  | "skills"
  | "sync"
  | "automation"
  | "transfer";

type Entry = { id: SettingsSection; label: MessageKey };
const entry = (id: SettingsSection): Entry => ({ id, label: `set.nav.${id}` as MessageKey });

const GROUPS: Array<{ label: MessageKey; sections: Entry[] }> = [
  { label: "set.group.app", sections: (["general", "appearance", "editor", "ide"] as const).map(entry) },
  { label: "set.group.ai", sections: (["providers", "agent", "cliAgents", "mcp", "skills", "voice"] as const).map(entry) },
  { label: "set.group.devices", sections: (["phone", "devices", "channels"] as const).map(entry) },
  { label: "set.group.project", sections: (["workspace", "sync", "connectors", "automation"] as const).map(entry) },
  { label: "set.group.system", sections: (["onboarding", "transfer"] as const).map(entry) },
];

/** How long typing must pause before a field is written. */
const SAVE_DELAY_MS = 700;

type Props = {
  onClose: () => void;
  /** Jumps straight to a section instead of "general" — e.g. the title bar's IDE button opening Settings pre-scrolled to "ide" when no IDE is configured yet. */
  initialSection?: SettingsSection;
};

export function SettingsView({ onClose, initialSection }: Props) {
  const gatewayLanUrl = useGatewayLanUrl();
  const { t } = useI18n();
  const { call } = useGateway();
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
  // null until the Providers view first asks: listing models reaches each provider's host,
  // and an unreachable one (e.g. Ollama) would hold back the whole modal.
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const providersRequested = useRef(false);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([]);
  const [section, setSection] = useState<SettingsSection>(initialSection ?? "general");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyEdits, setApiKeyEdits] = useState<Record<string, string>>({});
  // Providers as last loaded/saved — the save sends only what changed against this, since
  // providers save to the global file shared by every project and the TUI.
  const [loadedProviders, setLoadedProviders] = useState<ConfigShape["providers"]>({});
  const [providerSources, setProviderSources] = useState<ProviderSources>({});
  const [providerProjectOnly, setProviderProjectOnly] = useState<Record<string, boolean>>({});
  const [mcpSecretEdits, setMcpSecretEdits] = useState<Record<string, string>>({});
  // Each part as last loaded or written; null = take the next render as that.
  const [savedParts, setSavedParts] = useState<SettingsParts | null>(null);
  // Set when closing failed to write something: ask before losing it.
  const [confirmClose, setConfirmClose] = useState(false);
  // Whisper/STT settings don't go through the gateway's config.patch — they're
  // local-only (Electron IPC, desktop-settings.json), same pattern app-avatar
  // uses. Loaded and saved alongside config here.
  const [whisperSettings, setWhisperSettings] = useState<WhisperSettings | null>(null);
  const [sttSettings, setSttSettings] = useState<SttSettings | null>(null);
  // Local-only (Electron IPC, desktop-settings.json), same non-gateway
  // pattern as whisper/stt above — see main/ideSettings.ts.
  const [ideSettings, setIdeSettings] = useState<IdeSettings | null>(null);
  // Same local-only pattern as ideSettings above — see main/syncSettings.ts.
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);

  const load = useCallback(async () => {
    try {
      const [cfg, h, m, whisper, stt, ide, sync] = await Promise.all([
        call<ConfigGetResult>("config.get"),
        call<{ harnesses: HarnessInfo[] }>("harnesses.list"),
        call<{ servers: McpServerStatus[] }>("mcp.status").catch(() => ({ servers: [] })),
        window.yggdrasil.whisper.getSettings(),
        window.yggdrasil.stt.getSettings(),
        window.yggdrasil.ide.getSettings(),
        window.yggdrasil.sync.getSettings(),
      ]);
      setConfig(cfg.config);
      setLoadedProviders(cfg.config.providers ?? {});
      setProviderSources(cfg.providerSources ?? {});
      setHarnesses(h.harnesses ?? []);
      setMcpStatus(m.servers ?? []);
      setWhisperSettings(whisper);
      setSttSettings(stt);
      setIdeSettings(ide);
      setSyncSettings(sync);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (section !== "providers" || providers !== null || providersRequested.current) return;
    providersRequested.current = true;
    setProvidersError(null);
    call<{ providers: ProviderInfo[] }>("providers.list")
      .then((p) => setProviders(p.providers ?? []))
      .catch((err) => setProvidersError(err instanceof Error ? err.message : String(err)))
      // Cleared so that coming back to the view retries after a failure.
      .finally(() => (providersRequested.current = false));
  }, [section, providers, call]);

  // An import writes to disk behind the form: read it all again, or the next save would put the old values back.
  const reloadAfterImport = async () => {
    setError(null);
    await load();
    // Fetched again when the Providers view is next opened.
    setProviders(null);
    setApiKeyEdits({});
    setMcpSecretEdits({});
    setProviderProjectOnly({});
    setSavedParts(null);
  };

  const form: SettingsForm = {
    config,
    loadedProviders,
    apiKeyEdits,
    mcpSecretEdits,
    whisper: whisperSettings,
    stt: sttSettings,
    ide: ideSettings,
    sync: syncSettings,
  };
  const parts = settingsParts(form);
  const loaded = !!(config && whisperSettings && sttSettings && ideSettings && syncSettings);
  useEffect(() => {
    if (loaded && savedParts === null) setSavedParts(parts);
  }, [loaded, savedParts, parts]);

  // Read by the queued save, which may run after later renders.
  const formRef = useRef(form);
  formRef.current = form;
  const projectOnlyRef = useRef(providerProjectOnly);
  projectOnlyRef.current = providerProjectOnly;
  const savedRef = useRef(savedParts);
  savedRef.current = savedParts;
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));

  const markSaved = (part: SettingsPart, value: string) => {
    if (savedRef.current) savedRef.current = { ...savedRef.current, [part]: value };
    setSavedParts((prev) => (prev ? { ...prev, [part]: value } : prev));
  };

  const writePart = async (part: SettingsPart): Promise<void> => {
    const f = formRef.current;
    const value = settingsParts(f)[part];
    const cfg = f.config!;
    const patched = (res: ConfigPatchResult) => {
      if (res.requiresRestart) setRequiresRestart(true);
    };
    switch (part) {
      case "general":
        patched(await call<ConfigPatchResult>("config.patch", { language: cfg.language, harness: cfg.harness, channels: cfg.channels }));
        break;
      case "whisper":
        await window.yggdrasil.whisper.saveSettings(f.whisper!);
        break;
      case "stt":
        await window.yggdrasil.stt.saveSettings(f.stt!);
        break;
      case "ide":
        await window.yggdrasil.ide.saveSettings(f.ide!);
        break;
      case "sync":
        await window.yggdrasil.sync.saveSettings(f.sync!);
        break;
      case "providers": {
        const edits = splitProvidersPatch(buildProvidersPatch(cfg, f.loadedProviders, f.apiKeyEdits), projectOnlyRef.current);
        if (Object.keys(edits.global).length > 0) patched(await call<ConfigPatchResult>("config.patch", { providers: edits.global }));
        if (Object.keys(edits.project).length > 0) {
          patched(await call<ConfigPatchResult>("config.patch", { providersScope: "project", providers: edits.project }));
        }
        const fresh = await call<ConfigGetResult>("config.get");
        setConfig((prev) => (prev ? { ...prev, providers: fresh.config.providers } : prev));
        setLoadedProviders(fresh.config.providers ?? {});
        setProviderSources(fresh.providerSources ?? {});
        // Keys typed while this was being written stay pending.
        setApiKeyEdits((now) => Object.fromEntries(Object.entries(now).filter(([id, key]) => f.apiKeyEdits[id] !== key)));
        markSaved(part, NO_PROVIDER_EDITS);
        const list = await call<{ providers: ProviderInfo[] }>("providers.list");
        setProviders(list.providers ?? []);
        return;
      }
      case "mcp": {
        const incomplete = incompleteMcpServers(cfg.mcpServers);
        if (incomplete.length > 0) throw new Error(t("set.mcp.incomplete", { ids: incomplete.join(", ") }));
        patched(await call<ConfigPatchResult>("config.patch", { mcpServers: buildMcpServersPatch(cfg, f.mcpSecretEdits) }));
        const fresh = (await call<ConfigGetResult>("config.get")).config.mcpServers;
        // Take the stored form (secrets masked) unless the person kept editing.
        const untouched = JSON.stringify(formRef.current.config?.mcpServers) === JSON.stringify(cfg.mcpServers);
        if (untouched) setConfig((prev) => (prev ? { ...prev, mcpServers: fresh } : prev));
        setMcpSecretEdits((now) => Object.fromEntries(Object.entries(now).filter(([id, raw]) => f.mcpSecretEdits[id] !== raw)));
        markSaved(part, mcpPart(untouched ? fresh : cfg.mcpServers, {}));
        // Apply live (connect new or changed, drop removed), no restart.
        await call("mcp.reload").catch(() => undefined);
        const m = await call<{ servers: McpServerStatus[] }>("mcp.status").catch(() => ({ servers: [] }));
        setMcpStatus(m.servers ?? []);
        return;
      }
    }
    markSaved(part, value);
  };

  /** Writes whatever changed among `among`, one save at a time. False if something failed. */
  const flush = (among: SettingsPart[]): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      const saved = savedRef.current;
      if (!saved || !formRef.current.config) return true;
      const pending = changedParts(saved, settingsParts(formRef.current), among);
      if (pending.length === 0) return true;
      setStatus("saving");
      setError(null);
      // A part that fails must not keep the others from being written.
      const failures: string[] = [];
      for (const part of pending) {
        try {
          await writePart(part);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
      setStatus(failures.length > 0 ? "idle" : "saved");
      if (failures.length > 0) setError(failures.join(" · "));
      return failures.length === 0;
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  };

  const typingPending = savedParts ? changedParts(savedParts, parts, TYPING_PARTS).map((p) => parts[p]).join("\n") : "";
  useEffect(() => {
    if (!typingPending) return;
    const timer = setTimeout(() => void flush(TYPING_PARTS), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // Restarted by each further change; `flush` reads the latest form itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typingPending]);
  const deferredPending = !!savedParts && changedParts(savedParts, parts, DEFERRED_PARTS).length > 0;

  const goTo = (next: SettingsSection) => {
    if (next === section) return;
    setSection(next);
    void flush(DEFERRED_PARTS);
  };

  const requestClose = () => {
    void flush(ALL_PARTS).then((ok) => (ok ? onClose() : setConfirmClose(true)));
  };

  // Servers connect in the background, so keep refreshing while any is still
  // coming up instead of showing a stale "connecting".
  const anyConnecting = mcpStatus.some((s) => s.state === "connecting");
  useEffect(() => {
    if (!anyConnecting) return;
    const timer = setInterval(() => {
      call<{ servers: McpServerStatus[] }>("mcp.status")
        .then((m) => setMcpStatus(m.servers ?? []))
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [anyConnecting, call]);

  const mcpAction = async (method: "mcp.reconnect" | "mcp.disconnect", serverId: string) => {
    // Reconnect what is on screen, not the last written version.
    if (!(await flush(["mcp"]))) return;
    setError(null);
    // Mark it connecting right away; the reconnect call itself only returns once it settles.
    if (method === "mcp.reconnect") {
      setMcpStatus((cur) => cur.map((s) => (s.id === serverId ? { ...s, state: "connecting", connected: false } : s)));
    }
    try {
      const m = await call<{ servers: McpServerStatus[] }>(method, { serverId });
      setMcpStatus(m.servers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!config) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          {error ? <p className="error">{error}</p> : <p className="muted">{t("ui.loading")}</p>}
        </div>
      </div>
    );
  }

  // Try the server as it is in the form (unsaved edits included); blank secrets fall back to the saved ones server-side.
  const mcpTest = (serverId: string): Promise<McpTestResult> => {
    const server = buildMcpServersPatch(config, mcpSecretEdits)[serverId];
    return call<McpTestResult>("mcp.test", { serverId, server });
  };

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal settings-view" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("set.title")}</h2>
          <button type="button" className="icon-btn" onClick={requestClose}>
            <XMarkIcon className="hero-icon" />
          </button>
        </div>
        {requiresRestart && <p className="banner">{t("set.savedRestart")}</p>}
        {error && <p className="error">{error}</p>}

        <div className="settings-body">
          <nav className="settings-nav">
            {GROUPS.map((group) => (
              <div key={group.label} className="settings-nav-group" role="group" aria-label={t(group.label)}>
                <span className="settings-nav-heading" aria-hidden="true">
                  {t(group.label)}
                </span>
                {group.sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`settings-nav-item ${section === s.id ? "active" : ""}`}
                    aria-current={section === s.id ? "page" : undefined}
                    onClick={() => goTo(s.id)}
                  >
                    {t(s.label)}
                  </button>
                ))}
              </div>
            ))}
            <span className="settings-nav-version">
              Yggdrasil v{__APP_VERSION__}
              <span className="settings-gateway-url" title={gatewayLanUrl ?? undefined}>
                Gateway: {gatewayLanUrl}
              </span>
            </span>
          </nav>

          <div className="settings-panel">
            {section === "general" && <GeneralSection config={config} setConfig={setConfig} />}
            {section === "appearance" && <AppearanceSection />}
            {section === "editor" && <EditorSection />}
            {section === "workspace" && <WorkspaceSection />}
            {section === "agent" && <AgentSection config={config} setConfig={setConfig} providers={providers ?? []} onGoToProviders={() => goTo("providers")} />}
            {section === "providers" &&
              !providers &&
              (providersError ? <p className="error">{providersError}</p> : <p className="muted">{t("ui.loading")}</p>)}
            {section === "providers" && providers && (
              <ProvidersSection
                config={config}
                setConfig={setConfig}
                providers={providers}
                apiKeyEdits={apiKeyEdits}
                setApiKeyEdits={setApiKeyEdits}
                onProvidersChanged={setProviders}
                loadedProviders={loadedProviders}
                setLoadedProviders={setLoadedProviders}
                providerSources={providerSources}
                setProviderSources={setProviderSources}
                projectOnly={providerProjectOnly}
                setProjectOnly={setProviderProjectOnly}
              />
            )}
            {section === "onboarding" && <OnboardingSection />}
            {section === "mcp" && (
              <McpSection
                config={config}
                setConfig={setConfig}
                mcpStatus={mcpStatus}
                onMcpAction={mcpAction}
                onMcpTest={mcpTest}
                mcpSecretEdits={mcpSecretEdits}
                setMcpSecretEdits={setMcpSecretEdits}
              />
            )}
            {section === "cliAgents" && (
              <>
                <CliAgentsSection />
                <HarnessSection config={config} setConfig={setConfig} harnesses={harnesses} />
              </>
            )}
            {section === "channels" && <ChannelsSection config={config} setConfig={setConfig} />}
            {section === "voice" && whisperSettings && sttSettings && (
              <>
                <WhisperSection
                  settings={whisperSettings}
                  setSettings={setWhisperSettings}
                  sttSettings={sttSettings}
                  setSttSettings={setSttSettings}
                />
                <VoiceSection />
              </>
            )}
            {section === "devices" && <PairedDevicesSection />}
            {section === "phone" && <PhoneLinkSection />}
            {section === "connectors" && <ConnectorsSection />}
            {section === "sync" && syncSettings && (
              <SyncSection syncSettings={syncSettings} setSyncSettings={setSyncSettings} />
            )}
            {section === "ide" && ideSettings && (
              <IdeSection ideSettings={ideSettings} setIdeSettings={setIdeSettings} />
            )}
            {section === "skills" && <SkillsSection />}
            {section === "automation" && <AutomationSection />}
            {section === "transfer" && <TransferSection beforeImport={() => flush(ALL_PARTS)} onImported={reloadAfterImport} />}
          </div>
        </div>

        {confirmClose ? (
          <div className="agent-form-actions settings-unsaved" role="alertdialog" aria-label={t("set.unsaved.message")}>
            <span>{t("set.unsaved.message")}</span>
            <button type="button" autoFocus onClick={() => setConfirmClose(false)}>
              {t("set.unsaved.keep")}
            </button>
            <button type="button" onClick={onClose}>
              {t("set.unsaved.discard")}
            </button>
          </div>
        ) : (
          <div className="agent-form-actions settings-unsaved">
            <span className="muted" role="status">
              {section === "phone"
                ? t("set.autosave.phone")
                : status === "saving"
                ? t("set.autosave.saving")
                : deferredPending
                  ? t("set.autosave.onLeave")
                  : status === "saved"
                    ? t("set.autosave.saved")
                    : t("set.autosave.idle")}
            </span>
            <button type="button" onClick={requestClose}>
              {t("ui.close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
