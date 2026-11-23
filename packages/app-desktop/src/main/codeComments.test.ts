import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  addCodeComment,
  clearDoneCodeComments,
  listCodeComments,
  removeCodeComment,
  sanitizeNewCodeComment,
  setCodeCommentsStatus,
  updateCodeComment,
  type CodeComment,
  type CodeCommentsFile,
  type NewCodeComment,
} from "./codeComments.js";
import { buildCodeReviewPrompt } from "./codeCommentsPrompt.js";
import { createCodeCommentsHost, repoLabel } from "./codeCommentsHost.js";

const input = (over: Partial<NewCodeComment> = {}): NewCodeComment => ({
  path: "src/a.ts",
  side: "modified",
  startLine: 3,
  endLine: 4,
  snippet: "const a = 1;\nconst b = 2;",
  comment: "rename",
  ...over,
});

describe("code comments model", () => {
  it("adds per repo root, edits back to idle, removes and clears done", () => {
    let file: CodeCommentsFile = {};
    const a = addCodeComment(file, "p", "/r", input(), 1);
    file = a.file;
    file = addCodeComment(file, "p", "/r", input({ comment: "two" }), 2).file;
    file = addCodeComment(file, "p", "/other", input(), 3).file;
    expect(listCodeComments(file, "p", "/r").map((c) => c.comment)).toEqual(["rename", "two"]);

    const sent = setCodeCommentsStatus(file, "p", [a.comment.id], "sent", "pane-1");
    expect(sent.repoRoots).toEqual(["/r"]);
    file = updateCodeComment(sent.file, "p", "/r", a.comment.id, "  renamed  ");
    expect(listCodeComments(file, "p", "/r")[0]).toMatchObject({ comment: "renamed", status: "idle", sentTo: undefined });

    file = setCodeCommentsStatus(file, "p", [a.comment.id], "done").file;
    file = clearDoneCodeComments(file, "p", "/r");
    expect(listCodeComments(file, "p", "/r").map((c) => c.comment)).toEqual(["two"]);

    const last = listCodeComments(file, "p", "/r")[0]!;
    file = removeCodeComment(file, "p", "/r", last.id);
    expect(file.p).toEqual({ "/other": expect.any(Array) });
  });

  it("an unknown id changes nothing", () => {
    const file = addCodeComment({}, "p", "/r", input()).file;
    const res = setCodeCommentsStatus(file, "p", ["nope"], "done");
    expect(res).toEqual({ file, changed: false, repoRoots: [] });
  });

  it("sanitizes what the renderer sends", () => {
    expect(sanitizeNewCodeComment({ ...input(), path: "..\\x\\..\\y" })).toBeUndefined();
    expect(sanitizeNewCodeComment({ ...input(), comment: "   " })).toBeUndefined();
    expect(sanitizeNewCodeComment({ ...input(), startLine: 5, endLine: 2 })).toBeUndefined();
    expect(sanitizeNewCodeComment({ ...input(), side: "weird", commitSha: "nothex!", path: "/src/a.ts" })).toMatchObject({
      side: "modified",
      commitSha: undefined,
      path: "src/a.ts",
    });
  });
});

describe("buildCodeReviewPrompt", () => {
  const c = (over: Partial<CodeComment>): CodeComment => ({
    ...input(),
    id: "id1",
    createdAt: 0,
    status: "idle",
    ...over,
  });

  it("lists every comment with its file, lines, code and text", () => {
    const text = buildCodeReviewPrompt(
      [
        c({}),
        c({ id: "id2", path: "lib/x.py", side: "original", startLine: 9, endLine: 9, snippet: "x = 1", comment: "why removed?" }),
        c({ id: "id3", commitSha: "abcdef123456", snippet: "", comment: "old" }),
      ],
      "el worktree fix (/w/fix)",
    );
    expect(text.startsWith("Estos son comentarios de revisión sobre el código en el worktree fix (/w/fix).")).toBe(true);
    expect(text).toContain("### Comentario 1 (id: id1)\nArchivo: src/a.ts, líneas 3-4\n```ts\nconst a = 1;\nconst b = 2;\n```\nComentario: rename");
    expect(text).toContain("Archivo: lib/x.py, línea 9 (líneas borradas en el diff)\n```python");
    expect(text).toContain("Archivo: src/a.ts, líneas 3-4 (en el commit abcdef1)\nComentario: old");
    expect(text.endsWith("Comentario: old")).toBe(true);
  });

  it("clips long snippets and keeps backticks in the code from closing the fence", () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    expect(buildCodeReviewPrompt([c({ snippet: long })], "r")).toContain("… (10 líneas más)");
    const md = buildCodeReviewPrompt([c({ path: "a.md", snippet: "```js\nx\n```" })], "r");
    expect(md).toContain("````md\n```js\nx\n```\n````");
  });
});

