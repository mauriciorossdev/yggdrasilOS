/**
 * Delivers a whole message into a TUI composer (Claude Code's, mainly) and
 * submits it — used by the pane "Start task" button and write_pane.
 *
 * Writing the raw text and pressing Enter a fixed 80ms later was unreliable:
 * macOS hands a pty's input over in ~1KB pieces, so a long prompt reached
 * Claude Code as several separate pastes ("[Pasted text #1] [Pasted text #2]
 * …"), and an Enter that arrived before the last piece was taken in — easy
 * with several agents starting at once — could submit only part of it.
 *
 *  1. Wait until the app has turned on bracketed paste mode (Claude Code does
 *     once its composer is up), so nothing is typed into a half-started app.
 *  2. Send the text as ONE bracketed paste: however the pty splits the bytes,
 *     the app knows exactly where the paste starts and ends.
 *  3. Press Enter only after the app's output has settled (it has finished
 *     taking the paste in and redrawing), instead of after a fixed delay.
 *
 * An app that never turns bracketed paste on (a plain program, or one still
 * not up after `readyTimeoutMs`) gets the raw text, as before.
 */

export type SubmitTarget = {
  /** False once the pane has exited — every wait gives up. */
  alive: () => boolean;
  /** The app has asked for bracketed paste (CSI ?2004h). */
  bracketedPaste: () => boolean;
  /** Date.now() of the pane's latest output chunk. */
  lastOutputAt: () => number;
  write: (data: string) => void;
};

export type SubmitOptions = {
  readyTimeoutMs?: number;
  /** Quiet output needed before Enter counts as "settled". */
  settleMs?: number;
  /** Enter goes out after this at the latest, even if the app keeps drawing (a spinner). */
  settleTimeoutMs?: number;
  /** Never press Enter sooner than this after the text — it must read as its own keystroke. */
  minEnterDelayMs?: number;
  /** false = deliver the text without submitting it. */
  pressEnter?: boolean;
};

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const POLL_MS = 25;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
  return true;
}

/** The text as one bracketed paste. A stray end marker inside it would close the paste early, so it is dropped; CRLF/CR become LF (a bare CR is Enter). */
export function bracketedPaste(text: string): string {
  const body = text.split(PASTE_END).join("").replace(/\r\n?/g, "\n");
  return PASTE_START + body + PASTE_END;
}

export async function submitText(target: SubmitTarget, text: string, options: SubmitOptions = {}): Promise<void> {
  const {
    readyTimeoutMs = 10_000,
    settleMs = 150,
    settleTimeoutMs = 3_000,
    minEnterDelayMs = 80,
    pressEnter = true,
  } = options;

  await waitUntil(() => !target.alive() || target.bracketedPaste(), readyTimeoutMs);
  if (!target.alive()) return;

  target.write(target.bracketedPaste() ? bracketedPaste(text) : text);
  if (!pressEnter) return;

  await sleep(minEnterDelayMs);
  await waitUntil(() => !target.alive() || Date.now() - target.lastOutputAt() >= settleMs, settleTimeoutMs);
  if (!target.alive()) return;
  target.write("\r");
}
