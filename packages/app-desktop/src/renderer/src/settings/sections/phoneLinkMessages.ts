import type { useI18n } from "../../i18n/index.js";
import type { HubTestResult } from "../../types.js";

/** What "Test connection" tells the user, in Settings and in the setup wizard. */
export function hubTestMessage(t: ReturnType<typeof useI18n>["t"], result: HubTestResult): string {
  if (result.ok) return t("set.phone.testOk", { n: result.desktops });
  switch (result.code) {
    case "invalid-url":
      return t("set.phone.testInvalidUrl");
    case "insecure":
      return t("set.phone.urlInsecurePublic");
    case "missing-key":
      return t("set.phone.testMissingKey");
    case "unreachable":
      return t("set.phone.testUnreachable", { detail: result.detail ?? "" });
    case "not-yggdrasil":
      return t("set.phone.testNotYggdrasil");
    case "bad-key":
      return t("set.phone.testBadKey");
    case "server-open":
      return t("set.phone.testServerOpen");
    case "no-directory":
      return t("set.phone.testNoDirectory");
  }
}
