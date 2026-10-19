 Pre-requisitos

  pnpm build

  1. Tool Approval (TUI)

  # Asegurar config tiene: "harness": { "toolApproval": "destructive-only" }
  node packages/cli/dist/index.js tui
  - [ ] Enviar: usa la tool delete_file para borrar /tmp/test
  - [ ] Debe aparecer: ⚠ Approve tool delete_file con {"path":"/tmp/test"}? [y/N]
  - [ ] Responder y → tool ejecuta (retorna { deleted: false, demo: true })
  - [ ] Repetir, responder N → LLM recibe "Error: tool execution denied by user"
  - [ ] Repetir, no responder 60s → auto-deny

  2. Parallel Tool Calls

  - [ ] Pedir al LLM que use 2+ tools en un solo turn (ej: dime la hora y usa echo)
  - [ ] En logs/tracing, verificar que tool.execute events tienen timestamps cercanos (no secuenciales)

  3. Multi-Agent (TUI)

  // yggdrasil.config.json
  {
    "agents": [
      { "id": "default", "provider": "openai-compat", "model": "gpt-4o-mini" },
      { "id": "coder", "provider": "openai-compat", "model": "gpt-4o-mini", "systemPrompt": "Responde solo con codigo. Sin explicaciones." }
    ]
  }
  node packages/cli/dist/index.js tui
  - [ ] Escribir /agent coder → muestra → Agente activo: coder
  - [ ] Enviar: fibonacci en Python → respuesta solo codigo (systemPrompt activo)
  - [ ] Escribir /agent default → vuelve al agente normal

  4. Gateway RPC — agentId + tools.approve

  # Terminal 1: gateway
  node packages/cli/dist/index.js tui

  # Terminal 2: websocat
  websocat ws://127.0.0.1:18789

  {"method":"agents.list","id":1}
  - [ ] Respuesta incluye ambos agentes con systemPrompt truncado

  {"method":"chat.send","params":{"message":"hola","agentId":"coder"},"id":2}
  - [ ] Usa el agente coder

  {"method":"tools.list","id":3}
  - [ ] delete_file aparece en la lista

  5. Tracing (WebSocket)

  # Terminal 2: websocat conectado
  - [ ] Al enviar mensaje en TUI, websocat recibe turn.start
  - [ ] Si hay tools → recibe tool.execute con durationMs
  - [ ] Recibe provider.latency con model y durationMs
  - [ ] Recibe turn.end con classification y durationMs
  - [ ] Recibe chat.delta (streaming) + chat.final

  {"method":"turns.recent","id":4}
  - [ ] Retorna array con turns recientes

  6. Health

  {"method":"health","id":5}
  - [ ] version: "0.5.0"
  - [ ] features: ["tool-approval", "parallel-tools", "tracing", "multi-agent"]

  7. Provider Ollama (requiere Ollama local)

  // yggdrasil.config.json
  {
    "providers": {
      "ollama": { "baseUrl": "http://127.0.0.1:11434", "defaultModel": "llama3.2" }
    },
    "agents": [
      { "id": "local", "provider": "ollama", "model": "llama3.2" }
    ]
  }
  # Asegurar ollama corriendo: ollama serve
  node packages/cli/dist/index.js tui
  - [ ] /agent local → activa agente Ollama
  - [ ] Enviar mensaje → respuesta del modelo local
  - [ ] Gateway: {"method":"providers.list","id":1} → muestra provider ollama con modelos de /api/tags

  8. Tests automatizados

  pnpm test
  - [ ] 41 archivos, 103 tests, todos green