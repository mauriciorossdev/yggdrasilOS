// Script the Browser tab runs inside the loaded page (webContents.executeJavaScript)
// for browser_extract / browser_save_asset: full-fidelity page content as
// Markdown (headings, links, lists, code, tables, images with absolute URLs)
// instead of browser_read's truncated plain text. Same conventions as
// browserPageScripts.ts: an async IIFE, JSON-encoded arguments only (never raw
// concatenation), never throws — failures come back as `{ ok: false, error }`.
//
// The page is untrusted. Everything this returns is page-controlled data.

export type ExtractMode = "element" | "article" | "page";

export const DEFAULT_EXTRACT_MAX_CHARS = 100_000;
export const MAX_EXTRACT_MAX_CHARS = 500_000;

export function clampExtractChars(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_EXTRACT_MAX_CHARS;
  return Math.min(Math.floor(value), MAX_EXTRACT_MAX_CHARS);
}

export type ExtractedPage = {
  url: string;
  title: string;
  mode: ExtractMode;
  selector?: string;
  markdown: string;
  truncated: boolean;
  totalChars: number;
  meta: { author?: string; published?: string; description?: string; siteName?: string; canonical?: string; lang?: string; image?: string };
  images: Array<{ src: string; alt: string }>;
  links: Array<{ href: string; text: string }>;
  /** `data:` images are not listed (they'd bloat the result) — only counted. */
  skippedDataImages: number;
};

