# Pruebas manuales: workspaceRoot + system docs

## Setup común

```bash
# Proyecto de prueba
mkdir /tmp/test-ygg && cd /tmp/test-ygg
yggdrasil init
echo "hola mundo" > /tmp/test-ygg/test.txt

# Gateway con API key (ajustar key según config)
yggdrasil gateway &
GATEWAY=ws://localhost:18789
```

---

## 1. docs.list y docs.get via gateway

```bash
# Listar docs disponibles
wscat -c "$GATEWAY" -x '{"method":"docs.list","params":{},"id":1}'
# OK: {"id":1,"result":{"docs":["api-keys","browser-tool","cron-service",...]}}  (13 docs)

# Leer doc específico
wscat -c "$GATEWAY" -x '{"method":"docs.get","params":{"name":"shell-tool"},"id":2}'
# OK: {"id":2,"result":{"name":"shell-tool","content":"# Shell Tool..."}}

# Nombre con path traversal → sanitizado → error de archivo no encontrado
wscat -c "$GATEWAY" -x '{"method":"docs.get","params":{"name":"../../../etc/passwd"},"id":3}'
# OK: INTERNAL_ERROR (sanitizeName filtra a string vacío)
```

---

## 2. fs_* resuelve relativo a workspaceRoot, no a cwd

```bash
# Lanzar TUI desde SUBDIRECTORIO distinto al workspace
mkdir /tmp/test-ygg/subdir
cd /tmp/test-ygg/subdir
yggdrasil tui
```

En TUI:
```
Lee el archivo test.txt
```
- **Esperado**: lee `/tmp/test-ygg/test.txt` ✓
- **Fallo**: ENOENT (resuelve contra `/tmp/test-ygg/subdir/test.txt`)

```
Lista el directorio .
```
- **Esperado**: lista archivos de `/tmp/test-ygg/` ✓
- **Fallo**: lista `/tmp/test-ygg/subdir/`

```
Lee /etc/hosts
```
- **Esperado**: funciona — path absoluto ignora workspaceRoot ✓

---

## 3. shell_exec cwd default = workspaceRoot

```bash
cd /tmp
YGGDRASIL_WORKSPACE=/tmp/test-ygg yggdrasil tui
```

En TUI:
```
Ejecuta: pwd
```
- **Esperado**: `/tmp/test-ygg` ✓
- **Fallo**: `/tmp`

```
Ejecuta: ls
```
- **Esperado**: lista archivos de `/tmp/test-ygg/` ✓

---

## 4. yggdrasil init scaffoldea prompts/

```bash
rm -rf /tmp/test-init && mkdir /tmp/test-init && cd /tmp/test-init
yggdrasil init
```

**Verificar output:**
```
Created /tmp/test-init/yggdrasil.config.json
Created /tmp/test-init/extensions/
Created /tmp/test-init/prompts/agent.md       ← nuevo
Created /tmp/test-init/prompts/capabilities.md ← nuevo
```

```bash
cat /tmp/test-init/prompts/agent.md
# OK: contiene instrucciones + referencia a docs.get

cat /tmp/test-init/prompts/capabilities.md
# OK: contiene guía de tools y docs.get
```

---

## 5. context-system-docs auto-descubierto como plugin

```bash
wscat -c "$GATEWAY" -x '{"method":"plugins.list","params":{},"id":1}'
# OK: "context-system-docs" aparece en la lista de plugins
```

---

## 6. Agente usa docs on-demand (integración)

Con TUI corriendo en `/tmp/test-ygg`:

```
¿Qué tools tienes para el filesystem?
```
→ Responde con info de `prompts/capabilities.md` (Option 1, ya en contexto)

```
Dame los detalles del sandbox de shell_exec
```
→ Agente llama `docs.get("shell-tool")` → responde con contenido del doc (Option 3)

```
Lista los docs de Yggdrasil disponibles
```
→ Agente llama `docs.list` → lista 13 docs

---

## 7. Regresión — paths absolutos no se rompen

```
Lee /etc/hostname
```
- **Esperado**: funciona ✓

```
Escribe "test" en /tmp/salida.txt
```
- **Esperado**: crea `/tmp/salida.txt` ✓ (path absoluto, workspaceRoot ignorado)

---

## Limpieza

```bash
kill %1  # detener gateway
rm -rf /tmp/test-ygg /tmp/test-init /tmp/salida.txt
```
