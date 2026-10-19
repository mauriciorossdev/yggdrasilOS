# TL-05 — HTTP Fetch Tool

**Status:** ✅ Implementado  
**Plugin:** `extensions/tool-fetch`

## Objetivo

Fetch HTTP liviano sin browser. Complementa TL-01 (browser_navigate con Playwright) para casos donde no se necesita ejecutar JS: APIs REST, HTML estático, webhooks, health checks.

## Tool implementada

| Tool | Risk | Descripción |
|------|------|-------------|
| `http_fetch` | safe | HTTP request con cualquier método; auto-convierte HTML → texto |

## Decisiones

- **Sin Playwright** — Node `fetch` nativo (Node 22). Liviano, arranque instantáneo.
- **HTML → texto automático**: cuando `Content-Type: text/html`, aplica `htmlToText()` (strip tags + decode entities). Evita HTML crudo en contexto del LLM. Opt-out con `rawHtml: true`.
- **JSON parse automático**: cuando `Content-Type: application/json`, parsea y devuelve objeto — el LLM puede navegar la estructura.
- **Cap 32KB**: respuestas grandes se truncan; `truncated: true` en respuesta.
- **User-Agent** declarativo: `Yggdrasil/0.1 (bot; http-fetch-tool)` — honesto para servidores.
- `riskLevel: "safe"` — solo lee, no escribe estado externo.

## Diferencia con browser_navigate

| | `http_fetch` | `browser_navigate` |
|---|---|---|
| Backend | Node fetch | Playwright Chromium |
| JS execution | No | Sí |
| SPAs / React apps | No funciona | Funciona |
| APIs REST | Perfecto | Innecesario |
| Velocidad arranque | Instantáneo | ~1s (launch browser) |
| Memoria | Mínima | ~80MB por sesión |

## Estructura

```
extensions/tool-fetch/
  src/
    index.ts    # definePlugin + http_fetch tool
    html.ts     # htmlToText() — strip tags + decode entities
  package.json
  tsconfig.json
  yggdrasil.plugin.json
```

## Próximo paso relacionado

TL-06 Image input — encode imagen como base64 → proveedor multimodal.
