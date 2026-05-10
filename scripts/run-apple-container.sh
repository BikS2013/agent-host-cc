#!/usr/bin/env bash
# Run the agent-host-cc container with Apple's native `container` CLI.
#
# Usage:
#   ./scripts/run-apple-container.sh                 # foreground, port 8000, named volume, .env
#   ./scripts/run-apple-container.sh v1.2.0          # run a specific tag
#   DETACH=1 ./scripts/run-apple-container.sh        # run in background
#
# Environment overrides:
#   IMAGE_NAME     image repository name      (default: agent-host-cc)
#   IMAGE_TAG      image tag                  (default: $1 or "dev")
#   ENV_FILE       env-file path              (default: ./.env — must exist; no fallback)
#   HOST_PORT      host port to publish       (default: 8000)
#   CONTAINER_PORT container listen port      (default: 8000 — must match LISTEN_PORT in env)
#   VOLUME_NAME    workspace named volume     (default: agent-host-cc-workspace)
#   CONTAINER_NAME --name value               (default: unset; container auto-names)
#   DETACH         "1" → -d, else -it foreground (default: unset → foreground)
#   EXTRA_ARGS     extra args appended         (default: empty)

set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_NAME="${IMAGE_NAME:-agent-host-cc}"
IMAGE_TAG="${IMAGE_TAG:-${1:-dev}}"
ENV_FILE="${ENV_FILE:-.env}"
HOST_PORT="${HOST_PORT:-8000}"
CONTAINER_PORT="${CONTAINER_PORT:-8000}"
VOLUME_NAME="${VOLUME_NAME:-agent-host-cc-workspace}"
CONTAINER_NAME="${CONTAINER_NAME:-}"
DETACH="${DETACH:-}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

if ! command -v container >/dev/null 2>&1; then
  echo "ERROR: 'container' CLI not found in PATH." >&2
  echo "Install: https://github.com/apple/container — or use scripts/run-docker.sh instead." >&2
  exit 127
fi

# Ensure the system service is up.
if ! container system status >/dev/null 2>&1; then
  echo ">>> container system start"
  container system start
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env-file '${ENV_FILE}' not found." >&2
  echo "Create one from .env.example: cp .env.example .env && chmod 600 .env" >&2
  exit 2
fi
# `container image inspect <ref>` (singular) is the reliable existence check —
# the plural form `container images list` is shipped via a separate plugin that
# is not always present (Apple container ≤ 0.12.x). The singular form is built-in.
if ! container image inspect "${IMAGE_NAME}:${IMAGE_TAG}" >/dev/null 2>&1; then
  echo "ERROR: image ${IMAGE_NAME}:${IMAGE_TAG} not found locally." >&2
  echo "Build it first:  ./scripts/build-apple-container.sh ${IMAGE_TAG}" >&2
  exit 3
fi

ARGS=(run --rm)
if [[ "${DETACH}" == "1" ]]; then
  ARGS+=(-d)
else
  ARGS+=(-it)
fi
ARGS+=(--env-file "${ENV_FILE}")
ARGS+=(-p "${HOST_PORT}:${CONTAINER_PORT}")
ARGS+=(-v "${VOLUME_NAME}:/workspace")
[[ -n "${CONTAINER_NAME}" ]] && ARGS+=(--name "${CONTAINER_NAME}")
# shellcheck disable=SC2206
[[ -n "${EXTRA_ARGS}" ]] && ARGS+=(${EXTRA_ARGS})
ARGS+=("${IMAGE_NAME}:${IMAGE_TAG}")

echo ">>> container ${ARGS[*]}"
container "${ARGS[@]}"
