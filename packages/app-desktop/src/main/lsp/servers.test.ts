import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findOnPath, LSP_SERVERS, serverStatus, serversForLanguage, type ServerContext } from "./servers.js";

function ctx(over: Partial<ServerContext> & { files?: string[]; binaries?: string[] } = {}): ServerContext {
  const files = new Set(over.files ?? []);
  const binaries = new Set(over.binaries ?? []);
  return {
    root: "/p",
    trusted: false,
    exists: (p) => files.has(p),
    bundled: (s) => `/app/${s}`,
    onPath: (c) => (binaries.has(c) ? `/bin/${c}` : null),
    ...over,
  };
}
const ids = (language: string, c: ServerContext) => serversForLanguage(language, c).map((s) => s.id);
const spec = (id: string) => LSP_SERVERS.find((s) => s.id === id)!;
const projectTs = join("/p", "node_modules", "typescript", "lib", "tsserver.js");
const eslintrc = join("/p", "eslint.config.js");

describe("lsp servers", () => {
  it("uses the bundled TypeScript until the project is trusted", () => {
    const options = (c: ServerContext) => spec("typescript").resolve(c)?.initializationOptions as { tsserver: { path: string } };
    expect(options(ctx({ files: [projectTs] })).tsserver.path).toBe("/app/typescript-lsp/lib/tsserver.js");
    expect(options(ctx({ files: [projectTs], trusted: true })).tsserver.path).toBe(projectTs);
    expect(options(ctx({ trusted: true })).tsserver.path).toBe("/app/typescript-lsp/lib/tsserver.js");
  });

  it("never downloads types by itself", () => {
    const options = spec("typescript").resolve(ctx())?.initializationOptions as { disableAutomaticTypingAcquisition: boolean };
    expect(options.disableAutomaticTypingAcquisition).toBe(true);
  });

  it("runs ESLint only in a trusted project that has a config", () => {
    expect(ids("typescript", ctx({ files: [eslintrc] }))).toEqual(["typescript"]);
    expect(ids("typescript", ctx({ trusted: true }))).toEqual(["typescript"]);
    expect(ids("typescript", ctx({ files: [eslintrc], trusted: true }))).toEqual(["typescript", "eslint"]);
    expect(serverStatus(spec("eslint"), ctx({ files: [eslintrc] }))).toBe("needsTrust");
    expect(serverStatus(spec("eslint"), ctx())).toBe("notApplicable");
  });

  it("offers Python's bundled server, plus Ruff when installed", () => {
    expect(ids("python", ctx())).toEqual(["pyright"]);
    expect(ids("python", ctx({ binaries: ["ruff"] }))).toEqual(["pyright", "ruff"]);
  });

  it("holds back servers that run project code until trusted, and reports missing ones", () => {
    expect(serverStatus(spec("gopls"), ctx({ binaries: ["gopls"] }))).toBe("needsTrust");
    expect(ids("rust", ctx({ binaries: ["rust-analyzer"], trusted: true }))).toEqual(["rust-analyzer"]);
    expect(serverStatus(spec("gopls"), ctx({ trusted: true }))).toBe("missing");
  });

  it("connects to Godot only in a Godot project, over loopback", () => {
    expect(ids("gdscript", ctx())).toEqual([]);
    const godot = ctx({ files: [join("/p", "project.godot")] });
    expect(ids("gdscript", godot)).toEqual(["godot"]);
    expect(spec("godot").resolve(godot)?.launch).toEqual({ kind: "tcp", host: "127.0.0.1", port: 6005 });
  });

  it("has nothing for other languages", () => {
    expect(ids("markdown", ctx({ trusted: true }))).toEqual([]);
  });
});

describe("findOnPath", () => {
  it("skips Windows shims that would need a shell", () => {
    const exists = (p: string) => p === join("a", "ruff.cmd") || p === join("b", "ruff.exe");
    expect(findOnPath("ruff", exists, "a;b", "win32")).toBe(join("b", "ruff.exe"));
    expect(findOnPath("nope", exists, "a;b", "win32")).toBeNull();
  });
});
