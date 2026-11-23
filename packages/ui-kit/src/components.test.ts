import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs build script, no types
import { buildComponentsCss, componentClasses, DESKTOP_CSS, OUTPUT } from "../scripts/sync-css.mjs";

describe("components.css", () => {
  it("is in sync with app-desktop's styles.css (run `pnpm --filter @yggdrasil/ui-kit sync-css` if not)", () => {
    const expected = buildComponentsCss(readFileSync(DESKTOP_CSS, "utf8"), componentClasses());
    expect(readFileSync(OUTPUT, "utf8")).toBe(expected);
  });

  it("covers the chat, approval, provider and agent components", () => {
    const css = readFileSync(OUTPUT, "utf8");
    for (const cls of ["message-list", "approval-bar", "tool-compact", "settings-provider", "agent-form", "thinking-dot"]) {
      expect(css).toContain(`.${cls}`);
    }
  });
});
