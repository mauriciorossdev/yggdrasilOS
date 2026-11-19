import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  StarIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import { useI18n } from "../i18n/index.js";
import type { AgentInfo, CreateAgentResult, CustomRole, GetAgentResult, ProviderInfo } from "../types.js";
import { BUILTIN_ROLES, type Role } from "./roles.js";
import { EMPTY_TOOLS_FORM, toolsPayload, toolsToForm, type ToolsFormState } from "./toolsForm.js";

type Props = {
  agents: AgentInfo[];
  onCreated: (agents: AgentInfo[], newAgentId: string) => void;
  onDeleted: (agents: AgentInfo[], deletedId: string) => void;
  defaultAgentId?: string;
  onSetDefault?: (agentId: string) => void;
  onGoToProviders?: () => void;
};

/** "Code Reviewer" → "code-reviewer"; suffixes -2, -3… when the id is taken. */
export function slugifyAgentId(label: string, taken: Set<string>): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

type FormState = {
  id: string;
  label: string;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  scope: "local" | "global";
} & ToolsFormState;

const EMPTY_FORM: FormState = {
  id: "",
  label: "",
  providerId: "",
  modelId: "",
  systemPrompt: "",
  scope: "local",
  ...EMPTY_TOOLS_FORM,
};

/** The agent list and its create/edit form, shown in Settings → Agents. */
export function AgentManager({ agents, onCreated, onDeleted, defaultAgentId, onSetDefault, onGoToProviders }: Props) {
  const { call } = useGateway();
  const { t } = useI18n();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState<string | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [pendingRoleId, setPendingRoleId] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [newRoleLabel, setNewRoleLabel] = useState("");

  const loadProviders = () => {
    setLoadingProviders(true);
    call<{ providers: ProviderInfo[] }>("providers.list")
      .then((res) => setProviders(res.providers ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingProviders(false));
  };

  useEffect(() => {
    loadProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call]);

  useEffect(() => {
    void window.yggdrasil.roles.listCustom().then(setCustomRoles);
  }, []);

  // Ready-to-use connections only (key present, no error); the agent's current one stays
  // listed while editing so an existing agent never shows a blank provider.
  const usableProviders = providers.filter((p) => (p.configured ?? true) && !p.error && p.models.length > 0);
  const providerChoices = providers.filter((p) => usableProviders.includes(p) || p.id === form.providerId);
  const selectedProvider = providers.find((p) => p.id === form.providerId);
  const models = useMemo(() => selectedProvider?.models ?? [], [selectedProvider]);

  // Prefill only — picking a role is a starting point, not a lock. Doesn't
  // live in FormState/get saved with the agent (AgentConfig has no `role`
  // field); the select resets itself right after applying.
  const applyRole = (roleId: string) => {
    const role: Role | undefined = BUILTIN_ROLES.find((r) => r.id === roleId) ?? customRoles.find((r) => r.id === roleId);
    if (!role) return;
    setForm((f) => ({ ...f, label: f.label || (role.labelKey ? t(role.labelKey) : role.label), systemPrompt: role.systemPrompt }));
    setPendingRoleId("");
  };

  const confirmSaveRole = async () => {
    const label = newRoleLabel.trim();
    if (!label || !form.systemPrompt.trim()) return;
    const updated = await window.yggdrasil.roles.saveCustom({ label, systemPrompt: form.systemPrompt });
    setCustomRoles(updated);
    setSavingRole(false);
    setNewRoleLabel("");
  };

  const submit = async () => {
    const name = form.label.trim();
    if (!name) {
      setError(t("agents.manager.idRequired"));
      return;
    }
    // The id is an internal slug: derived from the name on create, fixed afterwards.
    const id = editingId ?? slugifyAgentId(name, new Set(agents.map((a) => a.id)));
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        id,
        label: name,
        provider: form.providerId || undefined,
        model: form.modelId || undefined,
        systemPrompt: form.systemPrompt.trim() || undefined,
        scope: form.scope,
        ...toolsPayload(form, !!editingId),
      };
      await call<CreateAgentResult>(editingId ? "agents.update" : "agents.create", payload);
      const res = await call<{ agents: AgentInfo[] }>("agents.list");
      setForm(EMPTY_FORM);
      setShowForm(false);
      setEditingId(null);
      setPendingRoleId("");
      setSavingRole(false);
      setNewRoleLabel("");
      onCreated(res.agents ?? [], id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = async (a: AgentInfo) => {
    setError(null);
    setLoadingEdit(a.id);
    try {
      const res = await call<GetAgentResult>("agents.get", { id: a.id, scope: a.scope ?? "local" });
      const full = res.agent;
      setForm({
        id: full.id,
        label: full.label ?? "",
        providerId: full.provider ?? "",
        modelId: full.model ?? "",
        systemPrompt: full.systemPrompt ?? "",
        scope: full.scope ?? "local",
        ...toolsToForm(full.tools),
      });
      setEditingId(full.id);
      setShowForm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingEdit(null);
    }
  };

  const deleteAgentConfirm = async (a: AgentInfo) => {
    if (!window.confirm(t("agents.manager.deleteConfirm", { name: a.label ?? a.id }))) return;
    setError(null);
    setDeletingId(a.id);
    try {
      await call("agents.delete", { id: a.id, scope: a.scope ?? "local" });
      const res = await call<{ agents: AgentInfo[] }>("agents.list");
      onDeleted(res.agents ?? [], a.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  // Start from a working combo (first ready connection + its first model) instead of "(default)".
  const startNew = () => {
    const first = usableProviders[0];
    setForm({ ...EMPTY_FORM, providerId: first?.id ?? "", modelId: first?.models[0]?.id ?? "" });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPendingRoleId("");
    setSavingRole(false);
    setNewRoleLabel("");
  };

  return (
    <div className="agent-manager">
        {!showForm && (
          <>
            <ul className="agent-list">
              {agents.map((a) => (
                <li key={a.id} className="agent-row">
                  <div>
                    <div className="agent-row-title">{a.label ?? a.id}</div>
                    <div className="agent-row-meta">
                      {providers.find((p) => p.id === a.provider)?.label ?? a.provider ?? "?"} · {a.model ?? "?"}
                      {a.scope && <span className="scope-tag">{a.scope}</span>}
                    </div>
                  </div>
                  <div className="agent-row-actions">
                    {onSetDefault && (
                      <button
                        type="button"
                        className="icon-btn"
                        title={a.id === defaultAgentId ? t("agents.manager.isDefault") : t("agents.manager.setDefault")}
                        onClick={() => onSetDefault(a.id)}
                        disabled={a.id === defaultAgentId}
                      >
                        <StarIcon className="hero-icon" style={a.id === defaultAgentId ? { color: "var(--ygg-status-working)" } : { opacity: 0.4 }} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("agents.manager.edit")}
                      onClick={() => void startEdit(a)}
                      disabled={loadingEdit === a.id || deletingId === a.id}
                    >
                      {loadingEdit === a.id ? "…" : <PencilIcon className="hero-icon" />}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("agents.manager.delete")}
                      onClick={() => void deleteAgentConfirm(a)}
                      disabled={deletingId === a.id || loadingEdit === a.id}
                    >
                      {deletingId === a.id ? "…" : <TrashIcon className="hero-icon" />}
                    </button>
                  </div>
                </li>
              ))}
              {agents.length === 0 && <li className="muted">{t("agents.manager.none")}</li>}
            </ul>
            <button type="button" className="new-chat" onClick={startNew}>
              {t("agents.manager.new")}
            </button>
          </>
        )}

        {showForm && (
          <form
            className="agent-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h3 className="agent-form-title">{editingId ? t("agents.manager.formEdit", { id: editingId }) : t("agents.manager.formNew")}</h3>
            {usableProviders.length === 0 && !editingId && (
              <p className="provider-warning">
                {t("agents.manager.noProviders")}{" "}
                {onGoToProviders && (
                  <button type="button" onClick={onGoToProviders}>
                    {t("agents.manager.goProviders")}
                  </button>
                )}
              </p>
            )}
            <label>
              {t("agents.manager.label")}
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder={t("agents.manager.labelPlaceholder")}
                autoFocus={!editingId}
              />
            </label>
            <label>
              {t("agents.manager.provider")}
              <div className="provider-select-row">
                <select
                  value={form.providerId}
                  onChange={(e) => setForm((f) => ({ ...f, providerId: e.target.value, modelId: providers.find((p) => p.id === e.target.value)?.models[0]?.id ?? "" }))}
                >
                  {providerChoices.length === 0 && <option value="">{t("agents.manager.default")}</option>}
                  {providerChoices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-btn"
                  title={t("agents.manager.refreshModels")}
                  onClick={loadProviders}
                  disabled={loadingProviders}
                >
                  <ArrowPathIcon className="hero-icon" />
                </button>
              </div>
            </label>
            {selectedProvider?.error && (
              <p className="provider-warning">
                <ExclamationTriangleIcon className="hero-icon" /> {t("agents.manager.unreachable", { error: selectedProvider.error })}
              </p>
            )}
            <label>
              {t("agents.manager.model")}
              <select
                value={form.modelId}
                onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
                disabled={models.length === 0}
              >
                <option value="">{t("agents.manager.pickModel")}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("agents.manager.role")}
              <select
                value={pendingRoleId}
                onChange={(e) => applyRole(e.target.value)}
              >
                <option value="">{t("agents.manager.rolePick")}</option>
                <optgroup label={t("agents.manager.roleBuiltin")}>
                  {BUILTIN_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.labelKey ? t(r.labelKey) : r.label}
                    </option>
                  ))}
                </optgroup>
                {customRoles.length > 0 && (
                  <optgroup label={t("agents.manager.roleCustom")}>
                    {customRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label>
              {t("agents.manager.systemPrompt")}
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                placeholder={t("agents.manager.systemPromptPlaceholder")}
                rows={4}
              />
            </label>
            <details className="agent-form-advanced">
              <summary>{t("agents.manager.advanced")}</summary>
            <label className="agent-form-check">
              <input
                type="checkbox"
                checked={form.toolsRestricted}
                onChange={(e) => setForm((f) => ({ ...f, toolsRestricted: e.target.checked }))}
              />
              {t("agents.manager.restrictTools")}
            </label>
            {form.toolsRestricted && (
              <>
                <input
                  value={form.toolsAllow}
                  onChange={(e) => setForm((f) => ({ ...f, toolsAllow: e.target.value }))}
                  placeholder="fs_read_*, web_fetch"
                />
                <p className="agent-form-hint">
                  {form.toolsAllow.trim()
                    ? t("agents.manager.toolsHintSome")
                    : t("agents.manager.toolsHintNone")}
                </p>
              </>
            )}
            {!savingRole ? (
              <button
                type="button"
                className="icon-btn"
                disabled={!form.systemPrompt.trim()}
                onClick={() => setSavingRole(true)}
              >
                <StarIcon className="hero-icon" /> {t("agents.manager.saveRole")}
              </button>
            ) : (
              <div className="scope-choice">
                <input
                  className="context-menu-input"
                  value={newRoleLabel}
                  onChange={(e) => setNewRoleLabel(e.target.value)}
                  placeholder={t("agents.manager.roleNamePlaceholder")}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void confirmSaveRole();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setSavingRole(false);
                      setNewRoleLabel("");
                    }
                  }}
                />
                <button type="button" onClick={() => void confirmSaveRole()} disabled={!newRoleLabel.trim()}>
                  {t("agents.manager.saveRoleConfirm")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSavingRole(false);
                    setNewRoleLabel("");
                  }}
                >
                  {t("agents.manager.cancel")}
                </button>
              </div>
            )}
            <label>
              {t("agents.manager.saveAs")}
              <div className="scope-choice">
                <label>
                  <input
                    type="radio"
                    name="scope"
                    checked={form.scope === "local"}
                    disabled={Boolean(editingId)}
                    onChange={() => setForm((f) => ({ ...f, scope: "local" }))}
                  />
                  {t("agents.manager.scopeLocal")}
                </label>
                <label>
                  <input
                    type="radio"
                    name="scope"
                    checked={form.scope === "global"}
                    disabled={Boolean(editingId)}
                    onChange={() => setForm((f) => ({ ...f, scope: "global" }))}
                  />
                  {t("agents.manager.scopeGlobal")}
                </label>
              </div>
            </label>

            </details>

            {error && <p className="error">{error}</p>}

            <div className="agent-form-actions">
              <button type="button" onClick={cancelForm} disabled={submitting}>
                {t("agents.manager.cancel")}
              </button>
              <button type="submit" disabled={submitting || !form.label.trim()}>
                {submitting ? t("agents.manager.saving") : editingId ? t("agents.manager.saveChanges") : t("agents.manager.saveAgent")}
              </button>
            </div>
          </form>
        )}

        {!showForm && error && <p className="error">{error}</p>}
    </div>
  );
}
