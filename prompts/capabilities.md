# Capacidades disponibles

## Tools activas

### Shell
- `shell_exec(command, cwd?, timeout?)` — ejecuta comandos en subproceso aislado
  - Env filtrado: solo PATH, HOME, SHELL, TERM, LANG. Ninguna API key llega al proceso.
  - Timeout default 30s, máximo 300s
  - Doc detallada: `docs/shell-tool.md`

### Filesystem
- `fs_read_file(path, offset?, limit?)` — leer archivo (paginable)
- `fs_write_file(path, content)` — escribir/sobreescribir archivo ⚠️
- `fs_list_dir(path, recursive?, maxDepth?)` — listar directorio
- `fs_delete(path, recursive?)` — eliminar archivo o directorio ⚠️
- `fs_move(from, to)` — mover o renombrar
- Doc detallada: `docs/fs-tool.md`

### Web
- `web_search(query, count?)` — buscar en internet (Brave Search o SearXNG)
  - Doc detallada: `docs/search-tool.md`
- `http_fetch(url, method?, headers?, body?, rawHtml?)` — fetch de URLs y APIs REST
  - Doc detallada: `docs/fetch-tool.md`

### Imágenes / Visión
- `image_view(path)` — cargar imagen local y enviarla al modelo
- `image_view_url(url)` — cargar imagen remota
- Requiere modelo con soporte de visión (ej: gpt-4o, llava)
- Doc detallada: `docs/image-tool.md`

### Memoria de largo plazo
- `memory_add(content, tags?)` — guardar memoria
- `memory_list(agentId?, limit?)` — listar memorias
- `memory_search(query, agentId?, limit?)` — buscar por contenido
- `memory_update(id, content?, tags?)` — actualizar entrada
- `memory_remove(id)` — eliminar entrada ⚠️
- Doc detallada: `docs/memory-tools.md`

## Servicios / Canales

- **TUI** — interfaz de terminal (canal activo por defecto)
- **Telegram** — bot de Telegram (requiere configuración)
- **Discord** — bot de Discord (requiere configuración)
- **Cron** — tareas programadas con expresiones cron
- **HTTP** — canal HTTP para integraciones externas

## Gateway

El gateway expone WebSocket para conectar clientes remotos.
- Soporta múltiples API keys con expiración (`docs/api-keys.md`)
- Soporta TLS/HTTPS para acceso remoto seguro (`docs/tls-gateway.md`)

## Docs disponibles

Usa `fs_read_file("docs/<archivo>")` para leer detalles:

| Archivo | Contenido |
|---------|-----------|
| `docs/shell-tool.md` | Shell sandbox, allowedRoot, pruebas |
| `docs/fs-tool.md` | Filesystem tools, risk levels |
| `docs/search-tool.md` | Brave Search, SearXNG, config |
| `docs/fetch-tool.md` | HTTP fetch, headers, body |
| `docs/image-tool.md` | Visión multimodal, Ollama |
| `docs/memory-tools.md` | Memoria SQLite, CRUD |
| `docs/cron-service.md` | Cron scheduling, expresiones |
| `docs/api-keys.md` | Múltiples API keys, expiración |
| `docs/tls-gateway.md` | TLS/HTTPS, certificados |
| `docs/telegram-channel.md` | Bot Telegram |
| `docs/discord-channel.md` | Bot Discord |
| `docs/tui.md` | Terminal UI |
| `docs/beta-publish.md` | Publicar en npm |
