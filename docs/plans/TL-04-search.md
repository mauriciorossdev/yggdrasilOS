# TL-04 — Web Search Tool

**Status:** ✅ Implementado  
**Plugin:** `extensions/tool-search`

## Objetivo

Dar al agente capacidad de buscar en la web sin depender de un proveedor único. Dos backends intercambiables: Brave Search API (cloud) y SearXNG (self-hosted).

## Tool implementada

| Tool | Risk | Descripción |
|------|------|-------------|
| `web_search` | safe | Busca en la web, retorna título + URL + descripción |

## Decisiones

- **Brave primero**: si `braveApiKey` está disponible se usa. Si no, intenta SearXNG.
- **Config**: `pluginConfig["tool-search"].braveApiKey` / `.searxngUrl` o env vars `BRAVE_SEARCH_API_KEY` / `SEARXNG_URL`
- Sin config → error descriptivo que explica cómo configurar
- `count` máximo forzado a 10 (evitar saturar contexto)
- SearXNG devuelve resultados por `content` field (no `description` como Brave) — normalizado en la respuesta

## Estructura

```
extensions/tool-search/
  src/
    index.ts            # definePlugin + web_search tool
    config.ts           # resolveConfig() — pluginConfig + env vars
    providers/
      brave.ts          # Brave Search API
      searxng.ts        # SearXNG JSON API
  package.json
  tsconfig.json
  yggdrasil.plugin.json
```

## Config en yggdrasil.config.json

```json
{
  "pluginConfig": {
    "tool-search": {
      "braveApiKey": "BSA...",
      "searxngUrl": "http://localhost:8080"
    }
  }
}
```

## Respuesta

```json
{
  "provider": "brave",
  "query": "...",
  "results": [
    { "title": "...", "url": "https://...", "description": "..." }
  ]
}
```

## Próximo paso relacionado

TL-05 HTTP fetch — fetch directo a URL + extracción de contenido (complementa web_search).
