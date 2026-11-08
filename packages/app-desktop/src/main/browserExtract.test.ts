import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildAssetUrlScript, buildExtractScript, clampExtractChars, type ExtractedPage } from "./browserExtract.js";

// Minimal DOM: just what the extraction script touches (no jsdom in this repo).
type N = FakeEl | FakeText;
class FakeText {
  nodeType = 3;
  nodeName = "#text";
  constructor(public nodeValue: string) {}
  get textContent() {
    return this.nodeValue;
  }
}
class FakeEl {
  nodeType = 1;
  nodeName: string;
  childNodes: N[];
  constructor(tag: string, public attrs: Record<string, string>, children: Array<N | string>) {
    this.nodeName = tag.toUpperCase();
    this.childNodes = children.map((c) => (typeof c === "string" ? new FakeText(c) : c));
  }
  get tagName() {
    return this.nodeName;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  get currentSrc() {
    return undefined;
  }
  getAttribute(n: string) {
    return this.attrs[n] ?? null;
  }
  hasAttribute(n: string) {
    return n in this.attrs;
  }
  all(): FakeEl[] {
    return this.childNodes.flatMap((c) => (c instanceof FakeEl ? [c, ...c.all()] : []));
  }
}
const el = (tag: string, attrs: Record<string, string> = {}, ...children: Array<N | string>) => new FakeEl(tag, attrs, children);

function matches(e: FakeEl, simple: string): boolean {
  const s = simple.trim();
  if (s.startsWith("#")) return e.attrs.id === s.slice(1);
  if (s.startsWith(".")) return (e.attrs.class ?? "").split(/\s+/).includes(s.slice(1));
  const attr = /^\[(\w+)="([^"]*)"\]$/.exec(s);
  if (attr) return e.attrs[attr[1]!] === attr[2];
  const tagAttr = /^(\w+)\[(\w+)\]$/.exec(s);
  if (tagAttr) return e.nodeName === tagAttr[1]!.toUpperCase() && tagAttr[2]! in e.attrs;
  const tagAttrVal = /^(\w+)\[(\w+)="([^"]*)"\]$/.exec(s);
  if (tagAttrVal) return e.nodeName === tagAttrVal[1]!.toUpperCase() && e.attrs[tagAttrVal[2]!] === tagAttrVal[3];
  return e.nodeName === s.toUpperCase();
}

async function run(body: FakeEl[], opts: Parameters<typeof buildExtractScript>[0], head: FakeEl[] = []): Promise<ExtractedPage & { ok: boolean; error?: string }> {
  const bodyEl = el("body", {}, ...body);
  const html = el("html", { lang: "es" }, el("head", {}, ...head), bodyEl);
  const query = (sel: string) => {
    const out = html.all().filter((e) => sel.split(",").some((part) => matches(e, part)));
    return out;
  };
  const document = {
    baseURI: "https://example.com/blog/post",
    title: "Post",
    body: bodyEl,
    documentElement: { lang: "es" },
    querySelector: (s: string) => query(s)[0] ?? null,
    querySelectorAll: (s: string) => query(s),
  };
  const sandbox = { document, location: { href: "https://example.com/blog/post?x=1" }, URL, String, Array, Number };
  return (await runInNewContext(buildExtractScript(opts), sandbox)) as never;
}

describe("clampExtractChars", () => {
  it("defaults and caps", () => {
    expect(clampExtractChars(undefined)).toBe(100_000);
    expect(clampExtractChars(-1)).toBe(100_000);
    expect(clampExtractChars(10_000_000)).toBe(500_000);
    expect(clampExtractChars(500)).toBe(500);
  });
});

