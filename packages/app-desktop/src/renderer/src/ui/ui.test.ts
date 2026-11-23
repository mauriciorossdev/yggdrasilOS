import { describe, expect, it } from "vitest";
import { STATUS_TONE, statusTone } from "@yggdrasil/ui-kit";
import { FEATURE_STATUSES } from "../documents/featureDoc.js";

describe("ui library", () => {
  it("maps every feature status to a chip tone", () => {
    for (const status of FEATURE_STATUSES) expect(STATUS_TONE[status]).toBeTruthy();
    expect(statusTone(null)).toBe("neutral");
    expect(statusTone("needs-decision")).toBe("attention");
  });
});
