/**
 * Standalone entry (its own electron-vite bundle, like statuslineBridge.ts),
 * run by Claude Code as a hook in every `claude` pane the app opens — see
 * claudePaneSettings.ts's attention hooks and notes/features/attention-inbox.md.
 *
 *   node attentionBridge.js <prompt|ask|notification|stop|end>
 *
 * Reads the hook's JSON from stdin and forwards the event to this project's
 * paneControlServer (POST /attention). Where to send it and which pane it is
 * come from the pane's environment (YGG_ATTENTION_URL / _TOKEN / YGG_PANE_ID,
 * set by terminals.ts) — hooks inherit it, verified with claude 2.1.330.
 *
 * Must never get in the way of the agent: prints nothing (a hook's stdout can
 * end up in Claude's context), always exits 0 (a failing hook can block a
 * tool), and gives up after ~1s.
 */

const TIMEOUT_MS = 1000;

const [, , eventName] = process.argv;
const url = process.env.YGG_ATTENTION_URL;
const token = process.env.YGG_ATTENTION_TOKEN;
const paneId = process.env.YGG_PANE_ID;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    const done = () => resolve(data);
    const timer = setTimeout(done, TIMEOUT_MS / 2);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on("error", done);
  });
}

type HookInput = {
  message?: unknown;
  notification_type?: unknown;
  tool_input?: { questions?: Array<{ question?: unknown }> };
};

/** The body POST /attention expects for one hook call. Exported for tests. */
export function attentionBody(event: string, paneIdValue: string, input: HookInput): Record<string, unknown> {
  const body: Record<string, unknown> = { event, paneId: paneIdValue };
  if (event === "notification") {
    body.message = input.message;
    body.notificationType = input.notification_type;
  }
  if (event === "ask") body.message = input.tool_input?.questions?.[0]?.question;
  return body;
}

async function main(): Promise<void> {
  if (!url || !token || !paneId || !eventName) return;
  const raw = await readStdin();
  let input: HookInput = {};
  try {
    input = raw ? (JSON.parse(raw) as HookInput) : {};
  } catch {
    // A malformed payload still tells us which event happened.
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(`${url}/attention`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(attentionBody(eventName, paneId, input)),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Only when run as the hook itself, not when a test imports attentionBody.
if (process.argv[1] && /attentionBridge\.(js|cjs|mjs)$/.test(process.argv[1])) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
