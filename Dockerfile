# syntax=docker/dockerfile:1.7
#
# @tcmcp/remote — multi-stage build · v0.3 (cloud edition · Zeabur DRI ops bundle)
#
# Stage 0 (multica-builder): Go build tc-multica's `multica` CLI from main.
# Stage 1 (builder):         pnpm install workspace, build the 4 packages.
# Stage 2 (runtime):         dist + multica binary + team-context scripts/skills/autopilots.
#
# ENTRYPOINT runs packages/remote/dist/server.js (HTTP/SSE transport · normal request path).
#
# DRI ops (zero-CLI on user mac · all flow through Zeabur exec):
#   zeabur service exec --id <tcmcp-remote> -- multica autopilot list
#   zeabur service exec --id <tcmcp-remote> -- bash /opt/team-context/scripts/apply-autopilots.sh
#   zeabur service exec --id <tcmcp-remote> -- bash             # interactive shell
#
# To refresh team-context (skills / autopilots / scripts) without rebuild:
#   zeabur service exec --id <tcmcp-remote> -- git -C /opt/team-context pull

# -----------------------------------------------------------------------------
# Stage 0 · multica CLI build (clones tc-multica @ main · GOPROXY for CN mirror)
# -----------------------------------------------------------------------------
FROM golang:1.26-alpine AS multica-builder
RUN apk add --no-cache git ca-certificates
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src
ARG MULTICA_REPO=https://github.com/feibo-ai/tc-multica.git
ARG MULTICA_REF=main
RUN git clone --depth 1 --branch ${MULTICA_REF} ${MULTICA_REPO}
RUN cd tc-multica/server && \
    CGO_ENABLED=0 go build -ldflags "-s -w" -o /multica ./cmd/multica

# -----------------------------------------------------------------------------
# Stage 1 · builder (unchanged from v0.2)
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

# Plan-5 base (wget + tini) · plus DRI-ops bundle (bash + curl + jq + git for scripts).
RUN apk add --no-cache wget tini bash curl jq git ca-certificates

WORKDIR /app

# multica CLI binary · DRI ops via `zeabur service exec -- multica …`
COPY --from=multica-builder /multica /usr/local/bin/multica
RUN chmod 0755 /usr/local/bin/multica

# feishu-cli (deprecated since W5 · kept for DRI debug per user request)
# Source: github.com/riba2534/feishu-cli  ·  https://github.com/riba2534/feishu-cli/releases
ARG FEISHU_CLI_VERSION=v1.29.0
RUN ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
 && curl -fsSL "https://github.com/riba2534/feishu-cli/releases/download/${FEISHU_CLI_VERSION}/feishu-cli_${FEISHU_CLI_VERSION}_linux-${ARCH}.tar.gz" \
      -o /tmp/feishu-cli.tar.gz \
 && tar -xzf /tmp/feishu-cli.tar.gz -C /tmp \
 && mv /tmp/feishu-cli /usr/local/bin/feishu-cli \
 && chmod 0755 /usr/local/bin/feishu-cli \
 && rm -f /tmp/feishu-cli.tar.gz

# NOTE · team-context repo is private · NOT bundled here.
# Bootstrap (labels / skills / autopilots / secrets) runs via DRI's `zeabur service exec`
# stream from local mac: `cat skills/.../SKILL.md | zeabur exec -- multica skill create --stdin`.
# Future · if team-context made public OR runtime token-clone added, mount /opt/team-context here.

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

# Writable home for `multica login` / `multica config` state when DRI execs in.
RUN mkdir -p /home/node/.multica && chown -R node:node /home/node/.multica

# Non-root for defence in depth · `node` user ships with the base image.
USER node

# tini reaps zombies and forwards signals cleanly to node.
ENTRYPOINT ["/sbin/tini", "--", "node", "/app/packages/remote/dist/server.js"]
