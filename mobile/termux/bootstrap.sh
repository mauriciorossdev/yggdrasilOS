#!/data/data/com.termux/files/usr/bin/bash
# Yggdrasil "Proyectos Locales" companion bootstrap — run this inside Termux (F-Droid build).
# Idempotent: safe to re-run after an interrupted step.
#
# What this does, in order:
#   1. Installs ttyd + proot-distro in Termux itself (both are plain Termux packages, no build).
#   2. Installs a `ubuntu` proot-distro chroot (real glibc userland) if not already present.
#      This step is NEEDED, not optional: neither `claude` (Claude Code) nor `agy` (Google
#      Antigravity CLI) runs under Termux's own bionic (Android) libc — verified by hand on a
#      physical device: claude's installer explicitly says its "linux-arm64-android" binary "is
#      not available on this release channel", and agy's downloaded binary fails with "cannot
#      execute: required file not found" (a glibc dynamic-linker mismatch). Inside the chroot both
#      run for real. `proot-distro login` shares Termux's filesystem, so project directories under
#      ~/projects/ need no path translation between the two.
#   3. Installs node/npm/claude/agy *inside* the chroot (this is the slow part — several minutes,
#      ~250MB+ of apt packages for node alone).
#   4. Generates a shared secret token (once) that the companion server + Flutter app both use.
#   5. Starts the companion server (mobile/termux/companion.js).
#
# This script does NOT start ttyd itself — the companion spawns `ttyd` on demand, per project,
# when the Flutter app asks it to (see companion.js's /projects/:name/terminal endpoint).

set -euo pipefail

STATE_DIR="$HOME/.yggdrasil-local"
TOKEN_FILE="$STATE_DIR/token"
DISTRO="${YGGDRASIL_PROOT_DISTRO:-ubuntu}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> [1/5] Termux packages: ttyd, proot-distro, nodejs-lts"
pkg install -y ttyd proot-distro nodejs-lts >/dev/null
echo "    ok"

echo "==> [2/5] proot-distro '$DISTRO' chroot"
if proot-distro login "$DISTRO" -- true >/dev/null 2>&1; then
  echo "    already installed"
else
  echo "    installing (downloads a rootfs, ~40MB)..."
  proot-distro install "$DISTRO"
fi

echo "==> [3/5] node/claude/agy inside the chroot (this can take several minutes on first run)"
proot-distro login "$DISTRO" -- bash -lc '
  set -e
  if ! command -v node >/dev/null 2>&1; then
    echo "    installing nodejs/npm/curl via apt (slow, ~250MB)..."
    export DEBIAN_FRONTEND=noninteractive
    apt update -qq
    apt install -y -qq nodejs npm curl
  fi
  echo "    node: $(node -v)"

  if command -v claude >/dev/null 2>&1; then
    echo "    claude: already installed ($(claude --version 2>/dev/null || echo unknown))"
  else
    echo "    installing claude (Claude Code)..."
    if npm install -g @anthropic-ai/claude-code; then
      echo "    claude: OK"
    else
      echo "    claude: FAILED to install — not fatal, agy/shell modes still work"
    fi
  fi

  if command -v agy >/dev/null 2>&1 || [ -x "$HOME/.local/bin/agy" ]; then
    echo "    agy: already installed"
  else
    echo "    installing agy (Antigravity CLI)..."
    if curl -fsSL https://antigravity.google/cli/install.sh | bash; then
      echo "    agy: OK"
    else
      echo "    agy: FAILED to install — not fatal, claude/shell modes still work"
    fi
  fi
'

echo "==> [4/5] shared token"
mkdir -p "$STATE_DIR"
if [ -f "$TOKEN_FILE" ]; then
  echo "    reusing existing token"
else
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "    generated new token"
fi
TOKEN="$(cat "$TOKEN_FILE")"
echo ""
echo "    Companion token (paste into the app's Terminal Local settings):"
echo "    $TOKEN"
echo ""

echo "==> [5/5] starting companion server"
echo "    Run 'termux-wake-lock' in another Termux session before switching to the app,"
echo "    or Termux may get killed in the background and drop the connection."
echo ""
exec node "$SCRIPT_DIR/companion.js"
