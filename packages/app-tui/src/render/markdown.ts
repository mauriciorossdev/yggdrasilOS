const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";
const DIM    = "\x1b[2m";
const CYAN   = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN  = "\x1b[32m";
const ITALIC = "\x1b[3m";

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g,           `${YELLOW}$1${RESET}`)
    .replace(/\*\*\*([^*]+)\*\*\*/g, `${BOLD}${ITALIC}$1${RESET}`)
    .replace(/\*\*([^*]+)\*\*/g,     `${BOLD}$1${RESET}`)
    .replace(/\*([^*]+)\*/g,         `${ITALIC}$1${RESET}`)
    .replace(/_([^_]+)_/g,           `${ITALIC}$1${RESET}`);
}

export function setMarkdownWidth(_width: number): void {
  // no-op: width not needed for this renderer
}

export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  for (const raw of lines) {
    // ATX headings
    const h = raw.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const level = h[1]!.length;
      const content = inline(h[2]!);
      out.push(level === 1 ? `${GREEN}${BOLD}${content}${RESET}` : `${BOLD}${content}${RESET}`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(raw.trim())) {
      out.push(`${DIM}${"─".repeat(40)}${RESET}`);
      continue;
    }

    // Ordered list item
    const ol = raw.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (ol) {
      out.push(`${ol[1]!}${CYAN}${ol[2]!}.${RESET} ${inline(ol[3]!)}`);
      continue;
    }

    // Unordered list item
    const ul = raw.match(/^(\s*)[-*+]\s+(.*)/);
    if (ul) {
      out.push(`${ul[1]!}${CYAN}•${RESET} ${inline(ul[2]!)}`);
      continue;
    }

    // Fenced code block fence lines
    if (/^```/.test(raw)) {
      out.push(`${DIM}${raw}${RESET}`);
      continue;
    }

    // Blockquote
    const bq = raw.match(/^>\s?(.*)/);
    if (bq) {
      out.push(`${DIM}│ ${inline(bq[1]!)}${RESET}`);
      continue;
    }

    // Normal line / blank
    out.push(raw.trim() === "" ? "" : inline(raw));
  }

  return out.join("\n").trimEnd();
}
