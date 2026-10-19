import type { Terminal } from "@xterm/xterm";

// Chrome that brackets a Claude Code turn on screen: blank padding, the
// horizontal rules around the input box, an empty "❯" prompt line, the
// spinner-done timing footer ("Sautéed for 4s · done 11:02 PM"), the
// "auto mode on" hint, and the caveman-mode status bar. None of these are
// part of what the agent actually said.
function isChromeFooterLine(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (/^[─━]{3,}$/.test(t)) return true;
  if (t === "❯") return true;
  if (/·\s*done\b/i.test(t)) return true;
  if (/auto mode on/i.test(t)) return true;
  if (/^\[.+\]/.test(t) && /⛏|tokens?\b/i.test(t)) return true;
  return false;
}

function getVisibleLines(term: Terminal): string[] {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < term.rows; i++) {
    const line = buf.getLine(buf.viewportY + i);
    lines.push(line ? line.translateToString(true) : "");
  }
  return lines;
}

/**
 * Reads the pane's currently visible screen and, when it recognizes Claude
 * Code's CLI chrome (the "❯ " prompt echo, "⏺ " response bullets, the
 * trailing spinner-done footer), narrows the capture down to just the
 * latest agent response — not the banner, the echoed prompt/tool-call
 * lines above it, or the input box/status bar below it. Falls back to the
 * whole trimmed screen when those markers aren't present (a plain shell,
 * a different harness), so this stays a strict improvement rather than a
 * Claude-Code-only capture.
 */
export function captureVisibleText(term: Terminal): string {
  const lines = getVisibleLines(term);

  let end = lines.length;
  while (end > 0 && isChromeFooterLine(lines[end - 1]!)) end--;

  let lastPromptIdx = -1;
  for (let i = end - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (t.startsWith("❯ ") || t === "❯") {
      lastPromptIdx = i;
      break;
    }
  }

  let start = 0;
  if (lastPromptIdx >= 0) {
    start = lastPromptIdx + 1;
    let responseStart = -1;
    for (let i = start; i < end; i++) {
      const t = lines[i]!.trim();
      if (t === "" || t.startsWith("⎿")) continue;
      if (t.startsWith("⏺")) responseStart = i;
      break;
    }
    start = responseStart >= 0 ? responseStart : start;
  }

  return lines.slice(start, end).join("\n").trim();
}
