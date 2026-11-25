import type { PluginFileEntry, PluginRecord } from "../types.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  plugin: PluginRecord;
  files: PluginFileEntry[];
  /** Files modified after this (ms) are marked as recent — when the workspace opened. */
  since: number;
  onOpen: (file: PluginFileEntry) => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Archivos tab: a read-only listing of the complemento's folder, nested by
 * path, with what the agent touched since the workspace opened marked.
 * Clicking opens the file (project scope, in the app's own viewer) or
 * reveals it (global scope, outside the project). Editing is the agent's job.
 */
export function StudioFiles({ plugin, files, since, onOpen }: Props) {
  const { t } = useI18n();
  const location =
    plugin.scope === "global" ? plugin.dir : `.yggdrasil/plugins/${plugin.manifest.id}/`;

  if (files.length === 0) {
    return (
      <div className="studio-files">
        <p className="muted">{t("studio.files.empty")}</p>
      </div>
    );
  }

  let lastDir = "";
  return (
    <div className="studio-files">
      <p className="studio-files-root mono">{location}</p>
      <ul className="studio-files-list">
        {files.flatMap((f) => {
          const parts = f.path.split("/");
          const dir = parts.slice(0, -1).join("/");
          const rows = [];
          if (dir && dir !== lastDir) {
            rows.push(
              <li key={`dir:${dir}`} className="studio-files-dir" style={{ paddingLeft: 8 + (parts.length - 2) * 14 }}>
                {dir}/
              </li>,
            );
          }
          lastDir = dir;
          const recent = f.mtimeMs > since;
          rows.push(
            <li key={f.path}>
              <button
                type="button"
                className="studio-files-item"
                style={{ paddingLeft: 8 + (parts.length - 1) * 14 }}
                onClick={() => onOpen(f)}
                title={f.path}
              >
                <span className="mono studio-files-name">{parts[parts.length - 1]}</span>
                {recent && <span className="studio-files-recent">{t("studio.files.changed")}</span>}
                <span className="studio-spacer" />
                <span className="muted studio-files-size">{formatSize(f.size)}</span>
              </button>
            </li>,
          );
          return rows;
        })}
      </ul>
    </div>
  );
}
