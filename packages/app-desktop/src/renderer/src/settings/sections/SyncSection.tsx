import { useState } from "react";
import type { MyShareSummary, PluginScope, ResourceRef, SyncSettings } from "../../types.js";

type Props = {
  syncSettings: SyncSettings;
  setSyncSettings: (settings: SyncSettings) => void;
};

type JoinKind = "notes-file" | "plugin-storage-key";

/**
 * Server URL for the deployed @yggdrasil/sync-server (Railway), plus the
 * "Unirse a un recurso compartido" flow: paste an invite code, decide where
 * it lands locally (a notes/ file or a plugin's storage key), and attach it
 * — see main/syncEngine.ts's redeemInviteAndAttach. The owner-side "Compartir…"
 * action lives next to the resource itself (FileTreeContextMenu for notes,
 * PluginContextMenu for a plugin like kanban), not here.
 */
export function SyncSection({ syncSettings, setSyncSettings }: Props) {
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
      setJoinResult(kind === "notes-file" ? `Listo — "${relativePath}" sincronizado.` : `Listo — tablero "${pluginId}" sincronizado.`);
      setCode("");
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoining(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>Compartir (sync)</h3>
      <p className="muted">
        Comparte notas específicas o el storage de un plugin (ej. un tablero kanban) con hasta unas pocas personas
        de confianza, vía un servidor propio. Async — cada quien edita por turnos, sin edición simultánea en
        tiempo real.
      </p>

      <label>
        URL del servidor de sync
        <input
          type="text"
          value={syncSettings.serverUrl ?? ""}
          onChange={(e) => setSyncSettings({ ...syncSettings, serverUrl: e.target.value.trim() })}
          placeholder="https://tu-servidor.up.railway.app"
        />
      </label>

      <label>
        Tu nombre (se muestra a quien invites)
        <input
          type="text"
          value={syncSettings.ownerName ?? ""}
          onChange={(e) => setSyncSettings({ ...syncSettings, ownerName: e.target.value })}
          placeholder="ej. Alex"
        />
      </label>

      <h4>Unirse a un recurso compartido</h4>
      <p className="muted">
        Pega el código de invitación que te compartieron. Tenés que saber si es una nota o un tablero de plugin —
        te lo dice quien te invitó.
      </p>

      <div className="ide-option-row">
        <label>
          <input type="radio" name="join-kind" checked={kind === "notes-file"} onChange={() => setKind("notes-file")} />
          Es una nota
        </label>
        <label>
          <input
            type="radio"
            name="join-kind"
            checked={kind === "plugin-storage-key"}
            onChange={() => setKind("plugin-storage-key")}
          />
          Es un tablero de plugin
        </label>
      </div>

      {kind === "notes-file" ? (
        <label>
          Guardar como (ruta relativa dentro de notes/)
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
            Alcance
            <select value={pluginScope} onChange={(e) => setPluginScope(e.target.value as PluginScope)}>
              <option value="global">Global</option>
              <option value="project">Este proyecto</option>
            </select>
          </label>
          <label>
            Id del plugin
            <input type="text" value={pluginId} onChange={(e) => setPluginId(e.target.value)} placeholder="kanban" />
          </label>
          <label>
            Storage key
            <input type="text" value={storageKey} onChange={(e) => setStorageKey(e.target.value)} />
          </label>
        </>
      )}

      <label>
        Código de invitación
        <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="pegá el código acá" />
      </label>
      <label>
        Tu nombre para este recurso
        <input type="text" value={memberName} onChange={(e) => setMemberName(e.target.value)} />
      </label>

      <button
        type="button"
        disabled={joining || !code.trim() || !memberName.trim() || (kind === "notes-file" ? !relativePath.trim() : !pluginId.trim() || !storageKey.trim())}
        onClick={() => void join()}
      >
        {joining ? "Uniendo…" : "Unirse"}
      </button>
      {joinResult && <p className="ok">{joinResult}</p>}
      {joinError && <p className="error">{joinError}</p>}

      <h4>Mis recursos compartidos</h4>
      <button type="button" onClick={() => void loadShares()}>
        {shares === null ? "Cargar" : "Refrescar"}
      </button>
      {sharesError && <p className="error">{sharesError}</p>}
      {shares && shares.length === 0 && <p className="muted">Todavía no compartiste nada.</p>}
      {shares && shares.length > 0 && (
        <ul className="sync-share-list">
          {shares.map((s) => (
            <li key={s.id}>
              <code>{s.resourceKey}</code> — {s.resourceType === "notes-file" ? "nota" : "plugin"}, v{s.version}, {s.memberCount}{" "}
              miembro{s.memberCount === 1 ? "" : "s"}, rol {s.role}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
