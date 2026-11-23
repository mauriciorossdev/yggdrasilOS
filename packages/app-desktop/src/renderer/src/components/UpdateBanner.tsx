import { useEffect, useState } from "react";
import { Button } from "@yggdrasil/ui-kit";
import { useI18n } from "../i18n/index.js";

type Update = { version: string; url: string };

/**
 * Floating "Version X is available" card (bottom-left corner) with a button
 * to its release page (main/updateCheck.ts finds it). Nothing is downloaded
 * from here — the release page is where the installer lives.
 */
export function UpdateBanner() {
  const { t } = useI18n();
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    // Subscribe first, then ask: a check that finished before this window
    // existed only shows up through `get`.
    const off = window.yggdrasil.update.onChange(setUpdate);
    void window.yggdrasil.update.get().then((current) => {
      if (current) setUpdate(current);
    });
    return off;
  }, []);

  if (!update) return null;

  return (
    <div className="update-toast" role="status">
      <div className="update-toast-text">
        <strong>{t("update.title")}</strong>
        <span>{t("update.available", { version: update.version })}</span>
      </div>
      <div className="update-toast-actions">
        <Button variant="ghost" size="sm" onClick={() => void window.yggdrasil.update.dismiss()}>
          {t("update.later")}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void window.yggdrasil.update.openRelease()}>
          {t("update.view")}
        </Button>
      </div>
    </div>
  );
}
