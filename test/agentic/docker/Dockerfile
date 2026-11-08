# syntax=docker/dockerfile:1.7
#
# Sandbox for the agentic evals (see ../README.md). The model gets real shell and file tools, so the whole
# eval process runs in here instead of on the host: whatever it does stays inside the container, which is
# thrown away afterwards. Build context is the repo root:
#
#   docker build -f test/agentic/docker/Dockerfile -t yggdrasil-eval:local .
#
# Normally started through `pnpm eval:agentic:docker` (run.mjs), which adds the isolation flags.

ARG NODE_IMAGE=node:22-bookworm-slim

# Stage 1 — only the manifests. Copying every package.json (and nothing else) lets the install layer below
# stay cached until a dependency actually changes, not on every source edit.
FROM ${NODE_IMAGE} AS manifests
WORKDIR /src
COPY . .
RUN find . -type f ! -name package.json ! -name pnpm-lock.yaml ! -name pnpm-workspace.yaml ! -name .npmrc -delete \
 && find . -type d -empty -delete

FROM ${NODE_IMAGE} AS deps
# git: models like to run it. ca-certificates: npm over https (the React scenario installs from the registry).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.33.2 \
 && mkdir -p /home/node/app && chown node:node /home/node/app
USER node
WORKDIR /home/node/app
COPY --from=manifests --chown=node:node /src ./
# No scripts: nothing the evals load needs a native build (the memory plugins are not used), and skipping them
# avoids compiling better-sqlite3. The Electron apps are left out — they are the heavy part and not involved.
RUN --mount=type=cache,id=ygg-eval-pnpm,target=/home/node/.local/share/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --ignore-scripts \
      --filter='!@yggdrasil/app-desktop' --filter='!@yggdrasil/app-avatar'

FROM deps AS final
COPY --chown=node:node . .
ENV EVAL_IN_DOCKER=1 \
    CI=1 \
    HOME=/home/node
# Arguments after the image name are passed to vitest; configuration is by EVAL_* variables.
ENTRYPOINT ["pnpm", "exec", "vitest", "run", "--config", "vitest.agentic.config.ts"]
