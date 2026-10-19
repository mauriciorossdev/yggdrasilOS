# Web Search tool

Plugin `@yggdrasil/tool-search` — búsqueda web vía Brave Search API o SearXNG.  
Sin deps externas, usa `fetch` nativo de Node 22.

## Setup

Elige uno de los dos backends:

### Opción A — Brave Search API (recomendado)

1. Crea cuenta en [brave.com/search/api](https://brave.com/search/api/) — plan gratuito: 2000 queries/mes
2. Copia el API key
3. Configura:

```bash
export BRAVE_SEARCH_API_KEY=BSA...
```

O en `yggdrasil.config.json`:

```json
{
  "pluginConfig": {
    "tool-search": {
      "braveApiKey": "BSA..."
    }
  }
}
```

### Opción B — SearXNG (self-hosted, sin costo)

```bash
docker run -d -p 8080:8080 searxng/searxng
export SEARXNG_URL=http://localhost:8080
```

O en config:

```json
{
  "pluginConfig": {
    "tool-search": {
      "searxngUrl": "http://localhost:8080"
    }
  }
}
```

Si ambos están configurados, **Brave tiene prioridad**.

## Herramienta

### `web_search`
Busca en la web y retorna lista de resultados (título, URL, descripción).

```json
{ "query": "yggdrasil world tree mythology", "count": 5 }
```

```json
{
  "provider": "brave",
  "query": "yggdrasil world tree mythology",
  "results": [
    {
      "title": "Yggdrasil - Wikipedia",
      "url": "https://en.wikipedia.org/wiki/Yggdrasil",
      "description": "In Norse cosmology, Yggdrasil is an immense and central sacred tree..."
    }
  ]
}
```

- `query` — texto de búsqueda (requerido)
- `count` — número de resultados (default: 5, max: 10)

## Combinación con browser_navigate

`web_search` da URLs, `browser_navigate` (tool-browser) visita el contenido completo:

```
1. web_search("playwright typescript tutorial") → lista de URLs
2. browser_navigate("https://playwright.dev/docs/...") → contenido completo
```

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `No search provider configured` | Setear `BRAVE_SEARCH_API_KEY` o `SEARXNG_URL` |
| `Brave Search API error: 429` | Límite de queries alcanzado (2000/mes en plan free) |
| `SearXNG error: 404` | Verificar que SearXNG esté corriendo en la URL configurada |
| Resultados vacíos en SearXNG | Asegurarse que el contenedor tenga acceso a internet |

## Ver también

- [browser-tool.md](./browser-tool.md) — navegar URLs de los resultados
- Plugin: `extensions/tool-search/`
- Roadmap: `docs/plans/TL-04-search.md`
