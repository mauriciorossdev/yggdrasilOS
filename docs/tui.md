# TUI — Terminal User Interface

Yggdrasil incluye dos implementaciones de TUI. Ambas se activan con `yggdrasil tui`.

## app-tui (activa)

React + Ink. TUI full-featured con componentes visuales.  
Paquete: `packages/app-tui`

### Arrancar

```bash
pnpm build
node packages/cli/dist/index.js tui
```

### Componentes

| Componente | Descripción |
|------------|-------------|
| `MessageList` | Historial de conversación con scroll |
| `InputBox` | Input con historial de comandos (↑↓), multiline (Shift+Enter) |
| `StreamingMessage` | Respuesta del agente en tiempo real |
| `ApprovalPrompt` | Diálogo de aprobación para tools destructivas |
| `StatusBar` | Modelo activo, agente, estado de conexión |
| `SessionList` | Lista de sesiones disponibles |
| `CommandPalette` | Comandos `/reset`, `/agent`, etc. |
| `SlashAutocomplete` | Autocompletado de comandos slash |

### Comandos en el input

Los comandos viven en un registro (`packages/app-tui/src/commands/`); `/help`, la paleta (`Ctrl+K`) y el autocompletado salen de él. Un comando desconocido avisa en vez de ignorarse, y las skills del proyecto también se pueden escribir como `/skill argumentos` (el texto se inserta en `{{args}}`).

| Comando | Acción |
|---------|--------|
| `/reset` | Limpia la sesión actual |
| `/new` | Nueva sesión aislada |
| `/sessions` | Lista sesiones (`r` renombra la seleccionada) |
| `/rename <título>` | Renombra la sesión actual |
| `/agents` | Ver, cambiar y crear agentes |
| `/agent <id>` | Cambia el agente activo |
| `/model`, `/config` | Selector de modelo / menú de configuración |
| `/tools` | Tools disponibles, con tipo, riesgo y parámetros |
| `/turns` | Turnos recientes del gateway |
| `/compact`, `/export` | Compacta la sesión / exporta a markdown |
| `/status`, `/help`, `/exit` | Estado, ayuda, salir |

| Tecla | Acción |
|-------|--------|
| `↑` / `↓` | Historial de mensajes enviados (se guarda en `~/.yggdrasil/tui-history.json`) |
| `Shift+Enter` | Nueva línea (multiline) |
| `Esc` / `Ctrl+C` | Cancela el turno en curso (`chat.cancel`); sin turno, `Ctrl+C` sale |
| `Shift+Tab` | Cambia el modo de aprobación |
| `Ctrl+K` | Paleta de comandos |

### Opciones

`yggdrasil tui [--continue] [--agent <id>] [--connect <ws-url>] [--api-key <key>]`. Si el gateway exige clave, usa `--api-key` o `YGGDRASIL_API_KEY`. Si se cae la conexión, el TUI reconecta solo y recarga la sesión desde el gateway. Si el proveedor de modelos falla de forma transitoria (429, 5xx, conexión cortada), reintenta solo y la barra de estado lo muestra: `↻ retrying in 4s (HTTP 500, attempt 2)`; `Esc` cancela la espera.

### Renderizado markdown

El TUI renderiza markdown de las respuestas del agente con ANSI:

| Markdown | Render |
|----------|--------|
| `**texto**` | **negrita** |
| `` `código` `` | amarillo |
| `_italic_` | itálica |
| `# Heading` | verde + negrita |
| `1. item` | lista numerada cyan |
| `- item` | bullet `•` cyan |
| `> quote` | `│ quote` dim |
| `---` | línea horizontal dim |

### Aprobación de tools

Cuando el agente llama una tool con `riskLevel: "destructive"`, el TUI muestra un diálogo:

```
⚠ Approve tool delete_file with {"path": "/tmp/x"}? [y/N]
```

Timeout: 60 segundos (auto-deny).

---

## channel-tui (readline, legado)

readline-based, sin componentes React. Se usa cuando se arranca con `yggdrasil run` y el canal `tui` está habilitado en config (modo headless + readline compartiendo terminal).

Paquete: `packages/channel-tui`

### Comandos

| Comando | Acción |
|---------|--------|
| `/reset` | Limpia la sesión |
| `/agent <id>` | Cambia agente activo |
| `/exit` / `/quit` | Salir |
| `Ctrl+C` | Salir |

### Streaming

El channel-tui muestra el streaming con el prefijo `… ` mientras se genera, y lo reemplaza con `→ ` al finalizar. El texto final renderiza markdown ANSI igual que app-tui.

---

## Configuración en yggdrasil.config.json

```json
{
  "channels": {
    "tui": {
      "enabled": true
    }
  }
}
```

El canal `tui` se habilita automáticamente al correr `yggdrasil tui`.  
Para deshabilitarlo en `yggdrasil run` (headless), setear `"enabled": false`.

## Ver también

- [web-console.md](./web-console.md) — alternativa browser-based
- [sessions.md](./sessions.md) — gestión de sesiones
- Paquetes: `packages/app-tui/`, `packages/channel-tui/`
