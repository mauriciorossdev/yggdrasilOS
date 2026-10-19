import { useEffect, useState } from "react";
import { TrashIcon, XMarkIcon } from "@heroicons/react/20/solid";
import type { ResourceRef, ResourceStatus, ShareMember, SharedResourceRole } from "../types.js";

type Props = {
  resourceRef: ResourceRef;
  title: string;
  onClose: () => void;
};

/**
 * Owner-side "Compartir…" flow — reused by FileTreeContextMenu (notes/
 * files) and PluginContextMenu (a plugin's storage key, e.g. kanban's
 * board). Not shared yet → one button creates the share. Already shared →
 * status, invite generation, manual refresh, and conflict resolution. See
 * main/syncEngine.ts for what each action actually does server-side.
 *
 * Every field/list below lives inside `.agent-form`/`.share-section` so it
 * picks up the same dark input/select styling and section rhythm the rest
 * of the app's modals use — a plain `<input>`/`<label>` outside those
 * wrappers renders with unstyled browser chrome, which is what made this
 * dialog look broken before.
 */
export function ShareDialog({ resourceRef, title, onClose }: Props) {
  const [status, setStatus] = useState<ResourceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteRole, setInviteRole] = useState<SharedResourceRole>("edit");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [webEmail, setWebEmail] = useState("");
  const [webRole, setWebRole] = useState<SharedResourceRole>("edit");
  const [webLink, setWebLink] = useState<{ url: string; email: string } | null>(null);
  const [webCopied, setWebCopied] = useState(false);
  const [members, setMembers] = useState<ShareMember[] | null>(null);
  const [bundleRefreshed, setBundleRefreshed] = useState(false);

  const loadMembers = async () => {
    try {
      setMembers(await window.yggdrasil.sync.listMembers(resourceRef));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadStatus = async () => {
    setError(null);
    try {
      const next = await window.yggdrasil.sync.getResourceStatus(resourceRef);
      setStatus(next);
      if (next.shared && next.isOwner) await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const share = () => run(async () => { await window.yggdrasil.sync.createShare(resourceRef); });

  const invite = () =>
    run(async () => {
      const { code } = await window.yggdrasil.sync.createInvite(resourceRef, inviteRole);
      setInviteCode(code);
      setCopied(false);
    });

  const refresh = () => run(async () => { await window.yggdrasil.sync.pull(resourceRef); });

  const resolve = (choice: "keep-mine" | "take-theirs") =>
    run(async () => {
      const result = await window.yggdrasil.sync.resolveConflict(resourceRef, choice);
      if (!result.ok) throw new Error(result.error);
    });

  const createWebLink = () =>
    run(async () => {
      const email = webEmail.trim();
      const { url } = await window.yggdrasil.sync.createWebLink(resourceRef, email, webRole);
      setWebLink({ url, email });
      setWebCopied(false);
      setWebEmail("");
    });

  const revoke = (member: ShareMember) => {
    if (!window.confirm(`¿Quitar el acceso de ${member.email ?? member.name}? Su link o copia dejará de funcionar.`)) return;
    void run(async () => { await window.yggdrasil.sync.revokeMember(resourceRef, member.keyHash); });
  };

  const refreshBundle = () =>
    run(async () => {
      await window.yggdrasil.sync.refreshWebBundle(resourceRef);
      setBundleRefreshed(true);
    });

  const copyWebLink = async () => {
    if (!webLink) return;
    try {
      await navigator.clipboard.writeText(webLink.url);
      setWebCopied(true);
    } catch {
      // Same as copyCode — the link stays visible/selectable.
    }
  };

  const copyCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
    } catch {
      // Clipboard access can fail (permissions, headless test runs) — the code stays visible/selectable either way.
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} title="Cerrar">
            <XMarkIcon className="hero-icon" />
          </button>
        </div>

        {status === null && !error && <p className="muted">Cargando…</p>}
        {error && <p className="error">{error}</p>}

        {status && !status.shared && (
          <>
            <p className="muted">Todavía no se comparte. Un servidor de sync propio (Railway u otro) debe estar configurado en Settings → Compartir.</p>
            <button type="button" className="share-btn share-btn-primary share-btn-full" disabled={busy} onClick={() => void share()}>
              {busy ? "Compartiendo…" : "Compartir con el equipo"}
            </button>
          </>
        )}

        {status && status.shared && (
          <>
            <div className="share-status-row">
              <span className="share-status-badge">v{status.localVersion}</span>
              <span>{status.role === "edit" ? "editor" : "solo lectura"}</span>
              {status.conflict && <span className="share-status-conflict">⚠️ conflicto sin resolver</span>}
            </div>

            {status.conflict && (
              <div className="share-conflict-banner">
                <p>Alguien más subió cambios después de tu última versión local.</p>
                <div className="share-conflict-actions">
                  <button type="button" className="share-btn" disabled={busy} onClick={() => void resolve("keep-mine")}>
                    Mantener el mío
                  </button>
                  <button type="button" className="share-btn" disabled={busy} onClick={() => void resolve("take-theirs")}>
                    Usar el remoto
                  </button>
                </div>
              </div>
            )}

            <button type="button" className="share-btn" disabled={busy} onClick={() => void refresh()}>
              {busy ? "Actualizando…" : "Refrescar desde el servidor"}
            </button>

            <section className="share-section">
              <h3 className="share-section-title">Invitar a alguien</h3>
              <div className="agent-form">
                <label>
                  Rol
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as SharedResourceRole)}>
                    <option value="edit">Puede editar</option>
                    <option value="view">Solo lectura</option>
                  </select>
                </label>
                <button type="button" className="share-btn" disabled={busy} onClick={() => void invite()}>
                  {busy ? "Generando…" : "Generar código de invitación"}
                </button>
              </div>

              {inviteCode && (
                <div className="input-with-button" style={{ marginTop: 10 }}>
                  <input type="text" readOnly value={inviteCode} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="share-btn" onClick={() => void copyCode()}>
                    {copied ? "Copiado" : "Copiar"}
                  </button>
                </div>
              )}
            </section>

            {status.isOwner && (
              <>
                <section className="share-section">
                  <h3 className="share-section-title">Link web (sin Yggdrasil)</h3>
                  <p className="share-section-hint">
                    Para alguien que no usa la app: abre el link en su navegador y, para entrar, debe escribir este mismo
                    correo. Envíale el link tú (WhatsApp, Slack, correo).
                  </p>
                  <div className="agent-form">
                    <label>
                      Correo de la persona
                      <input
                        type="email"
                        value={webEmail}
                        onChange={(e) => setWebEmail(e.target.value)}
                        placeholder="persona@empresa.com"
                      />
                    </label>
                    <label>
                      Rol
                      <select value={webRole} onChange={(e) => setWebRole(e.target.value as SharedResourceRole)}>
                        <option value="edit">Puede editar</option>
                        <option value="view">Solo lectura</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="share-btn share-btn-primary"
                      disabled={busy || !/^[^\s@]+@[^\s@]+$/.test(webEmail.trim())}
                      onClick={() => void createWebLink()}
                    >
                      {busy ? "Creando…" : "Crear link web"}
                    </button>
                  </div>

                  {webLink && (
                    <div className="share-link-reveal">
                      <p>
                        Link para <strong>{webLink.email}</strong> — cópialo ahora, no se vuelve a mostrar:
                      </p>
                      <div className="input-with-button">
                        <input type="text" readOnly value={webLink.url} onFocus={(e) => e.currentTarget.select()} />
                        <button type="button" className="share-btn" onClick={() => void copyWebLink()}>
                          {webCopied ? "Copiado" : "Copiar"}
                        </button>
                      </div>
                    </div>
                  )}

                  {resourceRef.resourceType === "plugin-storage-key" && (
                    <button type="button" className="share-btn share-btn-full" disabled={busy} onClick={() => void refreshBundle()}>
                      {bundleRefreshed ? "App web actualizada" : "Actualizar app web (tras cambiar el complemento)"}
                    </button>
                  )}
                </section>

                <section className="share-section">
                  <h3 className="share-section-title">Quién tiene acceso</h3>
                  {members === null && <p className="muted">Cargando…</p>}
                  {members && members.length === 0 && <p className="muted">Nadie todavía.</p>}
                  {members && members.length > 0 && (
                    <ul className="member-list">
                      {members.map((m) => (
                        <li key={m.keyHash} className="member-row">
                          <div className="member-row-info">
                            <span className="member-row-name">{m.email ?? m.name}</span>
                            <span className="member-row-meta">
                              {m.kind === "web" ? "link web" : "app"} · {m.role === "edit" ? "puede editar" : "solo lectura"}
                            </span>
                          </div>
                          <button type="button" className="icon-btn" disabled={busy} title="Quitar acceso" onClick={() => revoke(m)}>
                            <TrashIcon className="hero-icon" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </>
        )}

        <div className="agent-form-actions">
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
