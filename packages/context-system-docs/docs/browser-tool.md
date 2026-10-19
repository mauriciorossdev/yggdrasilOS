# Browser automation tool

Plugin `@yggdrasil/tool-browser` — Playwright headless Chromium.  
Permite al agente navegar por páginas web, extraer contenido y rellenar formularios.

## Setup (una sola vez)

```bash
pnpm exec playwright install chromium   # descarga ~94MB de Chromium headless
pnpm build
```

El plugin se descubre automáticamente desde `extensions/tool-browser/`.

## Herramientas

### `browser_navigate`
Navega a una URL. Devuelve título, URL final y texto visible (primeros 8000 chars).

```json
{ "url": "https://example.com" }
```

```json
{ "title": "Example Domain", "url": "https://example.com/", "text": "..." }
```

### `browser_extract`
Extrae texto o atributo de elementos CSS.

```json
{ "selector": "a", "attribute": "href", "limit": 20 }
```

```json
{ "results": ["https://...", "https://..."] }
```

- `selector` — CSS selector (requerido)
- `attribute` — atributo HTML a extraer (opcional; omitir = `innerText`)
- `limit` — máximo de elementos (default: 10)

### `browser_screenshot`
Captura screenshot de la página actual. Devuelve PNG en base64.

```json
{}
```

```json
{ "base64": "iVBORw0KGgo...", "mimeType": "image/png" }
```

Útil cuando el modelo soporta visión (gpt-4o, claude-3 opus). Sin visión, usar `browser_extract` en su lugar.

### `browser_click` ⚠️ moderate
Hace click en un elemento CSS. **Requiere aprobación del usuario** (riskLevel: moderate).

```json
{ "selector": "button[type=submit]" }
```

```json
{ "clicked": true, "selector": "button[type=submit]" }
```

### `browser_fill` ⚠️ moderate
Rellena un input o textarea. **Requiere aprobación del usuario** (riskLevel: moderate).

```json
{ "selector": "input[name=email]", "value": "test@example.com" }
```

```json
{ "filled": true, "selector": "input[name=email]" }
```

## Niveles de riesgo

| Tool | Risk | Aprobación |
|------|------|------------|
| `browser_navigate` | safe | No |
| `browser_screenshot` | safe | No |
| `browser_extract` | safe | No |
| `browser_click` | moderate | Según `harness.toolApproval` |
| `browser_fill` | moderate | Según `harness.toolApproval` |

La política de aprobación se configura en `harness.toolApproval`:
- `"destructive-only"` (default) — click/fill NO piden aprobación (solo `destructive`)
- `"always"` — todos piden aprobación

## Sesiones

Cada `sessionKey` tiene su propio browser context (página aislada).  
El historial de navegación persiste dentro de una conversación.  
Al detener el gateway, se cierran todos los browsers (`browser-pool-cleanup` service).

## Timeouts

| Operación | Timeout |
|-----------|---------|
| `browser_navigate` | 15s |
| `browser_click` | 5s |

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `browserType.launch: Executable doesn't exist` | Ejecutar `pnpm exec playwright install chromium` |
| Navigate timeout | La página tarda >15s — URL inalcanzable o muy pesada |
| Click timeout | Selector no encontrado en 5s — verificar selector |
| Screenshot vacío | Navegar primero con `browser_navigate` |

## Ver también

- [creating-plugins.md](./creating-plugins.md)
- Plugin: `extensions/tool-browser/`
- Roadmap: `docs/plans/TL-01-browser.md`
