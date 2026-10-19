#!/bin/bash
# Installs the "Enviar a Yggdrasil" Finder Quick Action helper script to a
# stable, repo-independent location, then prints the one-time Automator setup
# steps. Re-run this after editing send-to-yggdrasil.js to deploy the change
# (no Automator changes needed for script edits — only for a new install).
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$HOME/Library/Application Support/Yggdrasil/quick-actions"
DEST_SCRIPT="$DEST_DIR/send-to-yggdrasil.js"

mkdir -p "$DEST_DIR"
cp "$SRC_DIR/send-to-yggdrasil.js" "$DEST_SCRIPT"
echo "Instalado: $DEST_SCRIPT"

cat <<EOF

Falta un paso único en Automator (no se puede automatizar desde acá):

1. Abrí Automator.app → Archivo → Nuevo → "Acción rápida" (Quick Action).
2. Arriba: "El flujo de trabajo recibe" → "archivos o carpetas" en "Finder".
3. Buscá la acción "Ejecutar script de shell" ("Run Shell Script") y arrastrala al flujo.
4. En esa acción: Shell = /bin/bash, "Pasar entrada" = "como argumentos".
5. Reemplazá el contenido por esta única línea:

   exec /usr/bin/osascript -l JavaScript "$DEST_SCRIPT" "\$@"

6. Archivo → Guardar, nombre: "Enviar a Yggdrasil".
7. Probalo: click derecho sobre un archivo en Finder → "Enviar a Yggdrasil"
   (puede aparecer bajo un submenú "Acciones rápidas"/"Quick Actions" según
   tu versión de macOS). Elegí un proyecto y destino (notes / raíz).

Si no aparece en el menú contextual, cerrá y volvé a abrir Finder
(click derecho en el ícono de Finder en el Dock → Relanzar) y probá de nuevo.
EOF
