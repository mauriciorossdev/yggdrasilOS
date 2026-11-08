#!/bin/sh
# Entry point for the headless gateway image (see Dockerfile). Refuses to start
# without a key, maps a host-injected $PORT onto the gateway's own port variable,
# syncs the project config into the persistent volume, then runs the gateway
# without root privileges.
set -e

# Its URL is public: without a key, anyone who finds it could use the gateway.
if [ -z "$(printf '%s' "${YGGDRASIL_API_KEY:-}" | tr -d '[:space:]')" ]; then
  echo "YGGDRASIL_API_KEY is required: this server is reachable from the internet." >&2
  echo "Generate one with: openssl rand -hex 32" >&2
  exit 1
fi

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
  cp /app/deploy/gateway-template/yggdrasil.config.json "$YGGDRASIL_WORKSPACE/yggdrasil.config.json"
fi

echo "Starting gateway: host=$YGGDRASIL_GATEWAY_HOST port=$YGGDRASIL_GATEWAY_PORT workspace=$YGGDRASIL_WORKSPACE"

# The gateway keeps state relative to where it runs: from here it lands on the
# volume, not in the image, where it would be lost on every redeploy.
cd "$YGGDRASIL_WORKSPACE"

# Drop root when it can own the workspace. Some hosts' volumes refuse chown, and
# the unprivileged user couldn't write there, so those keep running as root.
if [ "$(id -u)" = "0" ]; then
  if chown -R node:node "$YGGDRASIL_WORKSPACE" 2>/dev/null; then
    export HOME=/home/node
    exec setpriv --reuid=node --regid=node --init-groups node /app/packages/cli/dist/index.js gateway
  fi
  echo "Warning: couldn't take ownership of $YGGDRASIL_WORKSPACE, running as root." >&2
fi
exec node /app/packages/cli/dist/index.js gateway
