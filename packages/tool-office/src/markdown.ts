import type { Block, ListBlock, Run, TableCell } from "./docx/model.js";

/**
 * A small Markdown dialect ⇄ the document model's blocks and runs. Pure, no dependencies. It is the common
 * language with agents for slides (and could serve documents closed in the editor). Supported:
 *   inline: **bold**, *italic* / _italic_, ~~strike~~, `code`, <u>underline</u>, [text](url)
 *   blocks: paragraphs, #-headings, bulleted (- * +) and numbered (1.) lists nested by 2-space indent,
 *           | pipe | tables | with a --- separator row, ``` fenced code, ![alt](embedded-image) skipped.
 */

// ---- inline ------------------------------------------------------------------------------------

type Marks = Omit<Run, "text">;

const TOKEN = /(\\[\\`*_~\[\]()<>#|-])|(\*\*\*|\*\*|~~|<u>|<\/u>|\*|`)|(\[([^\]]*)\]\(([^)\s]+)\))|(\b_|_\b)/g;

export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const marks: Marks = {};
  let buffer = "";

  const flush = () => {
    if (!buffer) return;
    const last = runs[runs.length - 1];
    const { text: lastText, ...lastMarks } = last ?? { text: "" };
    if (last && JSON.stringify(lastMarks) === JSON.stringify(marks)) last.text = lastText + buffer;
    else runs.push({ ...marks, text: buffer });
    buffer = "";
  };
  const toggle = (key: "bold" | "italic" | "strike" | "underline") => {
    flush();
    if (marks[key]) delete marks[key];
    else marks[key] = true;
  };

  let cursor = 0;
  for (const m of text.matchAll(TOKEN)) {
    buffer += text.slice(cursor, m.index);
    cursor = (m.index ?? 0) + m[0].length;
    // Inside a code span everything is literal except the closing backtick (and `\\` / `\``, the only escapes there).
    if (marks.code && m[2] !== "`") {
      buffer += m[1] && (m[1][1] === "\\" || m[1][1] === "`") ? m[1][1] : m[0];
      continue;
    }
    if (m[1]) buffer += m[1]!.slice(1); // an escaped character
    else if (m[3]) {
      flush();
      runs.push({ ...marks, text: m[4] || m[5]!, link: m[5]! });
    } else {
      const token = m[2] ?? m[6]!;
      if (token === "***") (toggle("bold"), toggle("italic"));
      else if (token === "**") toggle("bold");
      else if (token === "*" || token === "_") toggle("italic");
      else if (token === "~~") toggle("strike");
      else if (token === "<u>" || token === "</u>") toggle("underline");
      else if (token === "`") {
        flush();
        if (marks.code) delete marks.code;
        else marks.code = true;
      }
    }
  }
  buffer += text.slice(cursor);
  flush();
  return runs;
}

const needsEscape = /([\\`*_~\[\]<])/g;

export function runsToMarkdown(runs: Run[]): string {
  return runs
    .map((r) => {
      if (r.text === "") return "";
      let s = r.code ? `\`${r.text.replace(/([\\`])/g, "\\$1")}\`` : r.text.replace(needsEscape, "\\$1").replace(/\n/g, "  \n");
      if (r.strike) s = `~~${s}~~`;
      if (r.underline) s = `<u>${s}</u>`;
      if (r.italic) s = `*${s}*`;
      if (r.bold) s = `**${s}**`;
      if (r.link) s = `[${s}](${r.link.replace(/\s/g, "%20").replace(/\)/g, "%29")})`;
      return s;
    })
    .join("");
}

// ---- blocks ------------------------------------------------------------------------------------

const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBER = /^(\s*)(\d+)[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;

const indentOf = (s: string) => Math.floor(s.replace(/\t/g, "  ").length / 2);

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function buildList(items: Array<{ level: number; ordered: boolean; text: string }>): ListBlock[] {
  const roots: ListBlock[] = [];
  const stack: Array<{ list: ListBlock; level: number }> = [];
  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1]!.level > item.level) stack.pop();
    // At the same level, switching between bullets and numbers starts a new list (as in Markdown).
    const sameLevel = stack[stack.length - 1];
    if (sameLevel && sameLevel.level === item.level && sameLevel.list.ordered !== item.ordered) stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.level < item.level) {
      const list: ListBlock = { type: "list", ordered: item.ordered, items: [] };
      const parent = top?.list.items[top.list.items.length - 1];
      if (parent) (parent.children ??= []).push(list);
      else roots.push(list);
      stack.push({ list, level: item.level });
      top = stack[stack.length - 1]!;
    }
    top.list.items.push({ runs: parseInline(item.text) });
  }
  return roots;
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, runs: parseInline(heading[2]!.trim()) });
      i++;
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const rows: TableCell[][] = [cells(line).map((c) => ({ blocks: [{ type: "paragraph", runs: parseInline(c) }], header: true }))];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        rows.push(cells(lines[i++]!).map((c) => ({ blocks: [{ type: "paragraph", runs: parseInline(c) }] })));
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    if (BULLET.test(line) || NUMBER.test(line)) {
      const items: Array<{ level: number; ordered: boolean; text: string }> = [];
      while (i < lines.length) {
        const b = BULLET.exec(lines[i]!);
        const n = NUMBER.exec(lines[i]!);
        if (b) items.push({ level: indentOf(b[1]!), ordered: false, text: b[3]! });
        else if (n) items.push({ level: indentOf(n[1]!), ordered: true, text: n[3]! });
        else break;
        i++;
      }
      blocks.push(...buildList(items));
      continue;
    }
    // A paragraph: consecutive plain lines (a trailing double space is a hard break).
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !FENCE.test(lines[i]!) && !HEADING.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBER.test(lines[i]!) && !(TABLE_ROW.test(lines[i]!) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!))) {
      para.push(lines[i]!);
      i++;
    }
    const joined = para.map((l, k) => (k < para.length - 1 ? (l.endsWith("  ") ? `${l.trimEnd()}\n` : `${l.trim()} `) : l.trim())).join("");
    blocks.push({ type: "paragraph", runs: parseInline(joined) });
  }
  return blocks;
}

function listToMarkdown(list: ListBlock, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return list.items.flatMap((item, n) => [
    `${pad}${list.ordered ? `${n + 1}.` : "-"} ${runsToMarkdown(item.runs)}`,
    ...(item.children ?? []).flatMap((child) => listToMarkdown(child, depth + 1)),
  ]);
}

export function blocksToMarkdown(blocks: Block[]): string {
  return blocks
    .map((b): string => {
      switch (b.type) {
        case "paragraph":
          return runsToMarkdown(b.runs);
        case "heading":
          return `${"#".repeat(b.level)} ${runsToMarkdown(b.runs)}`;
        case "list":
          return listToMarkdown(b).join("\n");
        case "table": {
          const text = (c: TableCell) => c.blocks.map((x) => (x.type === "paragraph" ? runsToMarkdown(x.runs) : "")).join(" ").replace(/\|/g, "\\|");
          const [head, ...body] = b.rows;
          if (!head) return "";
          return [`| ${head.map(text).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.map(text).join(" | ")} |`)].join("\n");
        }
        case "code":
          return `\`\`\`\n${b.text}\n\`\`\``;
        case "image":
          return `![${b.alt ?? ""}](embedded-image)`;
        case "pageBreak":
          return "";
      }
    })
    .filter((s) => s !== "")
    .join("\n\n");
}
