# Yggdrasil — Roadmap hacia feature parity con OpenClaw

> Filosofía que guía cada decisión:
> - **Todo es un plugin** — canales, herramientas, proveedores, harnesses, servicios, context providers
> - **Local-first** — el usuario es dueño de su infraestructura
> - **Composable en runtime** — el kernel descubre y compone; el core no crece, los plugins sí
> - **TypeScript/ESM/Node 22+** — monorepo pnpm, un paquete por responsabilidad

Cada ítem del roadmap tiene un plan individual en `docs/plans/`. Este archivo es el índice.

---

## Fase 1 — Canales Prioritarios

> Todo canal es un plugin `kind: channel`. El core no cambia.

| ID | Canal | Protocolo | Paquete destino | Plan |
|----|-------|-----------|-----------------|------|
| ~~CH-01~~ ✅ | Discord | discord.js bot | `extensions/channel-discord` | `plans/CH-01-discord.md` |
| CH-02 | Slack | Slack Bolt SDK | `extensions/channel-slack` | `plans/CH-02-slack.md` |
| CH-03 | WhatsApp | Baileys (WA Web) o Meta Cloud API | `extensions/channel-whatsapp` | `plans/CH-03-whatsapp.md` |
| CH-04 | Matrix | matrix-js-sdk | `extensions/channel-matrix` | `plans/CH-04-matrix.md` |
| CH-05 | Teams | Bot Framework / Graph API | `extensions/channel-teams` | `plans/CH-05-teams.md` |
| CH-06 | Signal | signal-cli wrapper | `extensions/channel-signal` | `plans/CH-06-signal.md` |
| CH-07 | iMessage | AppleScript / Shortcuts (macOS only) | `extensions/channel-imessage` | `plans/CH-07-imessage.md` |
| CH-08 | IRC | irc-framework | `extensions/channel-irc` | `plans/CH-08-irc.md` |
| CH-09 | LINE | LINE Messaging API | `extensions/channel-line` | `plans/CH-09-line.md` |

**Prerequisito para CH-03 / CH-06:** Sandboxing (F3-01) — mensajería de consumidor requiere entorno aislado para no romper cuentas del usuario.

---

## Fase 2 — Herramientas del Sistema

> Todo tool es un plugin `kind: tool`. El core no cambia.

| ID | Herramienta | Implementación | Paquete destino | Plan |
|----|-------------|----------------|-----------------|------|
| ~~TL-01~~ ✅ | Browser automation | Playwright headless | `extensions/tool-browser` | `plans/TL-01-browser.md` |
| ~~TL-02~~ ✅ | File system | read/write/list/delete/move con risk levels | `extensions/tool-fs` | `plans/TL-02-fs.md` |
| TL-03 | Shell execution | child_process + sandboxing (F3-01) | `extensions/tool-shell` | `plans/TL-03-shell.md` |
| ~~TL-04~~ ✅ | Web search | Brave Search API / SearXNG | `extensions/tool-search` | `plans/TL-04-search.md` |
| ~~TL-05~~ ✅ | HTTP fetch | fetch + content extraction | `extensions/tool-fetch` | `plans/TL-05-fetch.md` |
| ~~TL-06~~ ✅ | Image input | base64 encode → multimodal provider | `extensions/tool-image` | `plans/TL-06-image.md` |
| ~~TL-07~~ ✅ | Cron / scheduling | service plugin con node-cron | `extensions/service-cron` | `plans/TL-07-cron.md` |
| ~~TL-08~~ ✅ | Memory CRUD tools | exponer memory-db como tools explícitos | `packages/context-memory-db` | `plans/TL-08-memory-tools.md` |

**TL-03** depende de **F3-01** (sandboxing). Sin sandbox, shell execution es alto riesgo.

---

## Fase 3 — Seguridad y Auth

> Esta fase toca core (gateway, auth) y agrega plugins de política.

