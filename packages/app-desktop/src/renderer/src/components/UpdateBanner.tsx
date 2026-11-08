import { useEffect, useState } from "react";
import { Button } from "../ui/Button.js";
import { useI18n } from "../i18n/index.js";

type Update = { version: string; url: string };

/**
 * "Version X is available" strip with a button to its release page
 * (main/updateCheck.ts finds it). Nothing is downloaded from here.
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
    <div className="update-banner" role="status">
      <span>{t("update.available", { version: update.version })}</span>
      <Button variant="primary" size="sm" onClick={() => void window.yggdrasil.update.openRelease()}>
        {t("update.view")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void window.yggdrasil.update.dismiss()}>
        {t("update.later")}
      </Button>
    </div>
  );
}
