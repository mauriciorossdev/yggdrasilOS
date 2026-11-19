import { describe, expect, it } from "vitest";
import { lossyNames } from "./lossyNames.js";

describe("lossyNames", () => {
  it("translates the known names and keeps unknown ones as they are", () => {
    expect(lossyNames(["charts", "pivot tables", "mystery"], "es")).toBe("gráficos, tablas dinámicas, mystery");
  });
  it("leaves English as reported", () => {
    expect(lossyNames(["comments", "charts"], "en")).toBe("comments, charts");
  });
});
