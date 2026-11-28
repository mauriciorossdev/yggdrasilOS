# LLM provider configuration

Yggdrasil ships three providers:

| Provider id | For | API key variables |
|---|---|---|
| `openai-compat` | Any OpenAI-compatible endpoint: OpenAI, Ollama Cloud, Ollama's `/v1` and others | Depends on the `baseUrl`, see [API key](#api-key) |
| `ollama` | Ollama's native API | `OLLAMA_API_KEY` |
| `anthropic` | Anthropic's API | `ANTHROPIC_API_KEY`, `YGGDRASIL_ANTHROPIC_API_KEY` |

In the desktop app you can set providers up in Settings. The rest of this page is about `yggdrasil.config.json`.

## Changing the `baseUrl`

Edit `yggdrasil.config.json` at the workspace root.

### Option 1: `providers` (recommended)

A permanent change of backend:

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

### Option 2: `pluginConfig` (local override)

To try another endpoint without touching the main settings. It **takes priority** over `providers`.

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

## Common URLs

| Target | `baseUrl` |
|---|---|
| Ollama Cloud | `https://ollama.com/v1` |
| Local Ollama | `http://localhost:11434/v1` |
| OpenAI | `https://api.openai.com/v1` |

## API key

The `baseUrl` carries no key. Set it as an environment variable:

```bash
export OLLAMA_API_KEY=your_key       # Ollama Cloud
export OPENAI_API_KEY=sk-...         # OpenAI
export ANTHROPIC_API_KEY=sk-ant-...  # Anthropic
```

For `openai-compat`, a vendor's variable is only sent to that vendor, so a key never reaches a third party by surprise:

| `baseUrl` | Variables read |
|---|---|
| `api.openai.com` (the default) | `OPENAI_API_KEY`, `YGGDRASIL_OPENAI_API_KEY` |
| `ollama.com` | `OLLAMA_API_KEY`, `YGGDRASIL_OPENAI_API_KEY` |
| A server on this machine (`localhost`) | `OLLAMA_API_KEY`, `OPENAI_API_KEY`, `YGGDRASIL_OPENAI_API_KEY` |
| Anything else (OpenRouter, a proxy, a LAN server) | `YGGDRASIL_OPENAI_API_KEY` |

A key set in the config file or in Settings is always used, whatever the URL.

You can also put it in the config file (do not commit it):

```json
"providers": {
  "openai-compat": {
    "apiKey": "your_key"
  }
}
```

## Applying changes

```bash
pnpm build
node packages/cli/dist/index.js tui
```
