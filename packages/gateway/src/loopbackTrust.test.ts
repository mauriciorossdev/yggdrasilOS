import { describe, expect, it } from "vitest";
import { isLoopbackAddress, isTrustedLoopback } from "./loopbackTrust.js";

describe("loopback trust", () => {
  it("recognizes every loopback form and nothing else", () => {
    for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ["192.168.1.20", "100.64.0.7", "::ffff:192.168.1.20", undefined]) expect(isLoopbackAddress(a)).toBe(false);
  });

  it("only trusts loopback when explicitly enabled", () => {
    expect(isTrustedLoopback("127.0.0.1", {} as NodeJS.ProcessEnv)).toBe(false);
    expect(isTrustedLoopback("127.0.0.1", { YGGDRASIL_TRUST_LOOPBACK: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isTrustedLoopback("192.168.1.20", { YGGDRASIL_TRUST_LOOPBACK: "1" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
