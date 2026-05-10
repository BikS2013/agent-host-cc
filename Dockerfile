FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
# The node:22-alpine base image ships with a non-root `node` user already at
# uid=1000 / gid=1000, which satisfies ADR-6 (deterministic non-root uid for
# volume-permission planning). Reuse it instead of creating a duplicate user.
#
# `su-exec` is the BusyBox-friendly equivalent of `gosu` and is required by
# scripts/docker-entrypoint.sh to drop from root to node after the runtime
# `chown /workspace` step that re-asserts ownership over a freshly-mounted
# named volume (see scripts/docker-entrypoint.sh for the full rationale).
RUN apk add --no-cache su-exec \
 && mkdir -p /workspace \
 && chown node:node /workspace
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=root:root --chmod=0755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# USER root: the entrypoint must start as root so it can chown /workspace
# when a fresh named volume mounts on top of the image's pre-chowned dir.
# It then drops to `node` via `su-exec` before exec'ing CMD. The container's
# main process therefore runs as uid=1000, preserving ADR-6.
USER root
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
