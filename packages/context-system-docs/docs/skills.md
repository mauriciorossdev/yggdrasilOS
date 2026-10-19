# Skills

Skills son plugins que combinan **instrucciones de sistema** + **tools** en una unidad instalable. Dos formatos soportados: Yggdrasil native y Claude Code compat.

---

## Instalar una skill

### Desde npm

```bash
yggdrasil skill install @yggdrasil/skill-git
yggdrasil skill install skill-cooking
```

### Desde GitHub

```bash
# Formato corto
yggdrasil skill install juliusbrussee/caveman

# github: explícito
yggdrasil skill install github:user/my-skill

# URL completa
yggdrasil skill install https://github.com/user/my-skill
```

El comando:
1. Instala el paquete via npm/pnpm
2. Detecta el formato (Yggdrasil o Claude Code)
3. Registra en `plugins.installed` del config
4. Para skills Claude Code: genera un wrapper en `extensions/skill-{id}/`

Reinicia el gateway después de instalar.

### Listar skills instaladas

```bash
yggdrasil skill list
```

---

## Crear una skill (Yggdrasil native)

```bash
yggdrasil plugin create my-skill --kind skill
cd extensions/my-skill
pnpm install && pnpm build
```

Estructura generada:

```
extensions/my-skill/
  src/index.ts          ← defineSkill() aquí
  yggdrasil.plugin.json ← kind: ["skill"]
  package.json
  tsconfig.json
```

### `src/index.ts` generado

```typescript
import { defineSkill, defineTool } from "@yggdrasil/skills-sdk";

const exampleTool = defineTool({
  name: "my_skill_hello",
  description: "Example tool",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name to greet" },
    },
    required: ["name"],
  },
  async execute(_ctx, args) {
    return { greeting: `Hello, ${String(args.name)}!` };
  },
});

export default defineSkill({
  id: "my-skill",
  name: "My Skill",
  version: "0.1.0",
  instructions: `
# My Skill

Instrucciones siempre presentes en el system prompt cuando la skill está activa.
`,
  tools: [exampleTool],
});
```

### `defineSkill()` API

```typescript
import { defineSkill, defineTool } from "@yggdrasil/skills-sdk";

export default defineSkill({
  id: string,           // identificador único
  name: string,         // nombre legible
  version?: string,     // default "0.1.0"
  instructions?: string, // Markdown → siempre en system prompt (priority 5)
  tools?: AgentToolDefinition[], // tools registradas con la skill
});
```

`defineTool` re-exportado desde `@yggdrasil/skills-sdk` — no necesitas imports adicionales.

---

## Compatibilidad Claude Code / skills.sh

Skills en formato Claude Code (como las de [skills.sh](https://skills.sh) o repos en GitHub) se adaptan automáticamente.

### Qué se mapea

| Claude Code | Yggdrasil | Comportamiento |
|-------------|-----------|----------------|
| `skills/*/SKILL.md` body | Context provider | Instrucciones siempre en system prompt |
| `commands/*.toml` | Slash commands TUI | Aparecen en `/` autocomplete, ejecutan el prompt al seleccionar |
| `.claude-plugin/plugin.json` hooks | ❌ ignorados | Sin equivalente |
| `tools:` en frontmatter | ❌ ignorado | Tools de Yggdrasil son independientes |

### Ejemplo: instalar caveman

```bash
yggdrasil skill install juliusbrussee/caveman
yggdrasil tui
```

En el TUI, escribe `/` → verás comandos `caveman`, `caveman-commit`, `caveman-review`, etc.
Al seleccionar, el prompt del `.toml` se envía al LLM (que ya tiene las instrucciones del SKILL.md en contexto).

### Wrapper generado

Para skills Claude Code, `yggdrasil skill install` genera en tu workspace:

```
extensions/skill-caveman/
  yggdrasil.plugin.json   ← id: "skill-caveman", kind: ["skill"]
  src/index.mjs           ← importa adaptClaudeSkill() del paquete instalado
```

El wrapper usa `@yggdrasil/skill-adapter` para leer el formato Claude Code en runtime.

---

## Publicar una skill en npm

```bash
cd extensions/my-skill
# Asegura que yggdrasil.plugin.json esté en "files"
npm publish --access public
```

`package.json` mínimo:

```json
{
  "name": "@scope/skill-name",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "files": ["dist", "yggdrasil.plugin.json"],
  "dependencies": {
    "@yggdrasil/skills-sdk": "^0.1.0"
  }
}
```

Otros usuarios instalan con:

```bash
yggdrasil skill install @scope/skill-name
```

---

## Cómo funciona internamente

### Pipeline de una skill Yggdrasil

```
defineSkill({ instructions, tools })
  ↓
api.registerContextProvider()  → instrucciones en system prompt en cada turn
api.registerTool()             → tools disponibles para el LLM
api.registerSkillCommand()     → comandos aparecen en TUI via skills.commands gateway method
```

### Pipeline de una skill Claude Code

```
.claude-plugin/plugin.json + skills/*.md + commands/*.toml
  ↓ skill-adapter
adaptClaudeSkill(dir, id)
  ↓
api.registerContextProvider()  → body del SKILL.md en system prompt
api.registerSkillCommand()     → cada commands/*.toml como slash command
```

### Gateway method `skills.commands`

El TUI llama `skills.commands` al conectar:

```json
// Respuesta
{
  "commands": [
    { "name": "caveman", "description": "Switch caveman mode", "prompt": "Switch to caveman {{args}} mode..." },
    { "name": "caveman-commit", "description": "...", "prompt": "..." }
  ]
}
```

Estos se mezclan con los comandos built-in del TUI (`/reset`, `/config`, `/sessions`, etc.).

---

## Paquetes

| Paquete | Rol |
|---------|-----|
| `@yggdrasil/skills-sdk` | `defineSkill()`, `defineTool()` — para autores de skills |
| `@yggdrasil/skill-adapter` | `adaptClaudeSkill()` — convierte formato Claude Code → plugin Yggdrasil |
| `@yggdrasil/cli` | `yggdrasil skill install/list` + `plugin create --kind skill` |
