import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown.js";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const ITALIC = "\x1b[3m";

describe("renderMarkdown", () => {
  it("renders an h1 heading in green+bold, other levels in bold only", () => {
    expect(renderMarkdown("# Title")).toBe(`${GREEN}${BOLD}Title${RESET}`);
    expect(renderMarkdown("### Sub")).toBe(`${BOLD}Sub${RESET}`);
  });

  it("renders inline code with yellow", () => {
    expect(renderMarkdown("run `ls -la` now")).toBe(`run ${YELLOW}ls -la${RESET} now`);
  });

  it("renders bold, italic, and bold+italic", () => {
    expect(renderMarkdown("**bold**")).toBe(`${BOLD}bold${RESET}`);
    expect(renderMarkdown("*italic*")).toBe(`${ITALIC}italic${RESET}`);
    expect(renderMarkdown("_italic_")).toBe(`${ITALIC}italic${RESET}`);
    expect(renderMarkdown("***both***")).toBe(`${BOLD}${ITALIC}both${RESET}`);
  });

  it("renders a horizontal rule", () => {
    expect(renderMarkdown("---")).toBe(`${DIM}${"─".repeat(40)}${RESET}`);
    expect(renderMarkdown("***")).toBe(`${DIM}${"─".repeat(40)}${RESET}`);
  });

  it("renders ordered list items with cyan numbering", () => {
    expect(renderMarkdown("1. first")).toBe(`${CYAN}1.${RESET} first`);
  });

  it("renders unordered list items with a cyan bullet", () => {
    expect(renderMarkdown("- item")).toBe(`${CYAN}•${RESET} item`);
    expect(renderMarkdown("* item")).toBe(`${CYAN}•${RESET} item`);
  });

  it("dims fenced code block markers", () => {
    expect(renderMarkdown("```js")).toBe(`${DIM}\`\`\`js${RESET}`);
  });

  it("renders blockquotes with a dim bar prefix", () => {
    expect(renderMarkdown("> quoted")).toBe(`${DIM}│ quoted${RESET}`);
  });

  it("leaves blank lines empty and trims trailing whitespace", () => {
    expect(renderMarkdown("hello\n\nworld")).toBe("hello\n\nworld");
    expect(renderMarkdown("hello\n")).toBe("hello");
  });

  it("applies inline formatting inside headings and list items", () => {
    expect(renderMarkdown("# **Bold** title")).toBe(
      `${GREEN}${BOLD}${BOLD}Bold${RESET} title${RESET}`,
    );
    expect(renderMarkdown("- code `x`")).toBe(`${CYAN}•${RESET} code ${YELLOW}x${RESET}`);
  });
});
