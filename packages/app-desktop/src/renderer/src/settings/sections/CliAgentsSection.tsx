import { useEffect, useState } from "react";
import type { ClaudePaneSettings, UserMcpServer } from "../../types.js";
import { UserMcpPicker } from "../UserMcpPicker.js";
import { useI18n } from "../../i18n/index.js";

/**
 * Settings -> Agent CLIs: how every `claude` pane the app opens starts
 * (main/claudePaneSettings.ts). Like Appearance/Editor these save right away
 * and aren't part of "Save settings"; they apply to panes opened afterwards.
 */
export function CliAgentsSection() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<ClaudePaneSettings | null>(null);
  const [cavemanInstalled, setCavemanInstalled] = useState(false);
  const [userMcpServers, setUserMcpServers] = useState<UserMcpServer[]>([]);
  const [extraDraft, setExtraDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.yggdrasil.claudePaneSettings.get().then((r) => {
      setSettings(r.settings);
      setCavemanInstalled(r.cavemanInstalled);
      setUserMcpServers(r.userMcpServers);
      setExtraDraft(r.settings.extraSettings);
      setModelDraft(r.settings.advisorModel);
    });
  }, []);

  if (!settings) return <section className="settings-section" />;

  const save = async (patch: Partial<ClaudePaneSettings>) => {
    const next = { ...settings, ...patch };
    try {
      const result = await window.yggdrasil.claudePaneSettings.set(next);
      setSettings(result);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      // Electron prefixes the main-process message ("Error invoking remote method ...: Error: <msg>").
      const message = e instanceof Error ? e.message : String(e);
      setError(message.replace(/^.*?Error: /, ""));
    }
  };

  return (
    <section className="settings-section">
      <h3>{t("set.cliAgents.title")}</h3>
      <p className="muted">{t("set.cliAgents.intro")}</p>

      <h4>Claude Code</h4>

      {cavemanInstalled ? (
        <>
          <label>
            {t("set.cliAgents.caveman")}
            <select
              value={settings.caveman}
              onChange={(e) => void save({ caveman: e.target.value as ClaudePaneSettings["caveman"] })}
            >
              <option value="inherit">{t("set.cliAgents.inherit")}</option>
              <option value="full">full</option>
              <option value="lite">lite</option>
              <option value="ultra">ultra</option>
              <option value="off">{t("set.cliAgents.off")}</option>
            </select>
          </label>
          <p className="muted">{t("set.cliAgents.cavemanHelp")}</p>
        </>
      ) : (
        <p className="muted">{t("set.cliAgents.cavemanMissing")}</p>
      )}

      <label>
        {t("set.cliAgents.advisor")}
        <select
          value={settings.advisor}
          onChange={(e) => {
            const advisor = e.target.value as ClaudePaneSettings["advisor"];
            // "model" with no model yet stays local until one is typed (main would reset it to inherit).
            if (advisor === "model" && !modelDraft.trim()) setSettings({ ...settings, advisor });
            else void save({ advisor, advisorModel: modelDraft.trim() });
          }}
        >
          <option value="inherit">{t("set.cliAgents.inherit")}</option>
          <option value="off">{t("set.cliAgents.advisorOff")}</option>
          <option value="model">{t("set.cliAgents.advisorModel")}</option>
        </select>
      </label>
      {settings.advisor === "model" && (
        <label>
          {t("set.cliAgents.advisorModelName")}
          <input
            type="text"
            value={modelDraft}
            placeholder="opus"
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => {
              if (modelDraft.trim()) void save({ advisor: "model", advisorModel: modelDraft.trim() });
            }}
          />
        </label>
      )}

      <label>
        {t("set.cliAgents.promptSuggestions")}
        <select
          value={settings.promptSuggestions}
          onChange={(e) => void save({ promptSuggestions: e.target.value as ClaudePaneSettings["promptSuggestions"] })}
        >
          <option value="inherit">{t("set.cliAgents.inherit")}</option>
          <option value="on">{t("set.cliAgents.on")}</option>
          <option value="off">{t("set.cliAgents.off")}</option>
        </select>
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.attention.enabled}
          onChange={(e) => void save({ attention: { ...settings.attention, enabled: e.target.checked } })}
        />
        {t("set.cliAgents.attention")}
      </label>
      <p className="muted">{t("set.cliAgents.attentionHelp")}</p>
      {settings.attention.enabled && (
        <>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settings.attention.notifyWaiting}
              onChange={(e) => void save({ attention: { ...settings.attention, notifyWaiting: e.target.checked } })}
            />
            {t("set.cliAgents.notifyWaiting")}
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settings.attention.notifyDone}
              onChange={(e) => void save({ attention: { ...settings.attention, notifyDone: e.target.checked } })}
            />
            {t("set.cliAgents.notifyDone")}
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settings.attention.holdMessages}
              onChange={(e) => void save({ attention: { ...settings.attention, holdMessages: e.target.checked } })}
            />
            {t("set.cliAgents.holdMessages")}
          </label>
          <p className="muted">{t("set.cliAgents.notifyHelp")}</p>
          <p className="muted">{t("set.cliAgents.holdMessagesHelp")}</p>
        </>
      )}

      <div className="settings-field">
        <span>{t("set.cliAgents.userMcp")}</span>
        <UserMcpPicker
          value={settings.userMcp}
          servers={userMcpServers}
          onChange={(userMcp) => void save({ userMcp: userMcp ?? { mode: "all", allowed: [] } })}
        />
      </div>
      <p className="muted">{t("set.cliAgents.userMcpHelp")}</p>

      <label>
        {t("set.cliAgents.extra")}
        <textarea
          rows={5}
          spellCheck={false}
          value={extraDraft}
          placeholder={'{\n  "alwaysThinkingEnabled": true\n}'}
          onChange={(e) => setExtraDraft(e.target.value)}
          onBlur={() => {
            if (extraDraft !== settings.extraSettings) void save({ extraSettings: extraDraft });
          }}
        />
      </label>
      <p className="muted">{t("set.cliAgents.extraHelp")}</p>

      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="muted">{t("set.cliAgents.saved")}</p>}
    </section>
  );
}
