# Configuración del provider LLM

Yggdrasil usa el provider `openai-compat`, compatible con OpenAI, Ollama Cloud, Ollama local, Groq y otros endpoints similares.

## Cambiar el `baseUrl`

Edita `yggdrasil.config.json` en la raíz del proyecto.

### Opción 1 — `providers` (recomendada)

Cambio permanente del backend:

```json
{
  "providers": {
    "openai-compat": {
      "baseUrl": "https://ollama.com/v1",
      "defaultModel": "gpt-oss:120b"
    }
  },
  "agents": [
    { "id": "default", "provider": "openai-compat", "model": "gpt-oss:120b" }
  ]
}
```

### Opción 2 — `pluginConfig` (override local)

Útil para probar otro endpoint sin modificar la config principal. **Tiene prioridad** sobre `providers`.

```json
{
  "pluginConfig": {
    "openai-compat": {
      "baseUrl": "http://localhost:11434/v1",
      "defaultModel": "llama3"
    }
  }
}
```

## URLs habituales

| Destino       | `baseUrl`                      |
|---------------|--------------------------------|
| Ollama Cloud  | `https://ollama.com/v1`        |
| Ollama local  | `http://localhost:11434/v1`    |
| OpenAI        | `https://api.openai.com/v1`    |
| Groq          | `https://api.groq.com/openai/v1` |

## API key

El `baseUrl` no incluye la clave. Configúrala por variable de entorno:

```bash
# Ollama Cloud
export OLLAMA_API_KEY=tu_clave

# OpenAI u otros compatibles
export OPENAI_API_KEY=sk-...
```

También puedes ponerla en config (evita commitearla al repo):

```json
"providers": {
  "openai-compat": {
    "apiKey": "tu_clave"
  }
}
```

## Prioridad de configuración

De menor a mayor (gana lo último):

1. Defaults del código
2. `providers.openai-compat.*`
3. `pluginConfig.openai-compat.*`
4. Variables de entorno (solo para API key)

## Aplicar cambios

```bash
pnpm build
node packages/cli/dist/index.js tui
```
