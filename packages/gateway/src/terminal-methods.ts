// terminals.*: bridges to the pane-control server in the Electron main process, for this gateway's own project.

import { resolveProviderConfig } from "@yggdrasil/config";
import { getProvider } from "@yggdrasil/kernel";
import { loadDesktopTtsOverrides } from "./desktopTtsOverrides.js";
import type { GatewayMethodHandler } from "./methods.js";
import { stripTerminalChrome } from "./terminalChrome.js";
import { synthesizeSpeech, TTS_MAX_CHARS } from "./tts.js";

export interface TerminalMethodsDeps {
  register: (name: string, handler: GatewayMethodHandler) => void;
}

export function registerTerminalMethods(deps: TerminalMethodsDeps): void {
  const { register } = deps;

  // Bridges into THIS project's pane-control server (main/paneControlServer.ts)
  // — it lives in Electron's main process, not this gateway subprocess, and
  // is loopback-only/token-authed, so its URL+token are handed across via
  // env at spawn time (see main/gateway.ts's spawnGatewaySubprocess). Only
  // ever reflects the project this gateway itself is scoped to — there is no
  // cross-project bridge for live terminal state, unlike sessions/agentFlow
  // (project-methods.ts).
  register("terminals.list", async (_params, ctx) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { panes: [], available: false };

    type RawPane = { id: string; title: string; cwd: string; createdAt: number; sessionKey?: string };
    let panes: RawPane[];
    try {
      const res = await fetch(`${url}/panes`, { headers: { authorization: `Bearer ${token}` } });
      const body = (await res.json()) as { panes?: RawPane[] };
      panes = body.panes ?? [];
    } catch {
      return { panes: [], available: false };
    }

    return {
      available: true,
      panes: panes.map((p) => ({
        ...p,
        working: p.sessionKey ? ctx.activeTurns.isActive(p.sessionKey) : false,
      })),
    };
  });

  // Same pane-control bridge as terminals.list — plain-text (ANSI-stripped)
  // tail of one pane's recent output, per paneControlServer.ts's GET
  // /panes/:id/read (main/terminals.ts's readTerminalOutput). A redrawing
  // TUI (claude's own interactive UI) will look repetitive/noisy here rather
  // than resolving to its final state — accepted tradeoff, same one
  // terminals.ts's own stripAnsi comment documents for this read path.
  register("terminals.read", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { text: "", available: false };
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    const maxChars = Number(params.maxChars ?? 4000) || 4000;
    // Optional — a mobile client's own screen width, so long lines reflow to
    // it instead of whatever the desktop pane's actual pty columns are right
    // now (see terminals.ts's mobileTerm mirror — never resizes the real pty).
    const cols = params.cols != null ? Number(params.cols) : undefined;
    const query = cols && Number.isFinite(cols) && cols > 0 ? `&cols=${cols}` : "";
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/read?maxChars=${maxChars}${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { text: "", available: false };
      const body = (await res.json()) as { text?: string };
      return { text: stripTerminalChrome(body.text ?? ""), available: true };
    } catch {
      return { text: "", available: false };
    }
  });

  // Same pane-control bridge as terminals.read, but structured instead of
  // raw text — proxies paneControlServer.ts's GET /panes/:id/transcript,
  // which parses Claude Code's own JSONL transcript (main/claudeTranscript.ts)
  // for a `claude` pane spawned with a minted --session-id. `available: false`
  // means either this isn't a `claude` pane or its transcript path couldn't
  // be resolved — the mobile client falls back to terminals.read in that case.
  register("terminals.transcript", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { available: false, messages: [] };
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/transcript`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { available: false, messages: [] };
      return (await res.json()) as { available: boolean; messages: unknown[] };
    } catch {
      return { available: false, messages: [] };
    }
  });

  const SUMMARIZE_TIMEOUT_MS = 10_000;

  // Summarizes a `claude` pane's last assistant reply into a few spoken
  // sentences and synthesizes it (Replicate TTS, see tts.ts) — the desktop
  // terminal pane's "speak last response" button. Reuses terminals.transcript's
  // own pane-control bridge to find the text (never screen-scrapes the pane's
  // raw ANSI/TUI output, which can't recover long/truncated/markdown-rendered
  // replies cleanly) and automation.author's one-shot chatComplete pattern to
  // summarize — fully independent of whatever provider the pane's own `claude`
  // CLI process is authenticated with, this rides the gateway's own default
  // agent config instead.
  register("terminals.speak", async (params, ctx) => {
    const overrides = await loadDesktopTtsOverrides();
    if (!overrides.enabled) throw new Error("TTS deshabilitado en Settings → Voz de este equipo");
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) throw new Error("terminals.speak: pane control not available");
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    const callerVoiceId = params.voiceId !== undefined ? String(params.voiceId) : undefined;
    const voiceId = callerVoiceId || overrides.voiceId;

    let messages: { kind?: string; text?: string }[];
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/transcript`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as { available?: boolean; messages?: { kind?: string; text?: string }[] };
      if (!res.ok || !body.available) throw new Error("no hay transcript disponible para este pane");
      messages = body.messages ?? [];
    } catch (err) {
      if (err instanceof Error && err.message.includes("transcript")) throw err;
      throw new Error("terminals.speak: no se pudo leer el pane");
    }

    const lastReply = [...messages].reverse().find((m) => m.kind === "assistant_text")?.text?.trim();
    if (!lastReply) throw new Error("no hay una respuesta de claude para leer en este pane");

    // "full" (user picked "Todo" in the pane's speak-button menu) skips the
    // local agent entirely — speaks the raw reply as-is (clipped below).
    const mode = params.mode === "full" ? "full" : "summary";
    let summary = lastReply;
    if (mode === "summary") {
      // Best-effort — a broken/misconfigured default agent (wrong provider,
      // expired key, unreachable local model) must never block "hablar
      // última respuesta" entirely: fall back to speaking the raw reply
      // (clipped to TTS_MAX_CHARS) instead of hard-failing the whole RPC.
      // Logged with the actually-resolved agent/provider id so a
      // misconfiguration is visible in the gateway's own stdout instead of
      // only surfacing as an opaque provider error.
      try {
        const agent = (ctx.config.agents ?? []).find((a) => a.id === ctx.config.defaultAgent);
        if (!agent?.provider || !agent.model) {
          throw new Error(`default agent "${ctx.config.defaultAgent}" has no provider/model`);
        }
        const provider = getProvider(agent.provider);
        if (!provider?.chatComplete) {
          throw new Error(`provider "${agent.provider}" (agent "${agent.id}") cannot chat`);
        }
        const providerCfg = resolveProviderConfig(ctx.config, agent.provider);
        // Bounded — an unreachable local model (e.g. Ollama not running) can
        // hang a plain fetch() indefinitely with no error at all, which would
        // otherwise block this whole RPC until the CLIENT's own timeout fires
        // (useGateway's call() waits up to 60s) instead of degrading
        // gracefully like the error-throwing failure modes above already do.
        const result = await Promise.race([
          provider.chatComplete(
            { config: providerCfg },
            {
              model: agent.model,
              messages: [
                {
                  role: "system",
                  content:
                    "Resume el siguiente texto en 2-3 oraciones breves, en español, sin markdown ni bloques de código, " +
                    "como para ser leído en voz alta.",
                },
                { role: "user", content: lastReply },
              ],
              temperature: 0.2,
            },
          ),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`summarize timed out after ${SUMMARIZE_TIMEOUT_MS}ms`)),
              SUMMARIZE_TIMEOUT_MS,
            ),
          ),
        ]);
        if (result.text.trim()) summary = result.text.trim();
      } catch (err) {
        console.error(
          `terminals.speak: summarization failed (agent "${ctx.config.defaultAgent}"), speaking raw reply instead —`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (summary.length > TTS_MAX_CHARS) summary = `${summary.slice(0, TTS_MAX_CHARS - 1)}…`;

    const { audioBase64, mimeType } = await synthesizeSpeech({
      text: summary,
      voiceId,
      env: overrides.apiToken ? { ...process.env, REPLICATE_API_TOKEN: overrides.apiToken } : undefined,
    });
    return { text: summary, audioBase64, mimeType };
  });

  // Sends input into one pane — same write+delayed-Enter mechanism as the
  // desktop's own Delegate/write_pane flows (paneControlServer.ts's POST
  // /panes/:id/write), so a burst of text reads as a genuine submit, not a
  // paste, to whatever's running in that pane.
  register("terminals.write", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { ok: false };
    const id = String(params.id ?? "");
    const text = String(params.text ?? "");
    if (!id) throw new Error("id required");
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/write`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        // "remote": the desktop labels it (phone / web console) in a busy pane's message queue.
        body: JSON.stringify({ text, pressEnter: params.pressEnter !== false, source: "remote", when: params.when === "now" ? "now" : "auto" }),
      });
      if (!res.ok) return { ok: false };
      // { queued, position } when the pane's agent was busy and the message waits for its turn to end.
      const body = (await res.json().catch(() => ({}))) as { queued?: boolean; position?: number };
      return { ok: true, ...(body.queued ? { queued: true, position: body.position } : {}) };
    } catch {
      return { ok: false };
    }
  });

  // Widens the REAL pty so a TUI (Ink-based `claude` panes) re-renders its
  // own output at a phone-readable width instead of whatever narrow size the
  // desktop pane happens to be — reflow via terminals.read's `cols` alone
  // can't fix this since Ink hard-wraps based on the actual pty size it's
  // told, not a soft xterm-level wrap. Real side effect: the desktop pane's
  // own on-screen content reflows too while a phone has it expanded (main/
  // terminals.ts's expandTerminalForMobile) — same tradeoff any terminal
  // multiplexer has. Always pair with terminals.restore when the mobile
  // screen is closed.
  register("terminals.expand", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { ok: false };
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/expand`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ cols: params.cols, rows: params.rows }),
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });

  register("terminals.restore", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { ok: false };
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });
}
