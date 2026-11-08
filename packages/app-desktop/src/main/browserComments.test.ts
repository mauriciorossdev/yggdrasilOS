import { describe, expect, it } from "vitest";
import { addComment, listComments, pageKeyFor, removeComment, setCommentsStatus, updateComment, type NewBrowserComment } from "./browserComments.js";
import { buildCommentsPrompt } from "./browserCommentsPrompt.js";

const base: NewBrowserComment = {
  selector: "main > h1.title",
  tag: "h1",
  classes: "title big",
  text: "Hello",
  outerHtml: "<h1 class=\"title big\">Hello</h1>",
  comment: "Hazlo más grande",
  pageUrl: "https://example.com/docs/intro?x=1#top",
  pageTitle: "Intro",
};

describe("pageKeyFor", () => {
  it("drops query and hash", () => {
    expect(pageKeyFor("https://example.com/docs/intro?x=1#top")).toBe("https://example.com/docs/intro");
  });
  it("keeps non-http urls as-is", () => {
    expect(pageKeyFor("about:blank")).toBe("about:blank");
  });
});

describe("comments store model", () => {
  it("adds, lists per page, updates and removes", () => {
    const a = addComment({}, "p1", base, 1);
    const key = pageKeyFor(base.pageUrl);
    expect(listComments(a.file, "p1", key)).toHaveLength(1);
    expect(listComments(a.file, "p2", key)).toHaveLength(0);

    const u = updateComment(a.file, "p1", key, a.comment.id, "nuevo");
    expect(listComments(u, "p1", key)[0].comment).toBe("nuevo");

    const r = removeComment(u, "p1", key, a.comment.id);
    expect(listComments(r, "p1", key)).toHaveLength(0);
    expect(r.p1[key]).toBeUndefined();
  });

  it("does not mutate the input file", () => {
    const empty = {};
    addComment(empty, "p1", base);
    expect(empty).toEqual({});
  });
});

describe("comment status", () => {
  it("starts without status (read as idle), marks sent/done by id, reset on edit", () => {
    const a = addComment({}, "p1", base);
    const key = pageKeyFor(base.pageUrl);
    expect(a.comment.status).toBeUndefined();
    const sent = setCommentsStatus(a.file, "p1", [a.comment.id], "sent", "Claude");
    expect(sent.changed).toBe(true);
    expect(listComments(sent.file, "p1", key)[0]).toMatchObject({ status: "sent", sentTo: "Claude" });
    const done = setCommentsStatus(sent.file, "p1", [a.comment.id], "done");
    expect(listComments(done.file, "p1", key)[0]).toMatchObject({ status: "done", sentTo: "Claude" });
    const edited = updateComment(done.file, "p1", key, a.comment.id, "otro");
    expect(listComments(edited, "p1", key)[0]).toMatchObject({ status: "idle", sentTo: undefined });
  });
  it("unknown id changes nothing", () => {
    const a = addComment({}, "p1", base);
    expect(setCommentsStatus(a.file, "p1", ["nope"], "done").changed).toBe(false);
    expect(setCommentsStatus(a.file, "other", [a.comment.id], "done").changed).toBe(false);
  });
});

describe("comment kind", () => {
  it("defaults to change and drops a scope on it", () => {
    const c = addComment({}, "p1", { ...base, scope: "page" }).comment;
    expect(c.kind).toBe("change");
    expect(c.scope).toBeUndefined();
  });
  it("coerces unknown kinds/scopes coming over IPC", () => {
    expect(addComment({}, "p1", { ...base, kind: "weird" as never }).comment.kind).toBe("change");
    const cap = addComment({}, "p1", { ...base, kind: "capture", scope: "nonsense" as never }).comment;
    expect(cap).toMatchObject({ kind: "capture", scope: "element" });
    expect(addComment({}, "p1", { ...base, kind: "capture", scope: "url" }).comment.scope).toBe("url");
  });
});

describe("buildCommentsPrompt", () => {
  it("includes base instruction, url path, element and description", () => {
    const { comment } = addComment({}, "p1", base);
    const out = buildCommentsPrompt([comment], base.pageUrl);
    expect(out).toContain("cambios solicitados sobre la vista web");
    expect(out).toContain("path: /docs/intro");
    expect(out).toContain(`id: ${comment.id}`);
    expect(out).toContain("browser_comment_done");
    expect(out).toContain("selector `main > h1.title`");
    expect(out).toContain("Descripción: Hazlo más grande");
    expect(out.endsWith("\n")).toBe(false);
  });

  it("capture-only prompt has no change/code instructions and lists the bundle file", () => {
    const { comment } = addComment({}, "p1", { ...base, kind: "capture", scope: "article", comment: "resumido en notes/web/" });
    const out = buildCommentsPrompt([comment], base.pageUrl, new Map([[comment.id, ".yggdrasil/captures/x.md"]]));
    expect(out).not.toContain("código fuente");
    expect(out).toContain("### Captura 1");
    expect(out).toContain("Alcance: artículo");
    expect(out).toContain("Archivo: .yggdrasil/captures/x.md");
    expect(out).toContain("Instrucción: resumido en notes/web/");
    expect(out).toContain("`notes/`");
    expect(out).toContain("browser_save_asset");
  });
  it("empty capture instruction falls back to a default", () => {
    const { comment } = addComment({}, "p1", { ...base, kind: "capture", scope: "page", comment: "  " });
    expect(buildCommentsPrompt([comment], base.pageUrl)).toContain("(ninguna: guarda el contenido completo en notes/)");
  });

  it("numbers several comments and clips long html", () => {
    const long = { ...base, outerHtml: "x".repeat(2000) };
    const a = addComment({}, "p1", long).comment;
    const b = addComment({}, "p1", base).comment;
    const out = buildCommentsPrompt([a, b], base.pageUrl);
    expect(out).toContain("### Cambio 1");
    expect(out).toContain("### Cambio 2");
    expect(out.length).toBeLessThan(1500);
  });
});
