import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GATEWAY_IMAGE,
  KEY_PLACEHOLDER,
  LOCAL_ENV_FILE,
  TUNNEL_TOKEN_PLACEHOLDER,
  buildSetup,
  imageRef,
  isReleaseVersion,
  isValidDomain,
  isValidKey,
  maskKey,
  needsDomain,
  suggestedUrl,
  type DeployTarget,
} from "./linkServerSetup.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const repoFile = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const deployFile = (name: string) => repoFile(`deploy/${name}`);

const key = "a".repeat(64);
const domain = "gateway.example.com";
const version = "0.2.0";
const code = (target: DeployTarget, v = version) => buildSetup(target, { key, domain, version: v })!.map((b) => b.code).join("\n");

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

describe("image version", () => {
  it("pins the image and the checkout to the app's release", () => {
    expect(imageRef("0.2.0")).toBe(`${GATEWAY_IMAGE}:0.2.0`);
    expect(imageRef("0.2.0-beta.1")).toBe(`${GATEWAY_IMAGE}:0.2.0-beta.1`);
    expect(code("vps")).toContain("git clone --depth 1 --branch app-desktop-v0.2.0 ");
    expect(code("vps")).toContain("YGGDRASIL_VERSION=0.2.0\nEOF");
    expect(code("cloudflare")).toContain("YGGDRASIL_VERSION=0.2.0");
    expect(code("cloud")).toContain(`${GATEWAY_IMAGE}:0.2.0`);
    expect(code("local")).toMatch(new RegExp(`${GATEWAY_IMAGE}:0\\.2\\.0$`));
  });

  it("falls back to latest and the default branch for anything that isn't a release version", () => {
    for (const bad of ["", "dev", "0.2", "0.2.0; rm -rf /", "0.2.0 --branch x"]) {
      expect(isReleaseVersion(bad), bad).toBe(false);
      expect(imageRef(bad)).toBe(`${GATEWAY_IMAGE}:latest`);
      expect(code("vps", bad)).not.toContain("--branch");
      expect(code("vps", bad)).not.toContain("YGGDRASIL_VERSION");
    }
  });
});

describe("buildSetup", () => {
  it("waits for valid values", () => {
    expect(buildSetup("local", { key: "short", domain: "", version })).toBeNull();
    expect(buildSetup("vps", { key, domain: "", version })).toBeNull();
    expect(buildSetup("cloudflare", { key, domain: "not a domain", version })).toBeNull();
    expect(buildSetup("cloud", { key, domain: "", version })).not.toBeNull();
    expect(buildSetup("local", { key, domain: "", version })).not.toBeNull();
  });

  it("gives the VPS one block that writes a private .env and starts compose", () => {
    const blocks = buildSetup("vps", { key, domain, version })!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code).toContain(`YGGDRASIL_API_KEY=${key}\nDOMAIN=${domain}\n`);
    // Quoted delimiter: the shell doesn't expand anything in what's written to the file.
    expect(blocks[0]!.code).toContain("<<'EOF'");
    expect(blocks[0]!.code).toContain("chmod 600 deploy/.env");
  });

  it("pulls the image instead of building it", () => {
    for (const target of ["vps", "cloudflare", "local"] as const) {
      expect(code(target), target).not.toContain("--build");
      expect(code(target), target).not.toContain("docker build");
    }
  });

  it("hands out the image and the variable for a cloud platform", () => {
    expect(code("cloud")).toBe(`${GATEWAY_IMAGE}:${version}\nYGGDRASIL_API_KEY=${key}`);
  });

  it("downloads the files before asking for deploy/.env on Cloudflare", () => {
    const labels = buildSetup("cloudflare", { key, domain, version })!.map((b) => b.labelKey);
    expect(labels).toEqual(["set.phone.wiz.blockClone", "set.phone.wiz.blockEnv", "set.phone.wiz.blockRun"]);
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

  it("runs the image the compose files and the workflow publish", () => {
    for (const name of ["docker-compose.yml", "docker-compose.cloudflare.yml"]) {
      expect(deployFile(name), name).toContain(`image: ${GATEWAY_IMAGE}:\${YGGDRASIL_VERSION:-latest}`);
    }
    const workflow = repoFile(".github/workflows/gateway-image.yml");
    expect(workflow).toContain(`IMAGE: ${GATEWAY_IMAGE}`);
    expect(workflow).toContain("app-desktop-v*");
  });

  it("uses variables the example env file documents", () => {
    const example = deployFile(".env.example");
    for (const name of ["YGGDRASIL_API_KEY=", "DOMAIN=", "TUNNEL_TOKEN=", "YGGDRASIL_VERSION="]) expect(example).toContain(name);
  });

  it("runs the local option the same way as the guide", () => {
    const guide = deployFile("README.md").replace(/\s*\\\r?\n\s*/g, " ");
    const run = buildSetup("local", { key, domain, version })!.at(-1)!.code.replace(`:${version}`, ":latest");
    expect(run).toContain(`--env-file ${LOCAL_ENV_FILE}`);
    expect(guide).toContain(run);
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
