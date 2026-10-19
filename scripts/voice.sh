#!/usr/bin/env bash
# Loads .env (OLLAMA_API_KEY, LOAD_BALANCER_URL, etc.) and starts the voice
# app (`yggdrasil voice`) — same env vars used by the harness's LLM provider
# and by packages/app-voice. See .env.example for what's expected.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
else
  echo "warning: no .env found (copy .env.example -> .env and fill it in)." >&2
fi

if [ -z "${OLLAMA_API_KEY:-}" ]; then
  echo "warning: OLLAMA_API_KEY is not set — Yggdrasil will silently fall back to the builtin-echo harness." >&2
fi

exec pnpm yggdrasil voice "$@"