describe("buildExtractScript", () => {
  it("parses and embeds options as JSON (no injection through the selector)", () => {
    const script = buildExtractScript({ mode: "element", selector: '"); alert(1); ("' });
    expect(() => new Function(`return ${script}`)).not.toThrow();
    expect(script).toContain(JSON.stringify('"); alert(1); ("'));
  });

  it("converts headings, paragraphs, formatting, links and images with absolute URLs", async () => {
    const r = await run(
      [
        el("h1", {}, "Title"),
        el("p", {}, "Hello ", el("strong", {}, "bold"), " and ", el("em", {}, "it"), " ", el("a", { href: "/other" }, "link"), "."),
        el("img", { src: "/img/a.png", alt: "pic" }),
      ],
      { mode: "page" },
    );
    expect(r.ok).toBe(true);
    expect(r.markdown).toBe("# Title\n\nHello **bold** and *it* [link](https://example.com/other).\n\n![pic](https://example.com/img/a.png)");
    expect(r.images).toEqual([{ src: "https://example.com/img/a.png", alt: "pic" }]);
    expect(r.links).toEqual([{ href: "https://example.com/other", text: "link" }]);
    expect(r.url).toBe("https://example.com/blog/post?x=1");
  });

  it("handles lists (nested), code, quotes and tables", async () => {
    const r = await run(
      [
        el("ul", {}, el("li", {}, "a", el("ul", {}, el("li", {}, "a1"))), el("li", {}, "b")),
        el("ol", {}, el("li", {}, "one"), el("li", {}, "two")),
        el("pre", {}, el("code", {}, "let x = 1;\n")),
        el("p", {}, "use ", el("code", {}, "npm i")),
        el("blockquote", {}, el("p", {}, "quoted")),
        el("table", {}, el("tr", {}, el("th", {}, "k"), el("th", {}, "v")), el("tr", {}, el("td", {}, "a|b"), el("td", {}, "1"))),
      ],
      { mode: "page" },
    );
    expect(r.markdown).toContain("- a\n  - a1\n- b");
    expect(r.markdown).toContain("1. one\n2. two");
    expect(r.markdown).toContain("```\nlet x = 1;\n```");
    expect(r.markdown).toContain("use `npm i`");
    expect(r.markdown).toContain("> quoted");
    expect(r.markdown).toContain("| k | v |\n| --- | --- |\n| a\\|b | 1 |");
  });

  it("skips scripts, styles, hidden nodes and javascript: links; counts data: images", async () => {
    const r = await run(
      [
        el("script", {}, "evil()"),
        el("style", {}, "p{}"),
        el("p", { hidden: "" }, "secret"),
        el("p", { "aria-hidden": "true" }, "also secret"),
        el("p", {}, el("a", { href: "javascript:x()" }, "nolink"), el("img", { src: "data:image/png;base64,AAAA" })),
      ],
      { mode: "page" },
    );
    expect(r.markdown).toBe("nolink");
    expect(r.skippedDataImages).toBe(1);
  });

  it("element mode extracts only the selected element, error when missing", async () => {
    const body = [el("p", {}, "outside"), el("div", { id: "box" }, el("p", {}, "inside"))];
    const ok = await run(body, { mode: "element", selector: "#box" });
    expect(ok.markdown).toBe("inside");
    expect(ok.selector).toBe("#box");
    const missing = await run(body, { mode: "element", selector: "#nope" });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/No element/);
  });

  it("article mode picks <article> and drops nav/aside/footer inside it", async () => {
    const long = "word ".repeat(120);
    const r = await run(
      [
        el("nav", {}, "MENU"),
        el("article", {}, el("h1", {}, "Real"), el("p", {}, long), el("aside", {}, "ad"), el("footer", {}, "foot")),
        el("p", {}, "outside article"),
      ],
      { mode: "article" },
    );
    expect(r.markdown.startsWith("# Real")).toBe(true);
    expect(r.markdown).not.toContain("MENU");
    expect(r.markdown).not.toContain("outside article");
    expect(r.markdown).not.toContain("ad");
    expect(r.markdown).not.toContain("foot");
  });

  it("truncates to maxChars and reports the total", async () => {
    const r = await run([el("p", {}, "x".repeat(1000))], { mode: "page", maxChars: 100 });
    expect(r.markdown).toHaveLength(100);
    expect(r.truncated).toBe(true);
    expect(r.totalChars).toBe(1000);
  });

  it("collects page meta", async () => {
    const r = await run(
      [el("p", {}, "hi")],
      { mode: "page" },
      [el("meta", { name: "author", content: "Ana" }), el("meta", { property: "og:site_name", content: "Blog" })],
    );
    expect(r.meta).toMatchObject({ author: "Ana", siteName: "Blog", lang: "es" });
  });
});

describe("buildAssetUrlScript", () => {
  it("parses and embeds the selector as JSON", () => {
    const script = buildAssetUrlScript('img[alt="x"]');
    expect(() => new Function(`return ${script}`)).not.toThrow();
    expect(script).toContain(JSON.stringify('img[alt="x"]'));
  });
});
