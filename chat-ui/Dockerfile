# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the chat-ui sub-application.
#
# Stage 1 (builder): install full deps, compile the SPA (vite) and the
#   server (tsc), then prune dev deps so node_modules carries production
#   packages only.
# Stage 2 (runtime): node:22-bookworm-slim base, non-root `node` user,
#   copy production node_modules + dist + package.json, expose the
#   chat-ui server port, run `node dist/server/index.js`.
#
# IMPORTANT — the chat-ui Fastify server binds to 127.0.0.1 inside the
# container by design (chat-ui/server/config.ts hardcodes the host). The
# `-p HOST:CONTAINER` port mapping therefore CANNOT reach it through the
# default bridge network. To smoke-test the container from a host, run it
# with `--network host` on Linux, OR run a local TCP forwarder inside the
# container. The chat-ui/README.md "Containerization" section documents
# both workarounds.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# Install deps first to maximise layer caching when only source changes.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy sources needed for the build.
COPY tsconfig.base.json tsconfig.server.json tsconfig.client.json vite.config.ts ./
COPY client ./client
COPY server ./server

# Build: emits dist/client (Vite) + dist/server (tsc).
RUN npm run build

# Drop dev dependencies for the runtime stage.
RUN --mount=type=cache,target=/root/.npm \
    npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

# OCI labels make the image self-describing.
LABEL org.opencontainers.image.title="agent-host-cc-chat-ui"
LABEL org.opencontainers.image.description="Chat-UI sub-app for agent-host-cc."
LABEL org.opencontainers.image.source="https://github.com/BikS2013/agent-host-cc"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    CHAT_UI_PORT=5174 \
    LOG_LEVEL=info

WORKDIR /app

# Copy the production node_modules, the compiled artifacts, and package.json.
# Ownership is set to the built-in non-root `node` user (uid=1000).
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 5174

# Lightweight liveness probe — the chat-ui exposes /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.CHAT_UI_PORT||'5174')+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
