# TL-06 — Image Input (Multimodal)

**Status:** ✅ Implementado  
**Plugin:** `extensions/tool-image`

## Objetivo

Permitir al agente cargar imágenes (local o URL) y pasarlas a modelos con visión (gpt-4o, claude-3-opus, etc.).

## Cambios en core

TL-06 requirió extender el pipeline — no es solo un plugin:

### 1. `packages/sdk/src/provider.ts`
- Nuevos tipos: `ContentPartText`, `ContentPartImage`, `ContentPart`
- `ChatMessage.content` extendido a `string | ContentPart[]`

### 2. `packages/provider-openai-compat/src/client.ts`
- `OpenAIMessage.content` acepta `ContentPart[]`
- `serializeMessages` pasa array content directamente (OpenAI ya lo acepta)
- `parseChatResponse` normaliza content de respuesta a string

### 3. `packages/provider-ollama/src/messages.ts`
- `contentToString()` — degrada array content a texto plano para Ollama (no soporta visión en este formato)
- Imágenes se representan como `[image]` en contexto Ollama

### 4. `packages/harness-llm/src/tool-loop.ts`
- Detecta sentinel `{ __ygg_image__: true, base64, mimeType, path? }` en tool output
- Inyecta `user` message con `ContentPart[]` (texto + image_url) después del `tool` message
- El tool message queda como `[Image loaded: /path/to/img.png]`

## Tools implementadas

| Tool | Risk | Descripción |
|------|------|-------------|
| `image_view` | safe | Lee archivo local, retorna sentinel con base64 |
| `image_view_url` | safe | Fetch imagen de URL, retorna sentinel con base64 |

## Formatos soportados

PNG, JPEG, GIF, WebP, BMP

## Flujo

```
1. Agente llama image_view("/path/to/photo.png")
2. tool-loop detecta { __ygg_image__: true, ... } en output
3. tool-loop pushea tool message: "[Image loaded: /path/to/photo.png]"
4. tool-loop pushea user message: [{ type: "text", text: "..." }, { type: "image_url", image_url: { url: "data:image/png;base64,..." } }]
5. LLM recibe imagen como content part y responde describiendo/analizando
```

## Soporte Ollama

Ollama usa `images: string[]` (base64 sin prefijo data URL) en lugar de `content: ContentPart[]`.  
`parseContent()` en `messages.ts` extrae base64 del data URL y lo pasa en el campo `images`.  
Modelos compatibles: `llava`, `llava-llama3`, `moondream`, `bakllava`.

## Limitaciones

- Imágenes grandes consumen muchos tokens
- Modelos Ollama sin soporte de visión ignoran el campo `images` silenciosamente
