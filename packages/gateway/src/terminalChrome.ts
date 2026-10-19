// Mirrors app-desktop's renderer/src/terminal/captureBuffer.ts's
// isChromeFooterLine (same UI chrome signatures Claude Code's CLI draws:
// horizontal rules, the bare "❯" prompt, the "· done Xs" timing footer, the
// "auto mode on"/"auto-accept edits on" hint, the MCP token/context bracket
// line), extended to also drop the composer's own bordered input box —
// applied across the WHOLE buffer here, not just a trailing footer, since
// mobile's terminals.read shows the full scrollback, not one isolated
// response the way captureBuffer.ts's Delegate flow does.
//
// Gateway-only, deliberately: this never touches paneControlServer.ts's own
// GET /panes/:id/read (used by the read_pane MCP tool) — an agent reading
// another pane's output for coordination needs the real, unfiltered text.
function isChromeLine(line: string): boolean {
  const t = line.trim();
  if (t === "") return false; // interior blank lines are real spacing, not chrome — leave them.
  if (/^[─━]{3,}$/.test(t)) return true;
  if (t === "❯") return true;
  if (/·\s*done\b/i.test(t)) return true;
  if (/auto[- ]?(mode|accept edits) on\b/i.test(t)) return true;
  if (/^\[.+\]/.test(t) && /⛏|tokens?\b/i.test(t)) return true;
  if (/ctx\s*\d+%/i.test(t)) return true;
  // The composer's own bordered input box — rounded (╭╮╰╯) or square (┌┐└┘)
  // corners, plus any content line still wrapped in │...│.
  if (/^[╭┌][─━]+[╮┐]$/.test(t)) return true;
  if (/^[╰└][─━]+[╯┘]$/.test(t)) return true;
  if (/^│.*│$/.test(t)) return true;
  // Slash-command pickers (/model, /effort, ...) and permission/consent
  // menus (MCP server approval, tool-approval checkboxes) — genuinely
  // open-ended (any future picker Claude Code adds needs its own pattern
  // here too, this isn't a real parser of Ink's menu widgets), but these
  // cover the ones actually seen so far.
  if (/^\[.?\]/.test(t)) return true; // checkbox rows: [✔], [ ], [  ]
  if (/space to select/i.test(t)) return true;
  if (/esc to (reject|cancel|close)/i.test(t)) return true;
  if (/enable selected/i.test(t)) return true;
  if (/mcp server/i.test(t) && /session/i.test(t)) return true;
  if (/·\s*\/\w+\s*$/.test(t)) return true; // trailing "· /effort"-style hint
  return false;
}

export function stripTerminalChrome(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isChromeLine(line))
    .join("\n");
}
