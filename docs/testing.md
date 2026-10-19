# Testing — Yggdrasil

Guía de capas de test, comandos y matriz de cobertura por iteración del roadmap.

## Capas

| Capa | Ubicación | Comando | API key |
|------|-----------|---------|---------|
| Unit | `packages/**`, `extensions/**` | `pnpm test:unit` | No |
| Integración | `test/integration/` | `pnpm test:integration` | No |
| E2E mock | `test/e2e/iter*.test.ts` | `pnpm test:e2e` | No |
| E2E live | `test/e2e/live/` | `pnpm test:live` | `OLLAMA_API_KEY` |

```bash
pnpm test          # unit + integration + e2e mock (excluye live)
pnpm test:all      # todo lo anterior + live (si hay API key)
```

## Setup live (Ollama Cloud)

```bash
export OLLAMA_API_KEY=tu_clave
# opcional: modelo distinto al default
export YGGDRASIL_TEST_MODEL=gemma4:31b-cloud

pnpm test:live
```

Config usada en live tests:

- `baseUrl`: `https://ollama.com/v1`
- Provider: `openai-compat` + harness `llm`
- Ver también [provider-config.md](./provider-config.md)

Sin `OLLAMA_API_KEY`, los tests live se omiten (`describe.skip`).

## Helpers compartidos

`test/helpers/`:

| Módulo | Uso |
|--------|-----|
| `platform.ts` | `createTestPlatform()` — bootstrap + cleanup |
| `ports.ts` | Puertos libres (sin colisiones) |
| `gateway-client.ts` | `GatewayWsClient` — RPC + eventos WS |
| `http-client.ts` | `postInbound()` para channel-http |
| `mock-provider.ts` | Providers fake (stream, tool loop, capture) |
| `ollama-live.ts` | Config live + `liveDescribe` |

Plantilla para nuevos escenarios: [`test/e2e/TEMPLATE.md`](../test/e2e/TEMPLATE.md).

## Matriz escenario ↔ roadmap

| Iter | Criterio roadmap | Archivo | Capa |
|------|------------------|---------|------|
| 1 | Gateway WS, plugins, channels | `test/e2e/iter1-spine.test.ts` | mock |
| 2 | Multi-turn, HTTP mismo sessionKey | `test/e2e/iter2-sessions-http.test.ts` | mock |
| 2 | Memoria conversacional | `test/e2e/live/ollama-chat.test.ts` | live |
| 3 | Tool loop + streaming | `test/e2e/iter3-tools-streaming.test.ts` | mock |
| 3 | Tools reales | `test/e2e/live/ollama-tools.test.ts` | live |
| 3 | chat.delta | `test/e2e/live/ollama-streaming.test.ts` | live |
| 4 | Compaction, patch, tools.list | `test/e2e/iter4-memory.test.ts` | mock |
| 5 | Auth + HTTP SSE + Telegram | `test/e2e/iter5-auth-gateway.test.ts`, `test/http-auth.test.ts`, `test/http-sse.test.ts` | mock |
| 8 | Web console + config RPC | `test/e2e/iter8-web-console.test.ts`, `test/e2e/iter8-chat-stream.test.ts` | mock |

## Checklist pre-PR

1. `pnpm build`
2. `pnpm test` — debe pasar sin API key
3. `pnpm test:live` — con `OLLAMA_API_KEY` antes de merge a main
4. Si añades iter 5+: copiar `_template.test.ts` y documentar en esta tabla

## CI (GitHub Actions)

- Job **test-fast**: `test:unit`, `test:integration`, `test:e2e`
- Job **test-live-ollama**: `test:live` con secret `OLLAMA_API_KEY`

Los tests live consumen cuota de Ollama Cloud.

## Añadir escenario iter 5+

1. Crear `test/e2e/iter5-*.test.ts` (mock) o extender `test/e2e/live/`
2. Usar `createTestPlatform({ startServer: true })` o `GatewayWsClient`
3. Para auth/SSE/Telegram: stubs en helpers (`postInbound` con headers, etc.)
4. Actualizar esta matriz
