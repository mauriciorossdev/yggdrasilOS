import { afterEach, describe, expect, it } from "vitest";
import { getMainLanguage, mt, resolveMainLanguage, setMainLanguage } from "./i18n.js";

afterEach(() => setMainLanguage("en"));

describe("resolveMainLanguage", () => {
  it("prefers a supported saved language", () => {
    expect(resolveMainLanguage("es", "en-US")).toBe("es");
    expect(resolveMainLanguage("en", "es-MX")).toBe("en");
  });

  it("falls back to the OS locale, then English", () => {
    expect(resolveMainLanguage(null, "es-AR")).toBe("es");
    expect(resolveMainLanguage(undefined, "es_MX")).toBe("es");
    expect(resolveMainLanguage("fr", "fr-FR")).toBe("en");
    expect(resolveMainLanguage(null, undefined)).toBe("en");
  });
});

describe("mt", () => {
  it("translates with the current language and fills placeholders", () => {
    expect(mt("about.menu")).toBe("About Yggdrasil");
    setMainLanguage("es");
    expect(getMainLanguage()).toBe("es");
    expect(mt("about.menu")).toBe("Acerca de Yggdrasil");
    expect(mt("project.cloneTitle", { name: "demo" })).toBe("Clonar \"demo\" en…");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(mt("app.seeLog", {})).toBe("See {path} for details.");
  });
});
