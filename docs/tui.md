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

| Comando | Acción |
|---------|--------|
| `/reset` | Limpia la sesión actual |
| `/agent <id>` | Cambia el agente activo |
| `↑` / `↓` | Navega historial de mensajes enviados |
| `Shift+Enter` | Nueva línea (multiline) |
| `Ctrl+C` | Salir |

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
