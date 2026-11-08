import { FolderIcon } from "@heroicons/react/20/solid";
import type { RepoInfo } from "./types.js";
import { useI18n } from "../i18n/index.js";

function describe(repo: RepoInfo, t: ReturnType<typeof useI18n>["t"]): string {
  if (repo.relation === "root") return t("repo.selector.root");
  if (repo.relation === "parent") return t("repo.selector.parent", { path: repo.path });
  return t("repo.selector.child", { path: repo.path });
}

type Props = {
  repos: RepoInfo[];
  selected: string | null;
  onSelect: (path: string) => void;
};

/** Repo picker + a note saying where the selected repo lives relative to the project. */
export function RepoSelector({ repos, selected, onSelect }: Props) {
  const { t } = useI18n();
  const current = repos.find((r) => r.path === selected) ?? null;
  return (
    <div className="repo-selector">
      <span className="repo-selector-icon" aria-hidden="true">
        <FolderIcon className="hero-icon" />
      </span>
      <select
        className="repo-select"
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        disabled={repos.length < 2}
        title={t("repo.selector.title")}
      >
        {repos.map((r) => (
          <option key={r.path} value={r.path}>
            {r.name} — {describe(r, t)}
            {r.branch ? ` · ${r.branch}` : ""}
          </option>
        ))}
      </select>
      {current && current.relation !== "root" && (
        <span className="repo-location-note">
          {current.relation === "child"
            ? t("repo.selector.childNote", { path: current.path })
            : t("repo.selector.parentNote", { path: current.path })}
        </span>
      )}
      {repos.length > 1 && <span className="repo-location-note">{t("repo.selector.count", { count: repos.length })}</span>}
    </div>
  );
}