| ID | Feature | Implementación | Paquete | Plan |
|----|---------|----------------|---------|------|
| F3-01 | Sandbox de ejecución | Docker runner o subprocess aislado; nuevo `kind: sandbox` | `packages/sandbox-runtime` | `plans/F3-01-sandbox.md` |
| F3-02 | HTTPS / TLS en gateway | node:https + cert auto-generado (selfsigned) o Let's Encrypt | `packages/gateway` | `plans/F3-02-tls.md` |
| F3-03 | RBAC / Access Control | `kind: access-policy`; scoping por canal, agente, tool | `packages/acp-core` | `plans/F3-03-rbac.md` |
| F3-04 | Rate limiting | middleware en gateway; configurable por cuenta | `packages/gateway` | `plans/F3-04-rate-limit.md` |
| F3-05 | API key con scope y expiración | reemplaza auth.gateway.apiKey con token model | `packages/config` + `packages/gateway` | `plans/F3-05-token-auth.md` |
| F3-06 | Audit logging | service plugin que escribe a archivo o DB | `extensions/service-audit-log` | `plans/F3-06-audit.md` |

---

## Fase 4 — Voz y Media

> Nuevos `kind`: `speech-provider`, `media-processor`. Los canales existentes reciben media events.

| ID | Feature | Implementación | Paquete | Plan |
|----|---------|----------------|---------|------|
| V4-01 | STT — Speech to Text | Whisper.cpp local o API; nuevo kind: `speech-provider` | `packages/speech-sdk` + `extensions/speech-whisper` | `plans/V4-01-stt.md` |
| V4-02 | TTS — Text to Speech | ElevenLabs / piper-tts local; output en canal de voz | `extensions/speech-elevenlabs` + `extensions/speech-piper` | `plans/V4-02-tts.md` |
| V4-03 | Canal de voz macOS | mic input → STT → pipeline → TTS → audio out | `extensions/channel-voice-macos` | `plans/V4-03-voice-channel.md` |
| V4-04 | Wake word detection | Picovoice Porcupine o openWakeWord | integrado en `channel-voice-macos` | `plans/V4-04-wake-word.md` |
| V4-05 | Media processor — imágenes | resize/crop/OCR antes de enviar a LLM multimodal | `packages/media-sdk` + `extensions/media-image` | `plans/V4-05-media-image.md` |
| V4-06 | Media processor — documentos | PDF/DOCX → texto → context provider | `extensions/context-documents` | `plans/V4-06-media-docs.md` |

---

## Fase 5 — Orchestración Multi-Agente

> Nuevos `kind: harness` avanzados. El core pipeline no cambia.

| ID | Feature | Implementación | Paquete | Plan |
|----|---------|----------------|---------|------|
| MA-01 | Harness Router | clasificar intent → delegar a agente especializado | `extensions/harness-router` | `plans/MA-01-harness-router.md` |
| MA-02 | Harness Planner | descompone tarea → sub-turnos secuenciales | `extensions/harness-planner` | `plans/MA-02-harness-planner.md` |
| MA-03 | Agent-to-Agent RPC | agente puede invocar otro agente como tool | `packages/pipeline` + `packages/sdk` | `plans/MA-03-agent-rpc.md` |
| MA-04 | Swarm / paralelo | múltiples agentes en paralelo, merge de respuestas | `extensions/harness-swarm` | `plans/MA-04-swarm.md` |
| MA-05 | Shared memory entre agentes | memoria cross-agent en memory-db | `packages/context-memory-db` | `plans/MA-05-shared-memory.md` |
| MA-06 | Agent fallback chain | si agente A falla, intentar agente B | `packages/harness-runtime` | `plans/MA-06-fallback.md` |

**MA-01 y MA-02** son prerequisito de MA-03 y MA-04.

---

## Fase 6 — Live Canvas / A2UI

> Agente controla la UI. Nuevo protocolo de eventos `canvas.*` sobre el WebSocket RPC.

| ID | Feature | Implementación | Paquete | Plan |
|----|---------|----------------|---------|------|
| UI-01 | Protocolo canvas — spec | definir eventos `canvas.render`, `canvas.update`, `canvas.clear` | `packages/sdk` | `plans/UI-01-canvas-spec.md` |
| UI-02 | Canvas renderer en web console | panel lateral React que consume eventos canvas.* | `packages/web-console` | `plans/UI-02-canvas-web.md` |
| UI-03 | Tool: canvas write | tool que emite eventos canvas desde el harness | `packages/tool-builtin` | `plans/UI-03-canvas-tool.md` |
| UI-04 | Widget system | primitivas: texto, tabla, imagen, botón, form | `packages/web-console` | `plans/UI-04-widgets.md` |
| UI-05 | Botones de acción en chat | agente puede emitir botones → usuario clickea → mensaje al pipeline | `packages/web-console` + `packages/gateway` | `plans/UI-05-action-buttons.md` |

