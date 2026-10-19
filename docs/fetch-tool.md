# HTTP Fetch tool

Plugin `@yggdrasil/tool-fetch` — fetch HTTP nativo de Node 22.  
Sin deps externas. Sin browser. Arranque instantáneo.

## Cuándo usar vs browser_navigate

| Caso | Usar |
|------|------|
| API REST / JSON | `http_fetch` |
| HTML estático (sin JS) | `http_fetch` |
| SPA / React / JS requerido | `browser_navigate` |
| Necesito screenshot | `browser_navigate` |
| Necesito click / fill form | `browser_navigate` |

## Herramienta

### `http_fetch`
Hace una request HTTP y retorna status, headers clave y body.

**GET básico:**
```json
{ "url": "https://api.github.com/repos/mauriciorossdev/yggdrasilOS" }
```

```json
{
  "status": 200,
  "ok": true,
  "contentType": "application/json; charset=utf-8",
  "url": "https://api.github.com/repos/mauriciorossdev/yggdrasilOS",
  "body": { "id": 123, "name": "yggdrasil", "stargazers_count": 42 },
  "truncated": false
}
```

**POST con JSON:**
```json
{
  "url": "https://api.example.com/messages",
  "method": "POST",
  "headers": { "Authorization": "Bearer TOKEN" },
  "body": "{\"text\": \"hello\"}"
}
```

**HTML estático:**
```json
{ "url": "https://example.com" }
```

```json
{
  "status": 200,
  "ok": true,
  "contentType": "text/html; charset=UTF-8",
  "body": "Example Domain This domain is for use in illustrative examples...",
  "truncated": false
}
```

El HTML se convierte automáticamente a texto plano (scripts/styles eliminados, entities decodificadas). Para obtener HTML crudo: `"rawHtml": true`.

### Parámetros

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `url` | `string` | — | URL completa con protocolo |
| `method` | `string` | `"GET"` | Método HTTP |
| `headers` | `object` | `{}` | Headers adicionales |
| `body` | `string` | — | Body para POST/PUT/PATCH |
| `rawHtml` | `boolean` | `false` | Retornar HTML crudo en vez de texto |

### Respuesta

| Campo | Descripción |
|-------|-------------|
| `status` | HTTP status code |
| `ok` | `true` si status 200–299 |
| `contentType` | Content-Type del response |
| `url` | URL final (post-redirect) |
| `body` | Texto, objeto JSON parseado, o HTML |
| `truncated` | `true` si body fue cortado a 32KB |

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Body vacío en SPA | La página usa React/JS — usar `browser_navigate` |
| `fetch failed` | URL inalcanzable o sin internet |
| HTML crudo en body | Setear `rawHtml: false` (default) o verificar Content-Type |
| JSON sin parsear | Verificar que el servidor devuelva `Content-Type: application/json` |

## Ver también

- [browser-tool.md](./browser-tool.md) — para páginas que requieren JS
- [search-tool.md](./search-tool.md) — para descubrir URLs antes de fetchear
- Plugin: `extensions/tool-fetch/`
- Roadmap: `docs/plans/TL-05-fetch.md`
