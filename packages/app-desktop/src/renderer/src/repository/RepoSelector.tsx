import type { RepoInfo } from "./types.js";

function describe(repo: RepoInfo): string {
  if (repo.relation === "root") return "raíz del proyecto";
  if (repo.relation === "parent") return `fuera de la raíz (${repo.path})`;
  return `subcarpeta ${repo.path}`;
}

type Props = {
  repos: RepoInfo[];
  selected: string | null;
  onSelect: (path: string) => void;
};

/** Repo picker + a note saying where the selected repo lives relative to the project. */
export function RepoSelector({ repos, selected, onSelect }: Props) {
  const current = repos.find((r) => r.path === selected) ?? null;
  return (
    <div className="repo-selector">
      <select
        className="repo-select"
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        disabled={repos.length < 2}
        title="Repositorio"
      >
        {repos.map((r) => (
          <option key={r.path} value={r.path}>
            {r.name} — {describe(r)}
            {r.branch ? ` · ${r.branch}` : ""}
          </option>
        ))}
      </select>
      {current && current.relation !== "root" && (
        <span className="repo-location-note">
          {current.relation === "child"
            ? `Repositorio en una subcarpeta del proyecto: ${current.path}`
            : `El proyecto está dentro de este repositorio (${current.path})`}
        </span>
      )}
      {repos.length > 1 && <span className="repo-location-note">{repos.length} repositorios en este proyecto</span>}
    </div>
  );
}
