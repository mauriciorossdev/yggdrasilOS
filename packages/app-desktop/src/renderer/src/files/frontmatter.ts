/**
 * The YAML front matter of a note (`---` … `---` at the very top), read and edited one property at a
 * time. Editing is line based: only the lines of the property being changed are touched, so comments,
 * key order and properties this panel doesn't know about survive a round trip untouched.
 */

export type Split = {
  /** The front matter block as written, fences and the newline after the closing one included; "" if none. */
  raw: string;
  body: string;
};

export type NoteProps = {
  title: string;
  status: string;
  date: string;
  tags: string[];
};

export const KNOWN_KEYS = ["title", "status", "date", "tags"] as const;
export type KnownKey = (typeof KNOWN_KEYS)[number];

const FENCE = /^---[ \t]*$/;
const KEY_LINE = /^([A-Za-z0-9_][\w.-]*)[ \t]*:(?:[ \t]+(.*))?$/;

/** Every non-blank line of a real front matter is a comment, a `key:` line, a list item or an indented continuation. */
function looksLikeYaml(lines: string[]): boolean {
  return lines.every((l) => l.trim() === "" || /^\s*#/.test(l) || KEY_LINE.test(l) || /^\s+\S/.test(l) || /^-\s/.test(l));
}

/** Splits a markdown document into its front matter and the rest; `raw + body` is always the original text. */
export function splitFrontmatter(md: string): Split {
  const open = /^---[ \t]*\r?\n/.exec(md);
  if (!open) return { raw: "", body: md };
  const inner: string[] = [];
  let pos = open[0].length;
  for (;;) {
    const nl = md.indexOf("\n", pos);
    const end = nl === -1 ? md.length : nl;
    const line = md.slice(pos, end).replace(/\r$/, "");
    if (FENCE.test(line)) {
      if (!looksLikeYaml(inner)) return { raw: "", body: md };
      const after = nl === -1 ? md.length : nl + 1;
      return { raw: md.slice(0, after), body: md.slice(after) };
    }
    inner.push(line);
    if (nl === -1) return { raw: "", body: md };
    pos = nl + 1;
  }
}

export function joinFrontmatter(raw: string, body: string): string {
  return raw + body;
}

/** The lines between the fences. */
function innerLines(raw: string): string[] {
  if (!raw) return [];
  const all = raw.split(/\r?\n/);
  if (all[all.length - 1] === "") all.pop();
  return all.slice(1, -1);
}

type Entry = { key: string; start: number; end: number; value: string };

/** Top-level properties: `end` is exclusive and covers the list items / indented lines that belong to the key. */
function entries(inner: string[]): Entry[] {
  const out: Entry[] = [];
  inner.forEach((line, i) => {
    const m = KEY_LINE.exec(line);
    if (m) {
      out.push({ key: m[1]!, start: i, end: i + 1, value: (m[2] ?? "").trim() });
    } else if (out.length > 0 && (/^\s+\S/.test(line) || /^-\s/.test(line))) {
      out[out.length - 1]!.end = i + 1;
    }
  });
  return out;
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

function cleanTag(t: string): string {
  return t.trim().replace(/^#+/, "").replace(/[,[\]]/g, "").replace(/\s+/g, "-");
}

function readTags(inner: string[], e: Entry): string[] {
  let items: string[];
  if (e.value.startsWith("[")) {
    items = e.value.replace(/^\[/, "").replace(/\]\s*(#.*)?$/, "").split(",");
  } else if (e.value === "") {
    items = inner
      .slice(e.start + 1, e.end)
      .map((l) => /^\s*-\s+(.*)$/.exec(l)?.[1] ?? "")
      .filter(Boolean);
  } else {
    items = e.value.split(",");
  }
  return items.map((t) => cleanTag(unquote(t))).filter(Boolean);
}

export function parseProps(md: string): NoteProps {
  const inner = innerLines(splitFrontmatter(md).raw);
  const found = new Map(entries(inner).map((e) => [e.key, e]));
  const scalar = (k: string) => unquote(found.get(k)?.value ?? "");
  const tags = found.get("tags");
  return {
    title: scalar("title"),
    status: scalar("status"),
    date: scalar("date"),
    tags: tags ? readTags(inner, tags) : [],
  };
}

/** Keys in the front matter that the panel has no field for. */
export function otherKeys(md: string): string[] {
  const inner = innerLines(splitFrontmatter(md).raw);
  return entries(inner)
    .map((e) => e.key)
    .filter((k) => !(KNOWN_KEYS as readonly string[]).includes(k));
}

function needsQuotes(v: string): boolean {
  return (
    v === "" ||
    /^[\s>|&*!%@`'"[\]{},?:#-]/.test(v) ||
    /\s$/.test(v) ||
    /:(\s|$)/.test(v) ||
    /\s#/.test(v) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(v) ||
    /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v)
  );
}

function formatScalar(v: string): string {
  return needsQuotes(v) ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v;
}

function encode(key: KnownKey, value: string | string[]): string[] {
  if (Array.isArray(value)) {
    const tags = value.map(cleanTag).filter(Boolean);
    return tags.length ? [`tags: [${tags.join(", ")}]`] : [];
  }
  return value === "" ? [] : [`${key}: ${formatScalar(value)}`];
}

/**
 * Sets (or, when empty, removes) one of the known properties. A note with no front matter gets one;
 * a front matter left with nothing in it goes away entirely.
 */
export function setProperty(md: string, key: KnownKey, value: string | string[]): string {
  const { raw, body } = splitFrontmatter(md);
  const nl = md.includes("\r\n") ? "\r\n" : "\n";
  const inner = innerLines(raw);
  const next = encode(key, value);
  const at = entries(inner).find((e) => e.key === key);
  if (at) inner.splice(at.start, at.end - at.start, ...next);
  else inner.push(...next);
  if (inner.every((l) => l.trim() === "")) return body;
  const trailing = raw === "" || /\n$/.test(raw) ? nl : "";
  return ["---", ...inner, "---"].join(nl) + trailing + body;
}