// Built with String.raw so the in-page regexes keep their backslashes; the
// script itself never uses template literals or backticks (it needs the
// backtick character for Markdown code, so it builds it with fromCharCode).
const EXTRACT_SOURCE = String.raw`(async function () {
  try {
    var opts = __OPTS__;
    var TICK = String.fromCharCode(96);
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, IFRAME: 1, CANVAS: 1, HEAD: 1, OBJECT: 1, EMBED: 1 };
    var CHROME = { NAV: 1, ASIDE: 1, FOOTER: 1 };
    var buf = "";
    var images = [], links = [], seenImg = {}, seenLink = {}, skippedData = 0;
    var inArticle = opts.mode === "article";

    function abs(u) { try { return new URL(u, document.baseURI).href; } catch (e) { return ""; } }
    function squash(s) { return s.replace(/\s+/g, " "); }
    function isHidden(el) {
      if (el.hasAttribute && (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true")) return true;
      if (typeof getComputedStyle === "function") {
        var cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return true;
      }
      return false;
    }
    function nl(n) {
      if (buf === "") return;
      buf = buf.replace(/[ \t]+$/, "");
      var have = buf.match(/\n*$/)[0].length;
      while (have < n) { buf += "\n"; have++; }
    }
    function capture(fn) { var saved = buf; buf = ""; fn(); var r = buf; buf = saved; return r; }
    function kids(node, ctx) { for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i], ctx); }
    function descendants(node, tag, out) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var c = node.childNodes[i];
        if (c.nodeType !== 1) continue;
        var t = String(c.nodeName).toUpperCase();
        if (t === tag) out.push(c);
        else if (t !== "TABLE") descendants(c, tag, out);
      }
      return out;
    }
    function cellText(cell) { return squash(capture(function () { kids(cell, {}); })).replace(/\|/g, "\\|").trim(); }

    function walk(node, ctx) {
      if (node.nodeType === 3) {
        var t = ctx.pre ? node.nodeValue : squash(node.nodeValue);
        if (!ctx.pre && (buf === "" || /\s$/.test(buf))) t = t.replace(/^ /, "");
        buf += t;
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = String(node.nodeName).toUpperCase();
      if (SKIP[tag] || isHidden(node)) return;
      if (inArticle && CHROME[tag]) return;
      var m = /^H([1-6])$/.exec(tag);
      if (m) {
        nl(2); buf += new Array(Number(m[1]) + 1).join("#") + " ";
        kids(node, ctx); nl(2); return;
      }
      switch (tag) {
        case "P": case "FIGURE": case "FIGCAPTION": case "ADDRESS":
          nl(2); kids(node, ctx); nl(2); return;
        case "DIV": case "SECTION": case "ARTICLE": case "MAIN": case "HEADER": case "DETAILS": case "SUMMARY": case "FORM":
          nl(1); kids(node, ctx); nl(1); return;
        case "BR": buf += "\n"; return;
        case "HR": nl(2); buf += "---"; nl(2); return;
        case "UL": case "OL":
          nl(1); kids(node, { list: { ordered: tag === "OL", n: 0, depth: ctx.list ? ctx.list.depth + 1 : 1 } }); nl(1); return;
        case "LI": {
          var list = ctx.list || { ordered: false, n: 0, depth: 1 };
          list.n++;
          nl(1);
          buf += new Array(list.depth).join("  ") + (list.ordered ? list.n + ". " : "- ");
          kids(node, ctx); nl(1); return;
        }
        case "A": {
          var href = node.getAttribute("href");
          if (!href || /^\s*(javascript:|#)/i.test(href)) { kids(node, ctx); return; }
          var full = abs(href);
          var label = squash(capture(function () { kids(node, ctx); })).trim();
          if (!full || !/^https?:/i.test(full)) { buf += label; return; }
          buf += "[" + label + "](" + full + ")";
          if (!seenLink[full] && links.length < 300) { seenLink[full] = 1; links.push({ href: full, text: label.slice(0, 120) }); }
          return;
        }
        case "IMG": {
          var raw = node.currentSrc || node.getAttribute("src") || node.getAttribute("data-src") || "";
          var alt = squash(node.getAttribute("alt") || "").trim();
          if (/^data:/i.test(raw)) { skippedData++; return; }
          var src = raw ? abs(raw) : "";
          if (!src) return;
          buf += "![" + alt + "](" + src + ")";
          if (!seenImg[src] && images.length < 200) { seenImg[src] = 1; images.push({ src: src, alt: alt }); }
          return;
        }
        case "STRONG": case "B": buf += "**"; kids(node, ctx); buf += "**"; return;
        case "EM": case "I": buf += "*"; kids(node, ctx); buf += "*"; return;
        case "CODE":
          if (ctx.pre) { kids(node, ctx); return; }
          buf += TICK; kids(node, ctx); buf += TICK; return;
        case "PRE": {
          var fence = TICK + TICK + TICK;
          nl(2); buf += fence + "\n" + (node.textContent || "").replace(/\n+$/, "") + "\n" + fence; nl(2); return;
        }
        case "BLOCKQUOTE": {
          var inner = capture(function () { kids(node, ctx); }).replace(/\n{3,}/g, "\n\n").trim();
          nl(2);
          buf += inner.split("\n").map(function (l) { return "> " + l; }).join("\n");
          nl(2); return;
        }
        case "TABLE": {
          var rows = descendants(node, "TR", []);
          if (rows.length === 0) { kids(node, ctx); return; }
          nl(2);
          rows.forEach(function (tr, ri) {
            var cells = [];
            for (var i = 0; i < tr.childNodes.length; i++) {
              var c = tr.childNodes[i];
              var ct = c.nodeType === 1 ? String(c.nodeName).toUpperCase() : "";
              if (ct === "TD" || ct === "TH") cells.push(cellText(c));
            }
            if (cells.length === 0) return;
            buf += "| " + cells.join(" | ") + " |\n";
            if (ri === 0) buf += "|" + cells.map(function () { return " --- |"; }).join("") + "\n";
          });
          nl(2); return;
        }
        default: kids(node, ctx);
      }
    }

    function metaContent(sel) { var el = document.querySelector(sel); return el ? (el.getAttribute("content") || "").trim() : ""; }
    function pickArticle() {
      var cands = document.querySelectorAll('article, main, [role="main"]');
      var best = null, bestLen = 0;
      for (var i = 0; i < cands.length; i++) {
        if (isHidden(cands[i])) continue;
        var l = (cands[i].textContent || "").length;
        if (l > bestLen) { best = cands[i]; bestLen = l; }
      }
      if (best && bestLen > 400) return best;
      var blocks = document.querySelectorAll("div, section");
      var dense = null, denseScore = 0;
      for (var j = 0; j < blocks.length; j++) {
        var score = 0;
        for (var k = 0; k < blocks[j].childNodes.length; k++) {
          var ch = blocks[j].childNodes[k];
          if (ch.nodeType === 1 && String(ch.nodeName).toUpperCase() === "P") score += (ch.textContent || "").length;
        }
        if (score > denseScore) { dense = blocks[j]; denseScore = score; }
      }
      if (dense && denseScore >= 200) return dense;
      return best || document.body;
    }

    var root;
    if (opts.mode === "element") {
      root = document.querySelector(opts.selector);
      if (!root) return { ok: false, error: "No element matches the selector." };
    } else if (opts.mode === "article") {
      root = pickArticle();
    } else {
      root = document.body;
    }
    if (!root) return { ok: false, error: "The page has no content to extract." };

    walk(root, {});
    var md = buf.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    var max = opts.maxChars;
    var meta = {};
    var author = metaContent('meta[name="author"]') || metaContent('meta[property="article:author"]');
    var published = metaContent('meta[property="article:published_time"]');
    if (!published) { var tm = document.querySelector("time[datetime]"); if (tm) published = tm.getAttribute("datetime") || ""; }
    var description = metaContent('meta[name="description"]') || metaContent('meta[property="og:description"]');
    var siteName = metaContent('meta[property="og:site_name"]');
    var canon = document.querySelector('link[rel="canonical"]');
    var ogImage = metaContent('meta[property="og:image"]');
    if (author) meta.author = author;
    if (published) meta.published = published;
    if (description) meta.description = description;
    if (siteName) meta.siteName = siteName;
    if (canon && canon.getAttribute("href")) meta.canonical = abs(canon.getAttribute("href"));
    if (document.documentElement && document.documentElement.lang) meta.lang = document.documentElement.lang;
    if (ogImage) meta.image = abs(ogImage);

    var out = {
      ok: true, url: location.href, title: document.title, mode: opts.mode,
      markdown: md.length > max ? md.slice(0, max) : md,
      truncated: md.length > max, totalChars: md.length,
      meta: meta, images: images, links: links, skippedDataImages: skippedData
    };
    if (opts.mode === "element") out.selector = opts.selector;
    return out;
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
})()`;