describe("repoLabel", () => {
  it("names app and claude worktrees as worktrees", () => {
    expect(repoLabel("/p/.yggdrasil/worktrees/fix")).toBe("el worktree fix (/p/.yggdrasil/worktrees/fix)");
    expect(repoLabel("/p/.claude/worktrees/b")).toBe("el worktree b (/p/.claude/worktrees/b)");
    expect(repoLabel("/code/my-app")).toBe("el repositorio my-app (/code/my-app)");
  });
});

describe("codeCommentsHost", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "code-comments-")));
  const project = join(base, "proj");
  const wt = join(project, ".yggdrasil", "worktrees", "fix");
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(join(wt, "src"), { recursive: true });
  writeFileSync(join(project, "src", "a.ts"), "");
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const setup = () => {
    const stored: CodeComment[] = [];
    const writes: Array<{ id: string; text: string }> = [];
    const changed: string[] = [];
    const host = createCodeCommentsHost({
      projectPath: async () => project,
      gitToplevel: async (dir) => (dir.startsWith(wt) ? wt : dir.startsWith(project) ? project : undefined),
      store: {
        list: async () => stored,
        add: async (_root, c) => {
          const full: CodeComment = { ...c, id: `c${stored.length + 1}`, createdAt: 0, status: "idle" };
          stored.push(full);
          return full;
        },
        update: async () => {},
        remove: async () => {},
        clearDone: async () => {},
        dropRoot: async () => {},
        setStatus: async (ids, status, sentTo) => {
          stored.forEach((c) => ids.includes(c.id) && Object.assign(c, { status, sentTo }));
          return ["x"];
        },
      },
      panes: {
        list: async () => [
          { id: "p1", title: "fixer", cwd: wt, command: "claude" },
          { id: "sh", title: "shell", cwd: wt },
        ],
        create: vi.fn(),
        write: async (id, text) => void writes.push({ id, text }),
        read: () => "",
      },
      providers: () => [],
      changed: (root) => changed.push(root),
    });
    return { host, stored, writes, changed };
  };

  it("locates files in the project repo and in worktrees, including deleted files", async () => {
    const { host } = setup();
    expect(await host.locate("src/a.ts")).toMatchObject({ root: project, path: "src/a.ts" });
    expect(await host.locate(".yggdrasil/worktrees/fix")).toMatchObject({ root: wt, path: "" });
    expect(await host.locate(".yggdrasil/worktrees/fix/src/gone/b.ts")).toMatchObject({ root: wt, path: "src/gone/b.ts" });
    expect(await host.locate("../elsewhere/x.ts")).toBeUndefined();
  });

  it("refuses roots it didn't resolve, then sends the idle comments to a pane and marks them sent", async () => {
    const { host, stored, writes, changed } = setup();
    await expect(host.add(wt, input())).rejects.toThrow(/Unknown repository root/);
    const { root } = (await host.locate(".yggdrasil/worktrees/fix"))!;
    await host.add(root, input());
    await host.add(root, input({ comment: "second" }));
    stored[1]!.status = "done";

    expect(await host.send({ root, target: { kind: "pane", paneId: "p1", name: "fixer" } })).toEqual({ ok: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.text).toContain("(id: c1)");
    expect(writes[0]!.text).not.toContain("second");
    expect(stored[0]).toMatchObject({ status: "sent", sentTo: "fixer" });
    expect(changed).toContain(root);

    expect(await host.send({ root, target: { kind: "pane", paneId: "p1" } })).toEqual({ ok: false, error: "No comments to send" });
  });

  it("never offers or types into a plain shell pane", async () => {
    const { host, writes } = setup();
    const { root } = (await host.locate(".yggdrasil/worktrees/fix"))!;
    await host.add(root, input());
    expect((await host.targets()).panes.map((p) => p.id)).toEqual(["p1"]);
    expect(await host.send({ root, target: { kind: "pane", paneId: "sh" } })).toEqual({ ok: false, error: "That pane is not running an agent" });
    expect(writes).toHaveLength(0);
  });
});
