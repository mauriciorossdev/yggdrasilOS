import { useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { ConfigGetResult } from "../../types.js";

/**
 * Export/import of every setting as one Markdown file (see main/settingsTransfer.ts).
 * Desktop-local settings are merged in main; the gateway part goes through
 * config.patch so it hot-reloads and merges per provider/agent.
 */
export function TransferSection() {
  const { call } = useGateway();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await task());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportSettings = () =>
    run(async () => {
      const cfg = await call<ConfigGetResult>("config.get");
      const res = await window.yggdrasil.settingsTransfer.exportSettings(cfg.workspaceRoot, includeSecrets);
      return res ? `Exportado en ${res.path}` : null;
    });

  const importSettings = () =>
    run(async () => {
      const res = await window.yggdrasil.settingsTransfer.importSettings();
      if (!res) return null;
      let gatewayKeys: string[] = [];
      if (res.gateway && Object.keys(res.gateway).length > 0) {
        await call("config.patch", res.gateway);
        gatewayKeys = Object.keys(res.gateway);
      }
      const parts = [
        res.desktopKeys.length ? `escritorio: ${res.desktopKeys.join(", ")}` : null,
        gatewayKeys.length ? `gateway: ${gatewayKeys.join(", ")}` : null,
      ].filter(Boolean);
      const applied = parts.length ? `Importado (${parts.join(" · ")}). Cierra y reabre Settings para ver los cambios.` : "No se importó nada.";
      return res.warnings.length ? `${applied}\nAvisos: ${res.warnings.join("; ")}` : applied;
    });

  return (
    <section className="settings-section">
      <h3>Exportar / Importar</h3>
      <p className="muted">
        Guarda la configuración de este equipo (providers, URLs, STT/TTS, IDE, automation…) en un archivo .md para
        cargarla en otro computador. El gateway exporta el proyecto abierto.
      </p>

      <label>
        <input type="checkbox" checked={includeSecrets} disabled={busy} onChange={(e) => setIncludeSecrets(e.target.checked)} />
        Incluir API keys y tokens (en texto plano)
      </label>
      {includeSecrets && <p className="error">El archivo contendrá credenciales: no lo subas a git ni lo compartas.</p>}

      <div className="agent-form-actions">
        <button type="button" disabled={busy} onClick={() => void exportSettings()}>
          Exportar a .md
        </button>
        <button type="button" disabled={busy} onClick={() => void importSettings()}>
          Importar desde .md
        </button>
      </div>

      {message && <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
