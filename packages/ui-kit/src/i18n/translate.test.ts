import { describe, expect, it } from "vitest";
import { resolveLanguage, translate } from "./translate.js";

describe("resolveLanguage", () => {
  it("prefers a supported saved language", () => {
    expect(resolveLanguage("es", "en-US")).toBe("es");
  });

  it("falls back to the OS locale's base language", () => {
    expect(resolveLanguage(null, "es-MX")).toBe("es");
    expect(resolveLanguage(undefined, "es_AR")).toBe("es");
    expect(resolveLanguage(null, "EN-gb")).toBe("en");
  });

  it("ignores unsupported values and defaults to English", () => {
    expect(resolveLanguage("fr", "fr-FR")).toBe("en");
    expect(resolveLanguage(null, undefined)).toBe("en");
  });
});

describe("translate", () => {
  const en = { hi: "Hello {name}", only_en: "Only English", count: "{n} of {total}" };
  const es = { hi: "Hola {name}" };

  it("uses the dictionary, interpolating variables", () => {
    expect(translate(es, en, "hi", { name: "Ana" })).toBe("Hola Ana");
    expect(translate(en, en, "count", { n: 2, total: 4 })).toBe("2 of 4");
  });

  it("falls back to English, then to the key", () => {
    expect(translate(es, en, "only_en")).toBe("Only English");
    expect(translate(es, en, "missing.key")).toBe("missing.key");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(translate(en, en, "hi", {})).toBe("Hello {name}");
  });
});
