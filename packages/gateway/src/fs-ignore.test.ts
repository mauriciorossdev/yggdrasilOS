import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIgnoreMatcher, toIgnoreTestPath } from "./fs-ignore.js";

describe("loadIgnoreMatcher", () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("always excludes .git and node_modules even with no .gitignore at all", async () => {
    root = await mkdtemp(join(tmpdir(), "fs-ignore-"));
    // The exact real-world shape that triggered this: a project root with
    // no .gitignore of its own (the real one lives inside a nested
    // monorepo dir) — without an unconditional node_modules exclusion here,
    // fs-watch.ts's chokidar instance recursively fs.watch()s every
    // directory in node_modules (thousands, on a real dependency tree),
    // which on macOS (chokidar 5 has no native backend anymore) exhausts
    // the OS's watch capacity and throws EMFILE well before generic
    // `ulimit -n` would help.
    await mkdir(join(root, "node_modules", "some-dep"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });

    const ig = await loadIgnoreMatcher(root);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "node_modules")))).toBe(true);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "node_modules", "some-dep")))).toBe(true);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, ".git")))).toBe(true);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "src")))).toBe(false);
  });

  it("always excludes common build-cache dirs even nested inside an untracked subproject with no .gitignore of its own reachable from workspaceRoot", async () => {
    // Reproduces the b-health case: workspaceRoot itself has no
    // .gitignore, and the real one (listing .next/.expo/etc) lives one
    // level down inside a nested monorepo dir this matcher never reads —
    // an untracked apps/ tree full of Next.js/Expo build caches (6.7GB,
    // tens of thousands of dirs) exhausted the OS's watch-handle limit.
    root = await mkdtemp(join(tmpdir(), "fs-ignore-"));
    await mkdir(join(root, "apps", "web", ".next", "cache"), { recursive: true });
    await mkdir(join(root, "apps", "mobile", ".expo"), { recursive: true });
    await mkdir(join(root, "apps", "web", "src"), { recursive: true });

    const ig = await loadIgnoreMatcher(root);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "apps", "web", ".next")))).toBe(true);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "apps", "web", ".next", "cache")))).toBe(true);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "apps", "mobile", ".expo")))).toBe(true);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "apps", "web", "src")))).toBe(false);
  });

  it("still applies the project's own .gitignore patterns on top of the always-ignored set", async () => {
    root = await mkdtemp(join(tmpdir(), "fs-ignore-"));
    await writeFile(join(root, ".gitignore"), "dist/\n*.log\n");
    await mkdir(join(root, "dist"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });

    const ig = await loadIgnoreMatcher(root);
    // A directory-only gitignore pattern ("dist/") only matches something
    // discovered inside it, not the bare directory path itself — same
    // convention this codebase's real chokidar/fs.list walks already rely
    // on (methods.ts, fs-watch.ts), since they test each path as they
    // encounter it during a walk, not the root of an ignored subtree.
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "dist", "bundle.js")))).toBe(true);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "debug.log")))).toBe(true);
    expect(ig.ignores(toIgnoreTestPath(root, join(root, "src")))).toBe(false);
  });
});
