import { useEffect, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { fetchLspStatus, isServerConnected, onDiagnosticsChanged, retryLanguage, type LspStatus } from "./lsp/service.js";

/** Remembered for this window only: the choice is offered again next time unless the project is trusted. */
let dismissed = false;

/** Offers to run a project's own tools (ESLint, gopls...) that can execute code from the repo. */
export function LspTrustBar({ language }: { language: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<LspStatus | null>(null);
  const [hidden, setHidden] = useState(dismissed);

  useEffect(() => {
    let alive = true;
    void fetchLspStatus().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [language]);

  const [godotConnected, setGodotConnected] = useState(() => isServerConnected("godot"));
  useEffect(() => {
    const read = () => setGodotConnected(isServerConnected("godot"));
    read();
    return onDiagnosticsChanged(read);
  }, []);

  // Godot's server lives in its editor, so GDScript only gets language features while that's open.
  const godot = status?.servers.find((s) => s.id === "godot");
  if (language === "gdscript" && godot && godot.status !== "notApplicable" && !godotConnected) {
    return (
      <div className="lsp-trust-bar" role="status">
        <span>{t("doc.lsp.godotClosed")}</span>
        <button type="button" onClick={() => retryLanguage(language)}>
          {t("doc.lsp.retry")}
        </button>
      </div>
    );
  }

  const blocked = status?.servers.filter((s) => s.status === "needsTrust" && s.languages.includes(language)) ?? [];
  if (hidden || !status || status.trusted || blocked.length === 0) return null;

  return (
    <div className="lsp-trust-bar" role="status">
      <span>{t("doc.lsp.trustPrompt", { tools: blocked.map((s) => s.id).join(", ") })}</span>
      <button
        type="button"
        onClick={() => {
          setHidden(true);
          void window.yggdrasil.lsp.setTrusted(true);
        }}
      >
        {t("doc.lsp.trust")}
      </button>
      <button
        type="button"
        onClick={() => {
          dismissed = true;
          setHidden(true);
        }}
      >
        {t("doc.lsp.notNow")}
      </button>
    </div>
  );
}
