# Image Input tool

Plugin `@yggdrasil/tool-image` — carga imágenes locales o remotas para modelos con visión.  
Requiere modelo con capacidad de visión (gpt-4o, claude-3-opus, claude-3.5-sonnet, etc.).

## Herramientas

### `image_view`
Carga un archivo de imagen local.

```json
{ "path": "/Users/user/Desktop/screenshot.png" }
```

El modelo recibe la imagen y responde describiendo su contenido.

### `image_view_url`
Descarga una imagen desde una URL pública.

```json
{ "url": "https://example.com/diagram.png" }
```

## Formatos soportados

PNG, JPEG, GIF, WebP, BMP

## Requisitos

**El modelo debe soportar visión.** Modelos compatibles:
- OpenAI: `gpt-4o`, `gpt-4-turbo`, `gpt-4-vision-preview`
- Anthropic (vía openai-compat): `claude-3-opus`, `claude-3-sonnet`, `claude-3.5-sonnet`
- Ollama: `llava`, `llava-llama3`, `moondream`, `bakllava` y cualquier modelo con soporte de visión

## Cómo funciona

El tool retorna un sentinel interno `{ __ygg_image__: true, base64, mimeType }`. El pipeline lo detecta y inyecta la imagen como un mensaje `user` con content multimodal:

```
tool: [Image loaded: /path/to/image.png]
user: [{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }]
```

El LLM recibe la imagen en el siguiente turno del tool loop y puede describirla, analizarla, extraer texto, etc.

## Casos de uso

- Analizar screenshots de errores o UIs
- Extraer texto de imágenes (OCR básico via visión)
- Describir diagramas o gráficos
- Comparar imágenes
- Combinar con `browser_screenshot` → `image_view` para analizar lo que el browser capturó

## Ollama (visión local)

Ollama usa el campo `images: string[]` (base64 puro, sin prefijo `data:`) en lugar del array de content parts. El provider lo convierte automáticamente — el agente recibe la imagen correctamente con modelos como `llava`:

```bash
ollama pull llava
```

```json
// yggdrasil.config.json
{ "agents": [{ "id": "default", "provider": "ollama", "model": "llava" }] }
```

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `Unsupported image format` | Usar PNG, JPEG, GIF, WebP o BMP |
| Modelo no describe imagen | Verificar que el modelo soporte visión |
| `ENOENT` en image_view | Path incorrecto — usar path absoluto |
| Imagen muy grande / lenta | Reducir resolución antes de cargar |

## Ver también

- [browser-tool.md](./browser-tool.md) — `browser_screenshot` genera imágenes analizables con este tool
- Plugin: `extensions/tool-image/`
- Roadmap: `docs/plans/TL-06-image.md`
