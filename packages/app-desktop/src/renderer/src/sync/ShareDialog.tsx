import { useEffect, useState } from "react";
import { TrashIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useI18n } from "../i18n/index.js";
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
  const { t } = useI18n();
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
    if (!window.confirm(t("share.confirmRevoke", { who: member.email ?? member.name }))) return;
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
          <button type="button" className="icon-btn" onClick={onClose} title={t("share.close")}>
            <XMarkIcon className="hero-icon" />
          </button>
        </div>

        {status === null && !error && <p className="muted">{t("share.loading")}</p>}
        {error && <p className="error">{error}</p>}

        {status && !status.shared && (
          <>
            <p className="muted">{t("share.notShared")}</p>
            <button type="button" className="share-btn share-btn-primary share-btn-full" disabled={busy} onClick={() => void share()}>
              {busy ? t("share.sharing") : t("share.shareWithTeam")}
            </button>
          </>
        )}

        {status && status.shared && (
          <>
            <div className="share-status-row">
              <span className="share-status-badge">v{status.localVersion}</span>
              <span>{status.role === "edit" ? t("share.roleEditor") : t("share.roleReadOnly")}</span>
              {status.conflict && <span className="share-status-conflict">{t("share.conflictBadge")}</span>}
            </div>

            {status.conflict && (
              <div className="share-conflict-banner">
                <p>{t("share.conflictBanner")}</p>
                <div className="share-conflict-actions">
                  <button type="button" className="share-btn" disabled={busy} onClick={() => void resolve("keep-mine")}>
                    {t("share.keepMine")}
                  </button>
                  <button type="button" className="share-btn" disabled={busy} onClick={() => void resolve("take-theirs")}>
                    {t("share.takeTheirs")}
                  </button>
                </div>
              </div>
            )}

            <button type="button" className="share-btn" disabled={busy} onClick={() => void refresh()}>
              {busy ? t("share.updating") : t("share.refresh")}
            </button>

            <section className="share-section">
              <h3 className="share-section-title">{t("share.inviteTitle")}</h3>
              <div className="agent-form">
                <label>
                  {t("share.role")}
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as SharedResourceRole)}>
                    <option value="edit">{t("share.canEdit")}</option>
                    <option value="view">{t("share.readOnly")}</option>
                  </select>
                </label>
                <button type="button" className="share-btn" disabled={busy} onClick={() => void invite()}>
                  {busy ? t("share.generating") : t("share.generateInvite")}
                </button>
              </div>

              {inviteCode && (
                <div className="input-with-button" style={{ marginTop: 10 }}>
                  <input type="text" readOnly value={inviteCode} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="share-btn" onClick={() => void copyCode()}>
                    {copied ? t("share.copied") : t("share.copy")}
                  </button>
                </div>
              )}
            </section>

            {status.isOwner && (
              <>
                <section className="share-section">
                  <h3 className="share-section-title">{t("share.webTitle")}</h3>
                  <p className="share-section-hint">
                    {t("share.webHint")}
                  </p>
                  <div className="agent-form">
                    <label>
                      {t("share.personEmail")}
                      <input
                        type="email"
                        value={webEmail}
                        onChange={(e) => setWebEmail(e.target.value)}
                        placeholder={t("share.emailPlaceholder")}
                      />
                    </label>
                    <label>
                      {t("share.role")}
                      <select value={webRole} onChange={(e) => setWebRole(e.target.value as SharedResourceRole)}>
                        <option value="edit">{t("share.canEdit")}</option>
                        <option value="view">{t("share.readOnly")}</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="share-btn share-btn-primary"
                      disabled={busy || !/^[^\s@]+@[^\s@]+$/.test(webEmail.trim())}
                      onClick={() => void createWebLink()}
                    >
                      {busy ? t("share.creating") : t("share.createWebLink")}
                    </button>
                  </div>

                  {webLink && (
                    <div className="share-link-reveal">
                      <p>
                        {t("share.linkForPre")}<strong>{webLink.email}</strong>{t("share.linkForPost")}
                      </p>
                      <div className="input-with-button">
                        <input type="text" readOnly value={webLink.url} onFocus={(e) => e.currentTarget.select()} />
                        <button type="button" className="share-btn" onClick={() => void copyWebLink()}>
                          {webCopied ? t("share.copied") : t("share.copy")}
                        </button>
                      </div>
                    </div>
                  )}

                  {resourceRef.resourceType === "plugin-storage-key" && (
                    <button type="button" className="share-btn share-btn-full" disabled={busy} onClick={() => void refreshBundle()}>
                      {bundleRefreshed ? t("share.bundleRefreshed") : t("share.refreshBundle")}
                    </button>
                  )}
                </section>

                <section className="share-section">
                  <h3 className="share-section-title">{t("share.whoHasAccess")}</h3>
                  {members === null && <p className="muted">{t("share.loading")}</p>}
                  {members && members.length === 0 && <p className="muted">{t("share.nobody")}</p>}
                  {members && members.length > 0 && (
                    <ul className="member-list">
                      {members.map((m) => (
                        <li key={m.keyHash} className="member-row">
                          <div className="member-row-info">
                            <span className="member-row-name">{m.email ?? m.name}</span>
                            <span className="member-row-meta">
                              {m.kind === "web" ? t("share.kindWeb") : t("share.kindApp")} · {m.role === "edit" ? t("share.memberCanEdit") : t("share.memberReadOnly")}
                            </span>
                          </div>
                          <button type="button" className="icon-btn" disabled={busy} title={t("share.removeAccess")} onClick={() => revoke(m)}>
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
            {t("share.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