export function buildExtractScript(opts: { mode: ExtractMode; selector?: string; maxChars?: number }): string {
  const payload = { mode: opts.mode, selector: opts.selector ?? "", maxChars: clampExtractChars(opts.maxChars) };
  return EXTRACT_SOURCE.replace("__OPTS__", () => JSON.stringify(payload));
}

/** Resolves what asset an element stands for (img/video/audio source, link target, CSS background image) to an absolute URL. */
export function buildAssetUrlScript(selector: string): string {
  return `(async function () {
  try {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: "No element matches the selector." };
    var tag = el.tagName;
    var raw = "";
    if (tag === "IMG" || tag === "VIDEO" || tag === "AUDIO" || tag === "SOURCE") raw = el.currentSrc || el.getAttribute("src") || "";
    else if (tag === "A") raw = el.getAttribute("href") || "";
    if (!raw && typeof getComputedStyle === "function") {
      var bg = getComputedStyle(el).backgroundImage || "";
      var m = /url\\((?:"|')?([^"')]+)(?:"|')?\\)/.exec(bg);
      if (m) raw = m[1];
    }
    if (!raw) return { ok: false, error: "The element has no image, media source or link target to save." };
    if (/^data:/i.test(raw)) return { ok: true, url: raw, pageUrl: location.href };
    return { ok: true, url: new URL(raw, document.baseURI).href, pageUrl: location.href };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
})()`;
}
