import { describe, expect, it, vi } from "vitest";
import { addComment, pageKeyFor, type BrowserComment, type NewBrowserComment } from "./browserComments.js";
import type { ExtractedPage } from "./browserExtract.js";
import { createBrowserCommentsHost, waitForPaneReady } from "./browserCommentsHost.js";

const url = "https://example.com/a";
const mk = (comment: string, extra: Partial<NewBrowserComment> = {}) =>
  addComment({}, "p", {
    selector: "h1", tag: "h1", text: "t", outerHtml: "<h1>t</h1>", comment, pageUrl: url, pageTitle: "A", ...extra,
  }).comment;

const fakePage = (over: Partial<ExtractedPage> = {}) => ({
  extract: vi.fn(async (_opts: { mode: string; selector?: string }) =>
    ({ url, title: "A", mode: "element", markdown: "# Full content", truncated: false, totalChars: 14, meta: {}, images: [], links: [], skippedDataImages: 0, ...over }) as ExtractedPage),
});

function setup(opts: { read?: (id: string) => string | undefined; comments?: BrowserComment[] } = {}) {
  const comments = opts.comments ?? [mk("ALPHA"), mk("BETA")];
  const written: Array<{ name: string; content: string }> = [];
  const setStatus = vi.fn(async (_ids: string[], _status: string, _sentTo?: string) => true);
  const panes = {
    list: vi.fn(async () => [{ id: "x", title: "X" }]),
    create: vi.fn(async (_spec: { command: string; title: string }) => ({ id: "new" })),
    write: vi.fn(async (_id: string, _text: string, _enter: boolean) => {}),
    read: vi.fn(opts.read ?? (() => "ready>")),
  };
  const host = createBrowserCommentsHost({
    store: { list: async () => comments, add: vi.fn(), update: vi.fn(), remove: vi.fn(), setStatus },
    panes,
    captures: { write: async (name: string, content: string) => (written.push({ name, content }), `.yggdrasil/captures/${name}`) },
    now: () => new Date(2026, 9, 28, 14, 30, 5),
    providers: () => [{ id: "claude", label: "Claude", command: "claude" }],
    sleep: async () => {},
  });
  return { host, panes, comments, setStatus, written };
}

describe("comments host send", () => {
  it("writes the prompt to an existing pane", async () => {
    const { host, panes, comments, setStatus } = setup();
    const r = await host.send({ pageUrl: url, ids: [comments[0]!.id], target: { kind: "pane", paneId: "x", name: "X" } }, fakePage());
    expect(r.ok).toBe(true);
    expect(setStatus).toHaveBeenCalledWith([comments[0]!.id], "sent", "X");
    const [id, text, enter] = panes.write.mock.calls[0]!;
    expect(id).toBe("x");
    expect(enter).toBe(true);
    expect(text).toContain("ALPHA");
    expect(text).not.toContain("BETA");
  });

  it("send all when ids omitted", async () => {
    const { host, panes } = setup();
    await host.send({ pageUrl: url, target: { kind: "pane", paneId: "x" } }, fakePage());
    const text = panes.write.mock.calls[0]![1] as string;
    expect(text).toContain("ALPHA");
    expect(text).toContain("BETA");
  });

  it("creates a pane for a known provider, waits, then writes", async () => {
    const { host, panes } = setup();
    const r = await host.send({ pageUrl: url, target: { kind: "new", command: "claude", label: "Claude" } }, fakePage());
    expect(r.ok).toBe(true);
    expect(panes.create).toHaveBeenCalledWith({ command: "claude", title: "Claude" });
    expect(panes.write.mock.calls[0]![0]).toBe("new");
  });

  it("rejects commands the renderer never offered", async () => {
    const { host, panes } = setup();
    const r = await host.send({ pageUrl: url, target: { kind: "new", command: "rm", label: "x" } }, fakePage());
    expect(r.ok).toBe(false);
    expect(panes.create).not.toHaveBeenCalled();
  });

  it("reports when the pane never becomes ready", async () => {
    let n = 0;
    const { host, panes, setStatus } = setup({ read: () => `frame${n++}` });
    const r = await host.send({ pageUrl: url, target: { kind: "new", command: "claude", label: "Claude" } }, fakePage());
    expect(r.ok).toBe(false);
    expect(panes.write).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("errors with nothing to send", async () => {
    const { host } = setup();
    const r = await host.send({ pageUrl: url, ids: ["nope"], target: { kind: "pane", paneId: "x" } }, fakePage());
    expect(r.ok).toBe(false);
  });
});

describe("capture comments", () => {
  const capture = (scope: "element" | "article" | "page" | "url", comment = "") =>
    mk(comment, { kind: "capture", scope, selector: scope === "element" ? "#box" : "", tag: scope === "element" ? "div" : "page" });

  it("extracts from the sending page, writes a bundle and points the agent at it", async () => {
    const c = capture("article", "resumido");
    const { host, panes, written } = setup({ comments: [c] });
    const page = fakePage();
    const r = await host.send({ pageUrl: url, target: { kind: "pane", paneId: "x", name: "X" } }, page);
    expect(r.ok).toBe(true);
    expect(page.extract).toHaveBeenCalledWith({ mode: "article", selector: undefined });
    expect(written).toHaveLength(1);
    expect(written[0]!.name.startsWith("20261028-143005-")).toBe(true);
    expect(written[0]!.content).toContain("# Full content");
    const text = panes.write.mock.calls[0]![1] as string;
    expect(text).toContain(`Archivo: .yggdrasil/captures/${written[0]!.name}`);
    expect(text).toContain("Instrucción: resumido");
    expect(text).not.toContain("# Full content"); // the content travels in the file, not the prompt
  });

  it("element scope extracts by the comment's selector", async () => {
    const { host } = setup({ comments: [capture("element")] });
    const page = fakePage();
    await host.send({ pageUrl: url, target: { kind: "pane", paneId: "x" } }, page);
    expect(page.extract).toHaveBeenCalledWith({ mode: "element", selector: "#box" });
  });

  it("url scope needs no extraction but still writes a bundle", async () => {
    const { host, written } = setup({ comments: [capture("url")] });
    const page = fakePage();
    const r = await host.send({ pageUrl: url, target: { kind: "pane", paneId: "x" } }, page);
    expect(r.ok).toBe(true);
    expect(page.extract).not.toHaveBeenCalled();
    expect(written[0]!.content).toContain(`Enlace guardado: ${url}`);
  });

  it("a failed extraction aborts the send and marks nothing as sent", async () => {
    const { host, panes, setStatus, written } = setup({ comments: [capture("element")] });
    const page = { extract: vi.fn(async () => { throw new Error("No element matches the selector."); }) };
    const r = await host.send({ pageUrl: url, target: { kind: "pane", paneId: "x" } }, page);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not capture element.*No element matches/);
    expect(panes.write).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
    expect(written).toHaveLength(0);
  });

  it("a mix of changes and captures goes out as one prompt", async () => {
    const { host, panes } = setup({ comments: [mk("ALPHA"), capture("page", "todo")] });
    await host.send({ pageUrl: url, target: { kind: "pane", paneId: "x" } }, fakePage());
    const text = panes.write.mock.calls[0]![1] as string;
    expect(text).toContain("### Cambio 1");
    expect(text).toContain("### Captura 1");
  });
});

describe("waitForPaneReady", () => {
  it("false when the pane disappears", async () => {
    expect(await waitForPaneReady({ read: () => undefined }, "a", async () => {})).toBe(false);
  });
  it("keeps pageKeyFor import used", () => expect(pageKeyFor(url)).toBe(url));
});
