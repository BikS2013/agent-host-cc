#!/bin/sh
# Runtime entrypoint for the agent-host-cc image.
#
# Why this exists:
#   When a fresh named volume (Apple `container` CLI or Docker) is mounted at
#   /workspace, it is initialised with root:root ownership and overrides the
#   image's pre-`chown`'d directory. Our process runs as the non-root `node`
#   user (uid=1000) and cannot write into a root-owned /workspace, producing
#   `EACCES: permission denied, mkdir '/workspace/...'` on the first chat that
#   needs a per-chat workspace. ADR-6 / BUILD-1 in Issues - Pending Items.md
#   document why we keep the `node` user.
#
# What this does:
#   1. Runs as root (set via `USER root` in the Dockerfile right above the
#      ENTRYPOINT).
#   2. Ensures /workspace is owned by node:node. Idempotent — safe across
#      restarts; the chown is a no-op once ownership is correct.
#   3. Drops privileges via `su-exec node` and execs the requested command.
#
# No fallback: if /workspace doesn't exist or chown fails, this script exits
# non-zero so the container fails fast (per the project's no-fallback rule).

set -e

if [ ! -d /workspace ]; then
  echo "entrypoint: /workspace does not exist (image build is broken)" >&2
  exit 1
fi

chown node:node /workspace

exec su-exec node:node "$@"
