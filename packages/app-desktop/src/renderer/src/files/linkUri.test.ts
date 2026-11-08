import { describe, expect, it } from "vitest";
import { isAllowedLinkUri } from "./linkUri.js";

// Stand-in for TipTap's default check: web and mail addresses only.
const defaultValidate = (url: string) => /^(https?|mailto):/i.test(url);

describe("isAllowedLinkUri", () => {
  it("accepts relative paths, including ones that start with a folder name", () => {
    for (const url of ["Arquitectura/contrato-flujos.md", "reuniones/2026-10-02.md", "../00-leeme.md", "./a.md", "a.md", "/docs/a.md", "#seccion", "Mi%20nota.md", "a.md#parte"]) {
      expect(isAllowedLinkUri(url, defaultValidate)).toBe(true);
    }
  });

  it("leaves addresses with a scheme to the default check", () => {
    expect(isAllowedLinkUri("https://x.y/a", defaultValidate)).toBe(true);
    expect(isAllowedLinkUri("mailto:a@b.c", defaultValidate)).toBe(true);
    expect(isAllowedLinkUri("javascript:alert(1)", defaultValidate)).toBe(false);
    expect(isAllowedLinkUri("  JAVASCRIPT:alert(1)", defaultValidate)).toBe(false);
    expect(isAllowedLinkUri("data:text/html,x", defaultValidate)).toBe(false);
  });
});
