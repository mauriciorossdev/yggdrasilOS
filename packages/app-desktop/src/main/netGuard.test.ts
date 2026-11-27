import { describe, expect, it } from "vitest";
import { checkUrl, isPublicAddress } from "./netGuard.js";

describe("isPublicAddress", () => {
  it("accepts public addresses", () => {
    for (const ip of ["8.8.8.8", "140.82.112.5", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("refuses loopback, private, link-local, CGNAT and mapped forms", () => {
    const bad = [
      "127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1", "::ffff:127.0.0.1",
      "::ffff:8.8.8.8", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:0:1::", "not-an-ip",
    ];
    for (const ip of bad) expect(isPublicAddress(ip), ip).toBe(false);
  });
});

describe("checkUrl", () => {
  const allowed = ["api.example.com"];

  it("passes an allowed HTTPS URL", () => {
    expect(checkUrl("https://api.example.com/x?y=1", allowed).hostname).toBe("api.example.com");
  });

  it("refuses everything else", () => {
    const code = (url: string) => {
      try {
        checkUrl(url, allowed);
        return "ok";
      } catch (err) {
        return (err as { code: string }).code;
      }
    };
    expect(code("http://api.example.com/")).toBe("bad-url");
    expect(code("https://user:pw@api.example.com/")).toBe("bad-url");
    expect(code("https://api.example.com:8443/")).toBe("bad-url");
    expect(code("nope")).toBe("bad-url");
    expect(code("https://evil.com/")).toBe("not-granted");
    expect(code("https://api.example.com.evil.com/")).toBe("not-granted");
  });
});
