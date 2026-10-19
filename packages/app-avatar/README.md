# @yggdrasil/app-avatar

Voice avatar client for the Yggdrasil gateway — **Windows only for now**. Push-to-talk mic → local
whisper.cpp transcription → a fully configurable, tool-using LLM agent → streamed text reply → local
Piper TTS read-aloud. Separate app from `@yggdrasil/app-desktop` — a single-window voice assistant, not
a dev-workspace tool.

3D avatar rendering + lipsync (React Three Fiber + Ready Player Me, per the original design doc) is
still deferred — everything else in that doc's pipeline (STT → LLM → TTS) is now in place.

## Architecture

Same pattern as `app-desktop`: on launch, the Electron main process spawns its own `@yggdrasil/cli
gateway` subprocess (`src/main/gateway.ts`) scoped to the app's own `userData` directory, and the
renderer talks to it over WebSocket via `@yggdrasil/client-web`. That gateway subprocess owns all LLM
provider config (`yggdrasil.config.json`'s `providers.<id>.{baseUrl,apiKey,defaultModel}`), so provider
host/model/API key are configured exactly like they are in `app-desktop` (Settings → Providers / Agent)
— including pointing a provider at a different machine on the LAN (e.g. Ollama on a GPU box).

**Tools are fully autonomous by design**: `tool-system` (filesystem/shell/`open_path`) and `tool-mcp`
are enabled, `harness.toolApproval` is `"never"` (no click-to-confirm on `run_command`/`write_file` —
see `gateway.ts`'s `seedWorkspaceConfig`), and `harness.maxToolIterations` is raised to 25 so a
run→read-output→adjust→retry loop has room to actually finish. The avatar agent's system prompt
(`AVATAR_SYSTEM_PROMPT` in `gateway.ts`) tells it to use tools for real, iterate until it has a concrete
result, and decide for itself whether a task warrants stating a plan first. The renderer still has a
`tools.approve` UI (`ApprovalBar`) wired up and ready — flip `harness.toolApproval` back to
`"destructive-only"` in the config if you want the safety net back.

**Internet access** is via an MCP server, not a bespoke tool — `mcpServers.playwright` in the seeded
config (`gateway.ts`) runs `@playwright/mcp` (real headless Chrome, spawned via `npx` on first use, no
system Playwright install needed). No API key: it's an actual browser doing actual navigation, not a
search API. Deliberately not raw HTML scraping of a search engine — tried DuckDuckGo's HTML endpoint
first, it bot-detects and serves an image CAPTCHA challenge instead of results. The system prompt tells
the agent to navigate to a search results page and read it rather than expecting a dedicated "search"
tool, since Playwright MCP only exposes browser primitives (navigate/click/snapshot/...).

Since a model deciding "the tool call itself was the answer" and returning empty text happens often
enough with smaller local models (despite the system prompt asking for a spoken acknowledgment) — and
in a voice app, empty text means silence with zero feedback — `fallbackReplyText`
(`src/renderer/src/chat/fallbackReply.ts`) is an application-level safety net: if the final text is
empty, it synthesizes something ("Listo — open_path.") from whichever tools ran that turn, used for
both the displayed message and what TTS speaks.

The renderer shows a persistent status bar (`AgentStatusBar`/`agentStatus.ts`) — Thinking / Responding /
Running: `<tool>` / Speaking — derived from `turn.*`/`chat.delta`/`tool.execute` events plus local TTS
playback state, always visible rather than buried in scrollback.

### Speech-to-text (whisper.cpp)

`src/main/whisperServer.ts` manages a single persistent `whisper-server.exe` child process
(`ensureWhisperServer`) — started lazily on first push-to-talk and restarted only when the
binary/model/backend actually changes, so the model loads into RAM once instead of on every utterance.
Each transcription (`transcribeViaServer`) is a multipart POST to that server's local `/inference`
endpoint with the WAV the renderer recorded and resampled client-side (`src/renderer/src/mic/`).
`src/main/whisper.ts` handles locating/downloading model files.

Startup flags are `-bs 5 -bo 5 -nf`: whisper.cpp's temperature-fallback retry loop (`-nf` disables it)
dominates per-utterance latency far more than beam width does — measured ~10.5s → ~3.5s for a 4.6s clip
going from defaults to no-fallback alone; beam width was left at whisper.cpp's own default (5) since
trimming it to 2 measurably hurt transcription accuracy on real speech for a latency win that `-nf`
already delivered on its own. Settings → Whisper has a CPU/GPU (CUDA) backend toggle
(`resources/whisper/win/` vs `resources/whisper/win-gpu/`, separate binaries — DLL sets can't mix) — on
GPUs without tensor cores (e.g. GTX 16-series) pass `-nfa` (no flash-attn) too, or it's dramatically
*slower* than CPU (measured 56s vs 1.6-1.8s on a GTX 1650 for the same clip); already set in
`ensureWhisperServer`'s spawn args unconditionally since it's a no-op on CPU-only builds.

### Text-to-speech (Piper)

`src/main/piper.ts` spawns `piper.exe` per utterance (no persistent server needed — Piper's own
reported real-time factor is ~0.08, i.e. ~12x faster than real-time on CPU, with only ~0.4-0.6s
voice-load overhead, far lighter than whisper's model). Text goes in over stdin, a WAV comes out via
`-f`; the renderer (`src/renderer/src/voice/useSpeaker.ts`) plays it with a plain `Audio` element. A
voice only speaks one language well (it's not multilingual like the whisper model) — Settings → Voice
lets you pick/download voices and switch anytime.

Piper's own project moved from a standalone-binary release (`rhasspy/piper`, archived, last release
2023.11.14) to a Python package (`OHF-Voice/piper1-gpl`) with no native CLI anymore. This app
deliberately still uses the old archived native build — same mature inference engine (nothing about
`.onnx` voice inference changed, only the Python packaging did), zero Python dependency, matches this
app's whisper.cpp integration shape. If that archived release ever disappears, an alternative would be
running Piper via Python + `piper1-gpl` as a small local HTTP server instead of a spawned binary.

Both whisper and piper settings live in the same `avatar-settings.json` in `userData`
(`src/main/whisperSettings.ts`, `src/main/piperSettings.ts`, nested under top-level fields and a
`"piper"` key respectively) — both read-modify-write that file rather than overwrite it, so saving one
never wipes the other's settings out from under it.

## Setting up whisper.cpp (required for voice input; text chat still works without it)

This app does **not** bundle a whisper.cpp binary by default (see `resources/whisper/win/` — a CPU
build may already be checked in there from initial setup, but treat that as environment-specific, not
guaranteed). Get one of:

- Build `whisper.cpp` from source (`cmake -B build && cmake --build build --config Release`) and copy
  the resulting `whisper-server.exe` **and its DLLs** (ggml*.dll, whisper.dll) into
  `resources/whisper/win/` (or `resources/whisper/win-gpu/` for a CUDA build) — the app auto-detects it
  there per the Settings → Whisper backend toggle.
- Download a prebuilt Windows release from the `whisper.cpp` GitHub releases page (`whisper-bin-x64.zip`
  for CPU, `whisper-cublas-*-bin-x64.zip` for CUDA) and point Settings → Whisper → "whisper-server.exe
  path" at the extracted `whisper-server.exe` directly (its sibling DLLs must stay next to it).

It must be `whisper-server.exe`, not `whisper-cli.exe`.

Models are **not** bundled either (100MB–1.5GB each) — download the size you want from Settings →
Whisper; fetched from `https://huggingface.co/ggerganov/whisper.cpp` into `userData/whisper/models/`.
Use a **multilingual** variant (e.g. `small`, not `small.en`) for any language other than English.

## Setting up Piper (required for voice replies; text still shows without it)

`resources/piper/win/` may already have `piper.exe` + its DLLs + `espeak-ng-data/` checked in from
initial setup — same "environment-specific, not guaranteed" caveat as whisper. To get it yourself:
download `piper_windows_amd64.zip` from `rhasspy/piper`'s GitHub releases (tag `2023.11.14-2` — that
repo's last release, since development moved to a Python-only package, see "Architecture" above) and
extract into `resources/piper/win/`, or point Settings → Voice → "piper.exe path" at wherever you put
it.

Voices are downloaded from `https://huggingface.co/rhasspy/piper-voices` into `userData/piper/voices/`
via Settings → Voice — `PIPER_VOICES` in `src/main/piper.ts` is a curated shortlist (currently one
English, one Spanish "medium"-quality voice); add more entries there if you need other
languages/voices from that same repo.

## Dev

```bash
pnpm --filter @yggdrasil/app-avatar dev
pnpm --filter @yggdrasil/app-avatar typecheck
pnpm --filter @yggdrasil/app-avatar dist   # electron-builder, Windows nsis installer
```

## Deferred

- 3D `.glb` avatar rendering (React Three Fiber + Ready Player Me) + lipsync/visemes driven by TTS
  output.
- Continuous VAD (Silero) — still push-to-talk only.
- Native `provider-anthropic` plugin (Claude works today only via `provider-openai-compat` pointed at
  an OpenAI-compatible endpoint).
- macOS/Linux/mobile builds.
