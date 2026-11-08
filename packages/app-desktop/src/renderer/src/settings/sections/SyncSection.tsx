import { useState } from "react";
import { useI18n } from "../../i18n/index.js";
import type { MyShareSummary, PluginScope, ResourceRef, SyncSettings } from "../../types.js";

type Props = {
  syncSettings: SyncSettings;
  setSyncSettings: (settings: SyncSettings) => void;
};

type JoinKind = "notes-file" | "plugin-storage-key";

/**
 * Server URL for the deployed @yggdrasil/sync-server, plus the
 * "Unirse a un recurso compartido" flow: paste an invite code, decide where
 * it lands locally (a notes/ file or a plugin's storage key), and attach it
 * — see main/syncEngine.ts's redeemInviteAndAttach. The owner-side "Compartir…"
 * action lives next to the resource itself (FileTreeContextMenu for notes,
 * PluginContextMenu for a plugin like kanban), not here.
 */
export function SyncSection({ syncSettings, setSyncSettings }: Props) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [memberName, setMemberName] = useState("");
  const [kind, setKind] = useState<JoinKind>("notes-file");
  const [relativePath, setRelativePath] = useState("");
  const [pluginScope, setPluginScope] = useState<PluginScope>("global");
  const [pluginId, setPluginId] = useState("kanban");
  const [storageKey, setStorageKey] = useState(`kanban_board_${window.yggdrasil.projectId ?? ""}`);
  const [joinResult, setJoinResult] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const [shares, setShares] = useState<MyShareSummary[] | null>(null);
  const [sharesError, setSharesError] = useState<string | null>(null);

  const loadShares = async () => {
    setSharesError(null);
    try {
      setShares(await window.yggdrasil.sync.listMyShares());
    } catch (err) {
      setSharesError(err instanceof Error ? err.message : String(err));
    }
  };

  const join = async () => {
    setJoining(true);
    setJoinError(null);
    setJoinResult(null);
    try {
      const projectId = window.yggdrasil.projectId ?? "";
      const ref: ResourceRef =
        kind === "notes-file"
          ? { resourceType: "notes-file", projectId, relativePath }
          : { resourceType: "plugin-storage-key", projectId, scope: pluginScope, pluginId, storageKey };
      await window.yggdrasil.sync.redeemInvite(code.trim(), memberName.trim(), ref);
      setJoinResult(kind === "notes-file" ? t("set.sync.joinedNote", { path: relativePath }) : t("set.sync.joinedBoard", { id: pluginId }));
      setCode("");
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoining(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>{t("set.sync.title")}</h3>
      <p className="muted">
        {t("set.sync.intro")}
      </p>

      <label>
        {t("set.sync.serverUrl")}
        <input
          type="text"
          value={syncSettings.serverUrl ?? ""}
          onChange={(e) => setSyncSettings({ ...syncSettings, serverUrl: e.target.value.trim() })}
          placeholder={t("set.sync.serverUrlPh")}
        />
      </label>

      <label>
        {t("set.sync.yourName")}
        <input
          type="text"
          value={syncSettings.ownerName ?? ""}
          onChange={(e) => setSyncSettings({ ...syncSettings, ownerName: e.target.value })}
          placeholder={t("set.sync.yourNamePh")}
        />
      </label>

      <h4>{t("set.sync.joinTitle")}</h4>
      <p className="muted">
        {t("set.sync.joinIntro")}
      </p>

      <div className="ide-option-row">
        <label>
          <input type="radio" name="join-kind" checked={kind === "notes-file"} onChange={() => setKind("notes-file")} />
          {t("set.sync.kindNote")}
        </label>
        <label>
          <input
            type="radio"
            name="join-kind"
            checked={kind === "plugin-storage-key"}
            onChange={() => setKind("plugin-storage-key")}
          />
          {t("set.sync.kindBoard")}
        </label>
      </div>

      {kind === "notes-file" ? (
        <label>
          {t("set.sync.saveAs")}
          <input
            type="text"
            value={relativePath}
            onChange={(e) => setRelativePath(e.target.value)}
            placeholder="roadmap.md"
          />
        </label>
      ) : (
        <>
          <label>
            {t("set.sync.scope")}
            <select value={pluginScope} onChange={(e) => setPluginScope(e.target.value as PluginScope)}>
              <option value="global">{t("set.sync.scopeGlobal")}</option>
              <option value="project">{t("set.sync.scopeProject")}</option>
            </select>
          </label>
          <label>
            {t("set.sync.pluginId")}
            <input type="text" value={pluginId} onChange={(e) => setPluginId(e.target.value)} placeholder="kanban" />
          </label>
          <label>
            Storage key
            <input type="text" value={storageKey} onChange={(e) => setStorageKey(e.target.value)} />
          </label>
        </>
      )}

      <label>
        {t("set.sync.inviteCode")}
        <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("set.sync.inviteCodePh")} />
      </label>
      <label>
        {t("set.sync.memberName")}
        <input type="text" value={memberName} onChange={(e) => setMemberName(e.target.value)} />
      </label>

      <button
        type="button"
        disabled={joining || !code.trim() || !memberName.trim() || (kind === "notes-file" ? !relativePath.trim() : !pluginId.trim() || !storageKey.trim())}
        onClick={() => void join()}
      >
        {joining ? t("set.sync.joining") : t("set.sync.join")}
      </button>
      {joinResult && <p className="ok">{joinResult}</p>}
      {joinError && <p className="error">{joinError}</p>}

      <h4>{t("set.sync.mine")}</h4>
      <button type="button" onClick={() => void loadShares()}>
        {shares === null ? t("set.sync.load") : t("set.sync.refresh")}
      </button>
      {sharesError && <p className="error">{sharesError}</p>}
      {shares && shares.length === 0 && <p className="muted">{t("set.sync.none")}</p>}
      {shares && shares.length > 0 && (
        <ul className="sync-share-list">
          {shares.map((s) => (
            <li key={s.id}>
              <code>{s.resourceKey}</code> —{" "}
              {t("set.sync.shareMeta", {
                type: s.resourceType === "notes-file" ? t("set.sync.typeNote") : t("set.sync.typePlugin"),
                version: s.version,
                members: t(s.memberCount === 1 ? "set.sync.memberOne" : "set.sync.memberMany", { count: s.memberCount }),
                role: s.role,
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
