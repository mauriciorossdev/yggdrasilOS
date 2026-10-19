#!/bin/sh
# Entry point for the headless gateway image (see Dockerfile,
# deploy/railway/README.md). Maps Railway's injected $PORT onto the
# gateway's own YGGDRASIL_GATEWAY_PORT env-var convention, seeds a default
# project config into the persistent volume on first boot, then execs the
# real `yggdrasil gateway` process.
set -e

export YGGDRASIL_GATEWAY_HOST="${YGGDRASIL_GATEWAY_HOST:-0.0.0.0}"
export YGGDRASIL_GATEWAY_PORT="${PORT:-${YGGDRASIL_GATEWAY_PORT:-8787}}"
export YGGDRASIL_WORKSPACE="${YGGDRASIL_WORKSPACE:-/data/project}"
export YGGDRASIL_WORKFLOW_STATE_DIR="${YGGDRASIL_WORKFLOW_STATE_DIR:-$YGGDRASIL_WORKSPACE/.state}"

mkdir -p "$YGGDRASIL_WORKSPACE/.yggdrasil/workflows" "$YGGDRASIL_WORKSPACE/notes" "$YGGDRASIL_WORKFLOW_STATE_DIR"

# First boot on a fresh volume: seed the config that tells the kernel's
# plugin loader where to find packages/extensions (same
# plugins.load.paths mechanism packages/app-desktop/src/main/gateway.ts
# uses for its own per-project gateway subprocess — see
# resolvePluginSearchPathsAsync in packages/kernel/src/plugin-loader.ts).
# Without this, a project directory outside the monorepo (which
# YGGDRASIL_WORKSPACE always is here) has no packages/extensions
# subdirectories of its own, so the kernel would discover zero plugins —
# including extensions/service-workflows itself.
# The config is deployment-managed: re-sync it from the template on every boot
# so changes (new agents, sessions.dir, ...) reach an already-seeded volume.
# Set YGGDRASIL_KEEP_CONFIG=1 to keep a hand-edited config on the volume.
if [ ! -f "$YGGDRASIL_WORKSPACE/yggdrasil.config.json" ] || [ "${YGGDRASIL_KEEP_CONFIG:-0}" != "1" ]; then
  echo "Syncing yggdrasil.config.json in $YGGDRASIL_WORKSPACE from template."
  cp /app/deploy/railway/project-template/yggdrasil.config.json "$YGGDRASIL_WORKSPACE/yggdrasil.config.json"
fi

echo "Starting gateway: host=$YGGDRASIL_GATEWAY_HOST port=$YGGDRASIL_GATEWAY_PORT workspace=$YGGDRASIL_WORKSPACE"
exec node /app/packages/cli/dist/index.js gateway
