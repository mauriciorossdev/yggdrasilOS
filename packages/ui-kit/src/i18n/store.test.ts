import { describe, expect, it, vi } from "vitest";
import { getLanguage, kitEn, kitEs, setLanguage, subscribeLanguage, t } from "./index.js";

describe("kit i18n", () => {
  it("has every English key in Spanish", () => {
    expect(Object.keys(kitEs).sort()).toEqual(Object.keys(kitEn).sort());
  });

  it("is one store: setLanguage notifies subscribers and t follows it", () => {
    const listener = vi.fn();
    const stop = subscribeLanguage(listener);
    setLanguage("es");
    expect(getLanguage()).toBe("es");
    expect(t("ui.close")).toBe("Cerrar");
    setLanguage("en");
    expect(t("ui.close")).toBe("Close");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });
});
