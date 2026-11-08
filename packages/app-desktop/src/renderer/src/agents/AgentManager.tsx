import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  StarIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import { useI18n } from "../i18n/index.js";
import type { AgentInfo, CreateAgentResult, CustomRole, GetAgentResult, ProviderInfo } from "../types.js";
import { BUILTIN_ROLES, type Role } from "./roles.js";
import { EMPTY_TOOLS_FORM, toolsPayload, toolsToForm, type ToolsFormState } from "./toolsForm.js";

type Props = {
  agents: AgentInfo[];
  onClose: () => void;
  onCreated: (agents: AgentInfo[], newAgentId: string) => void;
  onDeleted: (agents: AgentInfo[], deletedId: string) => void;
};

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

export function AgentManager({ agents, onClose, onCreated, onDeleted }: Props) {
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
    const id = form.id.trim();
    if (!id) {
      setError(t("agents.manager.idRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        id,
        label: form.label.trim() || undefined,
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

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPendingRoleId("");
    setSavingRole(false);
    setNewRoleLabel("");
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal agent-manager" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("agents.manager.title")}</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <XMarkIcon className="hero-icon" />
          </button>
        </div>

        {!showForm && (
          <>
            <ul className="agent-list">
              {agents.map((a) => (
                <li key={a.id} className="agent-row">
                  <div>
                    <div className="agent-row-title">{a.label ?? a.id}</div>
                    <div className="agent-row-meta">
                      {a.provider ?? "?"}/{a.model ?? "?"}
                      {a.scope && <span className="scope-tag">{a.scope}</span>}
                    </div>
                  </div>
                  <div className="agent-row-actions">
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
            <button type="button" className="new-chat" onClick={() => setShowForm(true)}>
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
            <label>
              {t("agents.manager.id")}
              <input
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                placeholder={t("agents.manager.idPlaceholder")}
                autoFocus={!editingId}
                disabled={Boolean(editingId)}
              />
            </label>
            <label>
              {t("agents.manager.label")}
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder={t("agents.manager.labelPlaceholder")}
              />
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
              {t("agents.manager.provider")}
              <div className="provider-select-row">
                <select
                  value={form.providerId}
                  onChange={(e) => setForm((f) => ({ ...f, providerId: e.target.value, modelId: "" }))}
                >
                  <option value="">{t("agents.manager.default")}</option>
                  {providers.map((p) => (
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
                <option value="">{t("agents.manager.default")}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
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

            {error && <p className="error">{error}</p>}

            <div className="agent-form-actions">
              <button type="button" onClick={cancelForm} disabled={submitting}>
                {t("agents.manager.cancel")}
              </button>
              <button type="submit" disabled={submitting || !form.id.trim()}>
                {submitting ? t("agents.manager.saving") : editingId ? t("agents.manager.saveChanges") : t("agents.manager.saveAgent")}
              </button>
            </div>
          </form>
        )}

        {!showForm && error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
