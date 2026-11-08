import { useEffect, useMemo, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { Modal } from "../ui/Modal.js";
import { useI18n } from "../i18n/index.js";
import { useOnboarding } from "../onboarding/store.js";
import { terminalLaunchClis } from "../onboarding/harnessFilter.js";
import type { BranchInfo } from "../repository/types.js";
import { MAX_FANOUT, cleanGatewayError, planWorktrees } from "./create.js";

type Props = {
  /** `repo` param of the git.* methods for the repository being shown. */
  repo: string;
  onClose: () => void;
  /** Paths of the worktrees created (also on a partial failure), so the list can refresh. */
  onCreated: (paths: string[]) => void;
};

const SHELL = "shell";

/**
 * "Nuevo worktree": creates one or several worktrees (git.worktreeAdd) and opens
 * a pane inside each. The task is kept on the pane's "Start task" button, never
 * typed for you: a CLI like Claude first asks to trust the new folder, and a
 * pane must not start work by itself.
 */
export function NewWorktreeDialog({ repo, onClose, onCreated }: Props) {
  const { t } = useI18n();
  const { call } = useGateway();
  const { settings } = useOnboarding();
  const clis = useMemo(() => terminalLaunchClis(settings), [settings]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [harness, setHarness] = useState(clis[0]?.id ?? SHELL);
  const [task, setTask] = useState("");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    call<{ branches: BranchInfo[] }>("git.branches", { repo })
      .then((res) => {
        if (cancelled) return;
        const local = res.branches.filter((b) => !b.remote);
        setBranches(local);
        setBase((cur) => cur || local.find((b) => b.current)?.name || local[0]?.name || "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [call, repo]);

  const names = planWorktrees(name, count);
  const canCreate = name.trim() !== "" && base !== "" && !busy;

  const create = async () => {
    setBusy(true);
    setError(null);
    const created: string[] = [];
    const cli = clis.find((c) => c.id === harness);
    try {
      for (const wtName of names) {
        const res = await call<{ path: string }>("git.worktreeAdd", { repo, name: wtName, base });
        created.push(res.path);
        await window.yggdrasil.panes.create({
          cwd: res.path,
          title: wtName,
          command: cli?.command,
          initialPrompt: task.trim() || undefined,
        });
      }
      onCreated(created);
      onClose();
    } catch (err) {
      setError(cleanGatewayError(err instanceof Error ? err.message : String(err)));
      if (created.length > 0) onCreated(created);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("wt.new.title")}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="repo-btn" onClick={onClose} disabled={busy}>
            {t("wt.common.cancel")}
          </button>
          <button type="button" className="repo-btn primary" onClick={() => void create()} disabled={!canCreate}>
            {busy ? t("wt.new.creating") : names.length > 1 ? t("wt.new.createN", { count: names.length }) : t("wt.new.create")}
          </button>
        </>
      }
    >
      <div className="wt-form">
        <label>
          {t("wt.new.name")}
          <input
            className="repo-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("wt.new.namePlaceholder")}
            autoFocus
          />
        </label>
        <label>
          {t("wt.new.baseBranch")}
          <select className="repo-select" value={base} onChange={(e) => setBase(e.target.value)}>
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.current ? t("wt.new.current") : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("wt.new.harness")}
          <select className="repo-select" value={harness} onChange={(e) => setHarness(e.target.value as typeof harness)}>
            {clis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value={SHELL}>{t("wt.new.shell")}</option>
          </select>
        </label>
        <label>
          {t("wt.new.task")}
          <textarea
            className="repo-input"
            rows={3}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder={t("wt.new.taskPlaceholder")}
          />
        </label>
        <label>
          {t("wt.new.count")}
          <input
            className="repo-input wt-count"
            type="number"
            min={1}
            max={MAX_FANOUT}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
        <p className="repo-muted">
          {t("wt.new.createdPre")}<code>.yggdrasil/worktrees/{names[0] || t("wt.new.nameToken")}</code>{t("wt.new.createdMid")}
          <code>ygg/{names[0] || t("wt.new.nameToken")}</code>
          {names.length > 1 ? t("wt.new.extra", { count: names.length - 1, names: names.slice(1).join(", ") }) : ""}
          {t("wt.new.createdPost")}
        </p>
        {error && <div className="repo-banner error">{error}</div>}
      </div>
    </Modal>
  );
}
