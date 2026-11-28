// Project files (fs.*, documents.index) and the sidebar's git.status/git.diff. They share the approval gate
// and the root check below; the Repository tab's git methods are in git-methods.ts and authorize differently.

import { execFile } from "node:child_process";
import { mkdir, opendir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ToolApprovalHandler } from "@yggdrasil/sdk";
import { indexNotes } from "./documents-index.js";
import { loadIgnoreMatcher, toIgnoreTestPath } from "./fs-ignore.js";
import { searchContent } from "./fs-search-content.js";
import type { GatewayContext, GatewayMethodHandler } from "./methods.js";

export interface FsMethodsDeps {
  createGatewayApprovalHandler: (events: GatewayContext["events"]) => ToolApprovalHandler;
  deviceIdByConnectionId: ReadonlyMap<string, string>;
  isLoopbackConnection: (connectionId: string | undefined) => boolean;
  isTrustedDeviceConnection: (workspaceRoot: string | undefined, connectionId: string | undefined) => Promise<boolean>;
  register: (name: string, handler: GatewayMethodHandler) => void;
}

export function registerFsMethods(deps: FsMethodsDeps): void {
  const { createGatewayApprovalHandler, deviceIdByConnectionId, register } = deps;
  const { isLoopbackConnection, isTrustedDeviceConnection } = deps;

  // fs.* gate (remote-access-analysis.md section 5, point 2 — hard prerequisite
  // before binding the gateway off loopback). This whole method family was
  // reachable by any connected client with zero approval, unlike every other
  // mutating/sensitive surface (tools, device-tools) which already goes through
  // pendingApprovals. Reuses that exact mechanism — no new pending-map, no new
  // event — every fs.* call asks the same tool.approval.requested/tools.approve
  // round trip an LLM tool call would.
  //
  // fs.delete calls this unconditionally, for every connection, no exceptions —
  // deleting is irreversible, so it always needs a human's say-so regardless of
  // who's asking. It's also the only handler that doesn't even take a
  // connectionId param, making it structurally impossible for a future edit to
  // accidentally relax it the same way the others below are relaxed.
  //
  // fs.list/fs.read/fs.readBinary/fs.write/fs.mkdir/fs.rename/git.status/
  // git.diff skip this call entirely when isLoopbackConnection(connectionId)
  // is true — no UI outside the Chat tab ever answers this approval prompt
  // (see FileTree.tsx/FileTreeNode.tsx, FileContentPanel.tsx), so every
  // Files/Documents-tab read *or* save/create from the desktop app's own
  // loopback connection to its own gateway subprocess was silently timing
  // out. A verified-loopback socket is the same machine the human is already
  // sitting at; a LAN/Tailscale/phone connection still gets gated exactly as
  // before — this doesn't reopen what was closed for remote access, it only
  // recognizes that "the app talking to its own subprocess" was never the
  // threat model this gate was written for.
  //
  // Same methods also skip it for isTrustedDeviceConnection — a device
  // (phone) the project owner explicitly marked trusted via ApprovalBar.tsx's
  // "Confiar en este dispositivo" checkbox or PhoneLinkSection.tsx (see
  // trustedDevices.ts). Unlike the loopback case this *is* a remote
  // connection, but one the human already vouched for by name, once, same
  // posture as a paired device — not a blanket reopening of remote access.
  // Deleting stays gated everywhere regardless of connection,
  // since undoing a mistaken loopback-trusted delete isn't possible the way
  // undoing a bad write/rename/mkdir is.
  async function requireFsApproval(
    ctx: GatewayContext,
    method: string,
    params: Record<string, unknown>,
    riskLevel: "moderate" | "destructive",
    connectionId?: string,
  ): Promise<void> {
    const approve = createGatewayApprovalHandler(ctx.events);
    const approved = await approve({
      sessionKey: String(params.sessionKey ?? ""),
      toolName: method,
      args: params,
      riskLevel,
      deviceId: connectionId ? deviceIdByConnectionId.get(connectionId) : undefined,
    });
    if (!approved) {
      throw new Error(`${method}: denied by user`);
    }
  }

  // Every fs.* method below also goes through requireFsApproval (see above)
  // before touching disk — closed the historical gap where this whole family
  // was reachable by any connected client with zero approval gate, unlike
  // tool-system's fs tools. Independent of that: every method here must still
  // resolve relativePath through this guard, so a crafted "../../etc/passwd"
  // (or an absolute/different-drive path) can never escape the project root
  // even once approved.
  function resolveWithinRoot(root: string, methodName: string, relativePath: string): string {
    const resolvedRoot = resolve(root);
    const target = resolve(resolvedRoot, relativePath);
    const rel = relative(resolvedRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`${methodName}: relativePath escapes the project root`);
    }
    return target;
  }

  const FS_LIST_MAX_ENTRIES = 2000;

  register("fs.list", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.list", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.list: this gateway has no workspaceRoot");

    const relativePath = params.relativePath !== undefined ? String(params.relativePath) : "";
    const target = resolveWithinRoot(root, "fs.list", relativePath);

    const ig = await loadIgnoreMatcher(root);

    // opendir()'s async iterator, not readdir(), so a pathological directory
    // (node_modules with 100k+ entries, a cloud-synced folder where each
    // dirent is a slow network round-trip) can be capped by stopping at
    // FS_LIST_MAX_ENTRIES instead of always materializing the whole
    // directory first — that unbounded materialization was the actual
    // "Timeout: fs.list" cause, not the 2000-entry response cap below it.
    const typed: { name: string; type: "directory" | "file" | "other" }[] = [];
    let truncated = false;
    const dir = await opendir(target);
    try {
      for await (const e of dir) {
        if (ig.ignores(toIgnoreTestPath(root, join(target, e.name)))) continue;
        if (typed.length >= FS_LIST_MAX_ENTRIES) {
          truncated = true;
          break;
        }
        typed.push({
          name: e.name,
          type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other",
        });
      }
    } finally {
      await dir.close().catch(() => undefined);
    }
    typed.sort((a, b) => (a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)));

    return { path: relativePath, entries: typed, truncated };
  });

  // A single RPC response over a local/loopback connection — 50k chars was
  // needlessly tight for this (notes/*.md routinely run past it; compare
  // fs.readBinary's 20MB cap just below, for the same kind of response).
  // Raised, not removed: fs.write is still fully unbounded (see its own
  // comment) but a read should stay bounded against something truly
  // pathological (an accidentally-opened multi-GB log).
  const FS_READ_MAX_CHARS = 2_000_000;

  register("fs.read", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.read", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.read: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.read: relativePath is required");
    const target = resolveWithinRoot(root, "fs.read", relativePath);

    const content = await readFile(target, "utf8");
    if (content.length > FS_READ_MAX_CHARS) {
      return {
        path: relativePath,
        content: content.slice(0, FS_READ_MAX_CHARS),
        truncated: true,
        totalLength: content.length,
      };
    }
    return { path: relativePath, content, truncated: false };
  });

  // Base64 round-trip for binary previews (images, PDFs — see
  // renderer/src/files/FileViewer.tsx) that fs.read can't handle: reading a
  // binary file as "utf8" (fs.read's encoding) corrupts it. Base64 inflates
  // size ~33%, so the cap here is generous but still bounded — this is a
  // single RPC response, not a stream.
  const FS_READ_BINARY_MAX_BYTES = 20_000_000;

  register("fs.readBinary", async (params, ctx, connectionId) => {
    // Same loopback exemption as fs.read/fs.list just above — this is the
    // desktop app's own Documents panel viewing an image/PDF from its own
    // project, not a remote/agent action; it was missing here even though
    // every other plain-read fs.* method already has it, which is why
    // opening a preview always prompted for approval.
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.readBinary", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.readBinary: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.readBinary: relativePath is required");
    const target = resolveWithinRoot(root, "fs.readBinary", relativePath);

    const buf = await readFile(target);
    if (buf.length > FS_READ_BINARY_MAX_BYTES) {
      return { path: relativePath, base64: "", truncated: true, totalBytes: buf.length };
    }
    return { path: relativePath, base64: buf.toString("base64"), truncated: false, totalBytes: buf.length };
  });

  // Extensions with no sensible plain-text representation to hand an LLM —
  // fs.readDocumentText rejects these with a clear message instead of
  // dumping raw/garbled bytes as "content" (what naively utf8-decoding them
  // would produce).
  const FS_DOCUMENT_TEXT_UNSUPPORTED_EXTS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "ico",
    "mp3",
    "mp4",
    "mov",
    "wav",
    "zip",
    "tar",
    "gz",
    "exe",
    "dmg",
    "sqlite",
    "sqlite3",
  ]);

  const FS_DOCUMENT_TEXT_MAX_CHARS = 50_000;

  // Chat-attachment resolution (ChatView.tsx's resolveAttachments) — unlike
  // fs.read (raw utf8, used by the code editor, must round-trip exactly),
  // this extracts whatever plain text is reasonably available so a PDF (or
  // future format) can be sent as context, not just already-text files.
  register("fs.readDocumentText", async (params, ctx) => {
    await requireFsApproval(ctx, "fs.readDocumentText", params, "moderate");
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.readDocumentText: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.readDocumentText: relativePath is required");
    const target = resolveWithinRoot(root, "fs.readDocumentText", relativePath);
    const ext = relativePath.slice(relativePath.lastIndexOf(".") + 1).toLowerCase();

    let content: string;
    if (ext === "pdf") {
      const bytes = await readFile(target);
      const { extractPdfText } = await import("./documentText.js");
      content = await extractPdfText(bytes);
    } else if (FS_DOCUMENT_TEXT_UNSUPPORTED_EXTS.has(ext)) {
      throw new Error(`fs.readDocumentText: no text representation for .${ext} files`);
    } else {
      content = await readFile(target, "utf8");
    }

    if (content.length > FS_DOCUMENT_TEXT_MAX_CHARS) {
      return {
        path: relativePath,
        content: content.slice(0, FS_DOCUMENT_TEXT_MAX_CHARS),
        truncated: true,
        totalLength: content.length,
      };
    }
    return { path: relativePath, content, truncated: false };
  });

  // No size cap here unlike fs.read's FS_READ_MAX_CHARS — that cap exists to
  // bound a single RPC response; a write's size is entirely caller-supplied
  // and controlled (the editor UI that calls this already has the file open).
  register("fs.write", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.write", params, "destructive", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.write: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.write: relativePath is required");
    const content = params.content !== undefined ? String(params.content) : "";
    const target = resolveWithinRoot(root, "fs.write", relativePath);

    // Creates parent dirs too, so this doubles as "create file" for a brand
    // new path (including one nested under folders that don't exist yet).
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return { ok: true, path: relativePath };
  });

  register("fs.mkdir", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.mkdir", params, "destructive", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.mkdir: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.mkdir: relativePath is required");
    const target = resolveWithinRoot(root, "fs.mkdir", relativePath);

    await mkdir(target, { recursive: true });
    return { ok: true, path: relativePath };
  });

  register("fs.rename", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.rename", params, "destructive", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.rename: this gateway has no workspaceRoot");

    const fromRelativePath = String(params.fromRelativePath ?? "");
    const toRelativePath = String(params.toRelativePath ?? "");
    if (!fromRelativePath || !toRelativePath) {
      throw new Error("fs.rename: fromRelativePath and toRelativePath are required");
    }
    const from = resolveWithinRoot(root, "fs.rename", fromRelativePath);
    const to = resolveWithinRoot(root, "fs.rename", toRelativePath);

    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    return { ok: true, path: toRelativePath };
  });

  register("fs.delete", async (params, ctx) => {
    await requireFsApproval(ctx, "fs.delete", params, "destructive");
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.delete: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.delete: relativePath is required");
    const target = resolveWithinRoot(root, "fs.delete", relativePath);

    // recursive:true so this also handles directories in one call (the
    // renderer must window.confirm before calling this — see FileTreeContextMenu).
    await rm(target, { recursive: true, force: false });
    return { ok: true, path: relativePath };
  });

  const FS_SEARCH_SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".yggdrasil"]);

  const FS_SEARCH_MAX_ENTRIES_SCANNED = 5000;

  const FS_SEARCH_DEFAULT_LIMIT = 50;

  register("fs.search", async (params, ctx) => {
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.search: this gateway has no workspaceRoot");

    const query = String(params.query ?? "").toLowerCase();
    const limit = params.limit !== undefined ? Number(params.limit) : FS_SEARCH_DEFAULT_LIMIT;
    const resolvedRoot = resolve(root);

    const results: Array<{ relativePath: string; type: "file" | "directory" }> = [];
    let scanned = 0;

    async function walk(dir: string): Promise<void> {
      if (results.length >= limit || scanned >= FS_SEARCH_MAX_ENTRIES_SCANNED) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= limit || scanned >= FS_SEARCH_MAX_ENTRIES_SCANNED) return;
        scanned++;
        if (FS_SEARCH_SKIP_DIRS.has(entry.name)) continue;

        const abs = join(dir, entry.name);
        const rel = relative(resolvedRoot, abs).split(sep).join("/");
        const type: "file" | "directory" = entry.isDirectory() ? "directory" : "file";

        if (!query || rel.toLowerCase().includes(query)) {
          results.push({ relativePath: rel, type });
        }
        if (entry.isDirectory()) {
          await walk(abs);
        }
      }
    }

    await walk(resolvedRoot);
    return { entries: results.slice(0, limit) };
  });

  // Names AND text: which files under `root` (a folder relative to the workspace, "" = all of it)
  // mention `query`, with a short snippet of each hit. Reads file contents, so it is gated like fs.read.
  register("fs.searchContent", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.searchContent", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.searchContent: this gateway has no workspaceRoot");

    const scope = String(params.root ?? "");
    resolveWithinRoot(root, "fs.searchContent", scope);
    return searchContent({
      root,
      scope,
      query: String(params.query ?? ""),
      limit: params.limit !== undefined ? Number(params.limit) : undefined,
      maxSnippets: params.maxSnippets !== undefined ? Number(params.maxSnippets) : undefined,
    });
  });

  // Titles and the links between notes under `root` (or just the given `paths`), for the Documents view's
  // `[[` picker and backlinks. Reads file contents, so it is gated like fs.read.
  register("documents.index", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "documents.index", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("documents.index: this gateway has no workspaceRoot");

    const scope = String(params.root ?? "notes");
    resolveWithinRoot(root, "documents.index", scope);
    const paths = Array.isArray(params.paths) ? params.paths.map((p) => String(p)) : undefined;
    for (const p of paths ?? []) resolveWithinRoot(root, "documents.index", p);
    return indexNotes({ root, scope, paths });
  });

  type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "unmerged";

  type GitFileEntry = { path: string; status: GitFileStatus };

  function execGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolvePromise) => {
      execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        // `git diff` (and `--is-inside-work-tree` for a non-repo) exit non-zero
        // for perfectly normal outcomes, not just real errors — callers decide
        // what a given code means for the command they ran.
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolvePromise({ stdout, stderr, code });
      });
    });
  }

  // git status --porcelain=v1 lines are "XY PATH", X=index status, Y=worktree
  // status; a rename is "XY old -> new". Doesn't handle git's quoted-path
  // escaping for unusual filenames (unicode/spaces edge cases) — good enough
  // for a sidebar status list, not a general-purpose porcelain parser.
  function parseGitStatus(output: string): GitFileEntry[] {
    return output
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const x = line[0];
        const y = line[1];
        let path = line.slice(3);
        const arrow = path.indexOf(" -> ");
        if (arrow !== -1) path = path.slice(arrow + 4);

        let status: GitFileStatus;
        if (x === "?" && y === "?") status = "untracked";
        else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) status = "unmerged";
        else if (x === "R" || y === "R") status = "renamed";
        else if (x === "A" || y === "A") status = "added";
        else if (x === "D" || y === "D") status = "deleted";
        else status = "modified";
        return { path, status };
      });
  }

  register("git.status", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "git.status", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("git.status: this gateway has no workspaceRoot");

    const check = await execGit(root, ["rev-parse", "--is-inside-work-tree"]);
    if (check.code !== 0) return { isRepo: false, files: [] };

    const [branchRes, statusRes] = await Promise.all([
      execGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
      execGit(root, ["status", "--porcelain=v1"]),
    ]);
    if (statusRes.code !== 0) {
      throw new Error(`git.status: ${statusRes.stderr || statusRes.stdout || "git status failed"}`);
    }

    return {
      isRepo: true,
      branch: branchRes.code === 0 ? branchRes.stdout.trim() : undefined,
      files: parseGitStatus(statusRes.stdout),
    };
  });

  register("git.diff", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "git.diff", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("git.diff: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("git.diff: relativePath is required");
    const target = resolveWithinRoot(root, "git.diff", relativePath);

    // Untracked files have nothing in the index for `git diff` to compare
    // against — render them as a synthetic "all added" diff instead of
    // shelling out to `git diff --no-index` (which needs a real "empty file"
    // path and isn't cross-platform-clean with /dev/null on Windows).
    if (params.untracked === true) {
      try {
        const content = await readFile(target, "utf8");
        const lines = content.length > 0 ? content.split("\n") : [];
        const diff = [
          `--- /dev/null`,
          `+++ b/${relativePath}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map((line) => `+${line}`),
        ].join("\n");
        return { diff };
      } catch (err) {
        return { diff: `(unable to read file: ${err instanceof Error ? err.message : String(err)})` };
      }
    }

    const res = await execGit(root, ["diff", "--no-color", "--", relativePath]);
    if (res.code > 1) throw new Error(`git.diff: ${res.stderr || res.stdout || "git diff failed"}`);
    return { diff: res.stdout };
  });
}
