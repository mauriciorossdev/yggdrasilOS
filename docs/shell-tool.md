# Shell Tool (TL-03)

Permite al agente ejecutar comandos de shell en un subproceso aislado. Requiere `@yggdrasil/tool-shell`.

## Cómo funciona

1. El agente llama `shell_exec(command, cwd?, timeout?)`
2. El comando se pasa a `/bin/sh -c <command>`
3. Corre en sandbox: env filtrado, stdin cerrado, sin acceso a red adicional
4. Devuelve `stdout`, `stderr`, `exitCode`, `timedOut`

## Sandbox (F3-01)

El sandbox restringe:
- **Env**: solo `PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `TMPDIR`. Ninguna variable de API key, token, o secret llega al subproceso.
- **Stdin**: cerrado (no puede leer input interactivo)
- **Output**: máximo 1 MB por stdout + 1 MB por stderr
- **Timeout**: default 30s, máximo 300s (5 min)
- **CWD**: si configuras `allowedRoot`, el cwd debe estar dentro de ese directorio

## Instalación

```bash
yggdrasil plugin install @yggdrasil/tool-shell
```

## Configuración en `yggdrasil.config.json`

```json
{
  "plugins": {
    "installed": ["@yggdrasil/tool-shell"]
  },
  "pluginConfig": {
    "tool-shell": {
      "allowedRoot": "/home/usuario/proyectos"
    }
  }
}
```

`allowedRoot` es opcional. Si se omite, el agente puede usar cualquier directorio que exista.

## Herramienta: `shell_exec`

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `command` | string | sí | — | Comando shell (se pasa a `/bin/sh -c`) |
| `cwd` | string | no | `process.cwd()` | Directorio de trabajo |
| `timeout` | number | no | 30 | Segundos máximos de ejecución |

### Respuesta

```json
{
  "stdout": "...",
  "stderr": "...",
  "exitCode": 0,
  "timedOut": false
}
```

- `exitCode: null` — proceso no pudo iniciarse (ver `stderr` para el error)
- `timedOut: true` — se mató con SIGKILL por timeout

## Risk level: `destructive`

Requiere aprobación explícita del usuario (igual que `fs_delete`, `fs_write_file`). El agente presentará la herramienta para aprobación antes de ejecutar.

## Prueba manual

Inicia el agente con TUI y escribe:

```
Ejecuta: ls -la /tmp
```

```
¿Cuál es la versión de node instalada?
```

```
Crea un archivo de prueba en /tmp/hello.txt con el texto "hola mundo"
```

```
Ejecuta un script que tarde 35 segundos y observa el timeout
```

Prueba de timeout:
```
Ejecuta: sleep 60
```
→ debe devolver `timedOut: true` y `exitCode: null` a los 30s.

Prueba de env aislado:
```
Ejecuta: echo $OPENAI_API_KEY
```
→ debe devolver string vacío (env filtrado).

Prueba de output grande:
```
Ejecuta: dd if=/dev/urandom bs=1M count=5 2>/dev/null | base64
```
→ se trunca a 1 MB.

## Restricción de directorio (allowedRoot)

Con `"allowedRoot": "/home/user/proyectos"`:

```
Ejecuta ls en /etc
```
→ error: `cwd "/etc" is outside allowed root "/home/user/proyectos"`

```
Ejecuta ls en /home/user/proyectos/mi-app
```
→ funciona.

## Notas de seguridad

- El sandbox **no** es un container ni VM. No aísla red ni filesystem — solo filtra env y controla recursos.
- Para proyectos de mayor riesgo, considera correr Yggdrasil dentro de Docker.
- Comandos como `curl`, `wget`, `ssh` siguen funcionando si están en PATH. Si quieres bloquearlos, usa `allowedRoot` + shell restringida o Docker.
