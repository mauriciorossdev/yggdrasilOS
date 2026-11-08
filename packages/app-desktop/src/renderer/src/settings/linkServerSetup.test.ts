import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KEY_PLACEHOLDER,
  TUNNEL_TOKEN_PLACEHOLDER,
  buildSetup,
  isValidDomain,
  isValidKey,
  maskKey,
  needsDomain,
  suggestedUrl,
  type DeployTarget,
} from "./linkServerSetup.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const deployFile = (name: string) => readFileSync(join(repoRoot, "deploy", name), "utf8");

const key = "a".repeat(64);
const domain = "gateway.example.com";
const code = (target: DeployTarget) => buildSetup(target, { key, domain })!.map((b) => b.code).join("\n");

describe("isValidKey", () => {
  it("accepts generated keys and common random formats", () => {
    expect(isValidKey("0123456789abcdef".repeat(4))).toBe(true);
    expect(isValidKey("ygd_AbC-123_xyz.456789")).toBe(true);
  });

  it("rejects what a .env file would change or a shell block could run", () => {
    for (const bad of ["", "short", "has a space in the key", "has$dollar-in-the-key", "has'quote-in-the-key", 'has"quote-in-the-key', "line\nbreak-in-the-key", "EOF`rm -rf`-in-the-key", "#comment-looking-key"]) {
      expect(isValidKey(bad), bad).toBe(false);
    }
  });
});

describe("isValidDomain", () => {
  it("accepts public hostnames", () => {
    for (const ok of ["gateway.example.com", "a.b.co", "my-host.example.org"]) expect(isValidDomain(ok), ok).toBe(true);
  });

  it("rejects schemes, paths, ports, IPs and anything a shell would interpret", () => {
    for (const bad of ["", "localhost", "https://gateway.example.com", "gateway.example.com/x", "gateway.example.com:443", "1.2.3.4", "-bad.example.com", "a.example.com;rm", "a b.example.com", "$(id).example.com"]) {
      expect(isValidDomain(bad), bad).toBe(false);
    }
  });
});

describe("buildSetup", () => {
  it("waits for valid values", () => {
    expect(buildSetup("local", { key: "short", domain: "" })).toBeNull();
    expect(buildSetup("vps", { key, domain: "" })).toBeNull();
    expect(buildSetup("cloudflare", { key, domain: "not a domain" })).toBeNull();
    expect(buildSetup("cloud", { key, domain: "" })).not.toBeNull();
    expect(buildSetup("local", { key, domain: "" })).not.toBeNull();
  });

  it("gives the VPS one block that writes a private .env and starts compose", () => {
    const blocks = buildSetup("vps", { key, domain })!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code).toContain(`YGGDRASIL_API_KEY=${key}\nDOMAIN=${domain}\nEOF`);
    // Quoted delimiter: the shell doesn't expand anything in what's written to the file.
    expect(blocks[0]!.code).toContain("<<'EOF'");
    expect(blocks[0]!.code).toContain("chmod 600 deploy/.env");
  });

  it("hands out only the variable for a cloud platform", () => {
    expect(code("cloud")).toBe(`YGGDRASIL_API_KEY=${key}`);
  });

  it("never asks to publish the unencrypted port beyond what the guide says", () => {
    expect(code("vps")).not.toContain("8787:8787");
    expect(code("cloudflare")).not.toContain("8787:8787");
    expect(code("local")).toContain("-p 8787:8787");
  });

  it("uses the token placeholder rather than asking for a Cloudflare secret here", () => {
    expect(code("cloudflare")).toContain(`TUNNEL_TOKEN=${TUNNEL_TOKEN_PLACEHOLDER}`);
  });
});

describe("the commands match deploy/", () => {
  it("names compose files that exist and the variables they need", () => {
    const vps = deployFile("docker-compose.yml");
    expect(code("vps")).toContain("deploy/docker-compose.yml");
    expect(vps).toContain("${DOMAIN:?");
    expect(vps).toContain("env_file: .env");
    const cloudflare = deployFile("docker-compose.cloudflare.yml");
    expect(code("cloudflare")).toContain("deploy/docker-compose.cloudflare.yml");
    expect(cloudflare).toContain("${TUNNEL_TOKEN:?");
  });

  it("uses variables the example env file documents", () => {
    const example = deployFile(".env.example");
    for (const name of ["YGGDRASIL_API_KEY=", "DOMAIN=", "TUNNEL_TOKEN="]) expect(example).toContain(name);
  });

  it("runs the local option the same way as the guide", () => {
    const guide = deployFile("README.md").replace(/\s*\\\r?\n\s*/g, " ");
    const run = code("local").split("\n").find((line) => line.startsWith("docker run"))!;
    expect(guide).toContain(run);
    expect(guide).toContain("docker build -t yggdrasil-gateway .");
  });
});

describe("suggestedUrl", () => {
  it("starts from https on the domain, or the LAN address locally", () => {
    expect(suggestedUrl("vps", { domain })).toBe(`https://${domain}`);
    expect(suggestedUrl("cloudflare", { domain })).toBe(`https://${domain}`);
    expect(suggestedUrl("vps", { domain: "nope" })).toBe("");
    expect(suggestedUrl("local", { domain: "", lan: "192.168.1.5" })).toBe("http://192.168.1.5:8787");
    expect(suggestedUrl("local", { domain: "" })).toBe("");
    expect(suggestedUrl("cloud", { domain: "" })).toBe("");
  });

  it("only asks for a domain where it's used", () => {
    expect(needsDomain("vps")).toBe(true);
    expect(needsDomain("cloudflare")).toBe(true);
    expect(needsDomain("cloud")).toBe(false);
    expect(needsDomain("local")).toBe(false);
  });
});

describe("maskKey", () => {
  it("hides every occurrence of the key from what's on screen", () => {
    const masked = maskKey(code("vps"), key);
    expect(masked).not.toContain(key);
    expect(masked).toContain(`YGGDRASIL_API_KEY=${KEY_PLACEHOLDER}`);
    expect(maskKey("no key here", "")).toBe("no key here");
  });
});
