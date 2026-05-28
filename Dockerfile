# syntax=docker/dockerfile:1.7
#
# @tcmcp/remote — multi-stage build for local debug (Plan 5 M-21).
#
# Stage 1 (builder): pnpm install workspace, build the 4 packages we need.
# Stage 2 (runtime): copy only built dist/ + production node_modules.
#
# ENTRYPOINT runs packages/remote/dist/server.js (HTTP/SSE transport).

# -----------------------------------------------------------------------------
# Stage 1 · builder
# -----------------------------------------------------------------------------
# Node 22 because pnpm 11.x uses `node:sqlite` (added in 22.5).  package.json
# `engines.node` is ">=20"; 22 is in range.  Runtime can stay on the same
# image so we don't carry two node versions.
FROM node:22-alpine AS builder

# Match host pnpm 11.x · pinned to avoid surprise major bumps.
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /app

# Workspace manifests first · maximises layer cache reuse on dep changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json tsconfig.base.json ./
COPY packages/shared/package.json   packages/shared/
COPY packages/config/package.json   packages/config/
COPY packages/feishu/package.json   packages/feishu/
COPY packages/remote/package.json   packages/remote/
COPY packages/local/package.json    packages/local/

# Full install including dev deps · we need tsc to build.
RUN pnpm install --frozen-lockfile

# Now copy actual sources for the 4 packages remote depends on.
COPY packages/shared   packages/shared
COPY packages/config   packages/config
COPY packages/feishu   packages/feishu
COPY packages/remote   packages/remote

# Build in dependency order. shared → config → feishu → remote.
RUN pnpm --filter @tcmcp/shared build \
 && pnpm --filter @tcmcp/config build \
 && pnpm --filter @tcmcp/feishu build \
 && pnpm --filter @tcmcp/remote build

# Strip dev deps for the runtime image. Keeps node_modules lean.
# CI=true tells pnpm to non-interactively purge dev node_modules.
RUN CI=true pnpm install --frozen-lockfile --prod \
 && pnpm store prune

# -----------------------------------------------------------------------------
# Stage 2 · runtime
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# wget is used by the docker-compose healthcheck against /health.
RUN apk add --no-cache wget tini

WORKDIR /app

# Copy manifests (needed at runtime for `node` to resolve workspace packages
# through node_modules symlinks that pnpm creates).
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules

# Per-package: package.json + built dist + workspace-local node_modules.
COPY --from=builder /app/packages/shared/package.json   packages/shared/package.json
COPY --from=builder /app/packages/shared/dist           packages/shared/dist
COPY --from=builder /app/packages/shared/node_modules   packages/shared/node_modules

COPY --from=builder /app/packages/config/package.json   packages/config/package.json
COPY --from=builder /app/packages/config/dist           packages/config/dist
COPY --from=builder /app/packages/config/node_modules   packages/config/node_modules

COPY --from=builder /app/packages/feishu/package.json   packages/feishu/package.json
COPY --from=builder /app/packages/feishu/dist           packages/feishu/dist
COPY --from=builder /app/packages/feishu/node_modules   packages/feishu/node_modules

COPY --from=builder /app/packages/remote/package.json   packages/remote/package.json
COPY --from=builder /app/packages/remote/dist           packages/remote/dist
COPY --from=builder /app/packages/remote/node_modules   packages/remote/node_modules

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_PORT=8443

EXPOSE 8443

# Non-root for defence in depth · `node` user ships with the base image.
USER node

# tini reaps zombies and forwards signals cleanly to node.
ENTRYPOINT ["/sbin/tini", "--", "node", "/app/packages/remote/dist/server.js"]