---

## Fase 7 — Apps Nativas

> Tauri para desktop, companion mobile con React Native.

| ID | Feature | Implementación | Paquete | Plan |
|----|---------|----------------|---------|------|
| NA-01 | Desktop app macOS/Windows | Tauri v2 + webview del web-console; gateway embebido | `packages/app-desktop` | `plans/NA-01-desktop-app.md` |
| NA-02 | Menu bar macOS | Tauri system tray; quick chat sin abrir ventana | integrado en `app-desktop` | `plans/NA-02-menubar.md` |
| NA-03 | Daemon service | launchd (macOS) + systemd (Linux) auto-start gateway | `packages/cli` + scripts | `plans/NA-03-daemon.md` |
| NA-04 | Companion mobile iOS/Android | React Native; conecta al gateway local por red | `packages/app-mobile` | `plans/NA-04-mobile.md` |

**NA-01 prerequisito de NA-02. NA-03 independiente.**

---

## Fase 8 — Ecosistema

| ID | Feature | Implementación | Paquete | Plan |
|----|---------|----------------|---------|------|
| EC-01 | Semantic memory — embeddings | vector store local (vectra/lancedb); nuevo kind: `embedding-provider` | `packages/embedding-sdk` + `extensions/embedding-local` | `plans/EC-01-semantic-memory.md` |
| EC-02 | RAG context provider | chunks de documentos → similarity search → contexto | `extensions/context-rag` | `plans/EC-02-rag.md` |
| EC-03 | Skills system | bundle prompt + tools + config como plugin `kind: skill` | `packages/skills-sdk` | `plans/EC-03-skills.md` |
| EC-04 | Plugin marketplace | registry de plugins publicados en npm con tag `yggdrasil-plugin` | `packages/cli` (plugin search/install) | `plans/EC-04-marketplace.md` |
| EC-05 | Hot-reload plugins | fs.watch en kernel → reload sin restart del gateway | `packages/kernel` | `plans/EC-05-hot-reload.md` |
| EC-06 | Token counting real | tiktoken o tokenizer por provider para presupuestar contexto | `packages/sessions` + providers | `plans/EC-06-tokenizer.md` |

---

## Secuencia recomendada

```
Fase 1 (canales)     ━━━━━━━━━━
Fase 2 (tools)             ━━━━━━━━━━
Fase 3 (seguridad)             ━━━━━━━
Fase 4 (voz/media)                  ━━━━━━━━━━━━
Fase 5 (multi-agent)           ━━━━━━━━━━━━
Fase 6 (canvas/UI)                        ━━━━━━━━
Fase 7 (nativas)                                ━━━━━━━━━━
Fase 8 (ecosistema) ━━(EC-05/06 antes)━━━━━━━━━━━━━━━━━━━━
```

**Primeros 3 ítems a atacar (mayor valor / menor esfuerzo):**
1. `TL-01` Browser tool (Playwright) — un plugin, impacto enorme
2. `CH-01` Discord channel — comunidad más grande para demos
3. `F3-01` Sandbox runtime — desbloquea TL-03, CH-03, CH-06

---

## Estado actual

| Área | % parity con OpenClaw | Completado |
|------|------------------------|------------|
| Infraestructura core | 80% | — baseline |
| Canales | 20% | ✅ Discord (CH-01) |
| Herramientas | 87% | ✅ Browser/Playwright (TL-01) ✅ File System (TL-02) ✅ Web Search (TL-04) ✅ HTTP Fetch (TL-05) ✅ Image Input (TL-06) ✅ Cron (TL-07) ✅ Memory CRUD (TL-08) |
| Seguridad | 20% | — |
| Voz / Media | 0% | — |
| Multi-agent | 30% | — |
| Canvas / A2UI | 0% | — |
| Apps nativas | 0% | — |
| Ecosistema | 15% | — |
| **TOTAL** | **≈ 40%** | |

### Fixes no-roadmap completados
- `app-tui`: markdown rendering con renderer ANSI custom (sin chalk/marked-terminal)
- `app-tui`: React setState-in-render warning en InputBox eliminado
- `channel-tui`: markdown rendering en readline channel
