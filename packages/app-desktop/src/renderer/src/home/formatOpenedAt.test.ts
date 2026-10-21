import { describe, expect, it } from "vitest";
import { formatOpenedAt } from "./formatOpenedAt.js";

const NOW = 1_700_000_000_000;

describe("formatOpenedAt", () => {
  it("uses minutes, hours and days", () => {
    expect(formatOpenedAt(NOW - 10_000, NOW)).toBe("ahora");
    expect(formatOpenedAt(NOW - 5 * 60_000, NOW)).toBe("hace 5 min");
    expect(formatOpenedAt(NOW - 3 * 3_600_000, NOW)).toBe("hace 3 h");
    expect(formatOpenedAt(NOW - 2 * 86_400_000, NOW)).toBe("hace 2 d");
  });

  it("never goes negative for a timestamp slightly in the future", () => {
    expect(formatOpenedAt(NOW + 5_000, NOW)).toBe("ahora");
  });
});
