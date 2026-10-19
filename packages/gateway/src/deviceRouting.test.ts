import { describe, expect, it } from "vitest";
import { isForThisConnection } from "./deviceRouting.js";

describe("isForThisConnection", () => {
  it("delivers only to the addressed connection", () => {
    expect(isForThisConnection({ connectionId: "A", toolName: "phone_set_alarm" }, "A")).toBe(true);
    expect(isForThisConnection({ connectionId: "A", toolName: "phone_set_alarm" }, "B")).toBe(false);
  });

  it("keeps broadcasting events that carry no address", () => {
    expect(isForThisConnection({ toolName: "x" }, "B")).toBe(true);
    expect(isForThisConnection({ connectionId: 42 }, "B")).toBe(true);
    expect(isForThisConnection(undefined, "B")).toBe(true);
    expect(isForThisConnection(null, "B")).toBe(true);
  });
});
