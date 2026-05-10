#!/usr/bin/env bash
# Run the agent-host-cc container with Docker.
#
# Usage:
#   ./scripts/run-docker.sh                           # foreground, port 8000, named volume, .env
#   ./scripts/run-docker.sh v1.2.0                    # run a specific tag
#   DETACH=1 ./scripts/run-docker.sh                  # run in background, print container id
#
# Environment overrides:
#   IMAGE_NAME    image repository name      (default: agent-host-cc)
#   IMAGE_TAG     image tag                  (default: $1 or "dev")
#   ENV_FILE      env-file path              (default: ./.env — must exist; no fallback)
#   HOST_PORT     host port to publish       (default: 8000)
#   CONTAINER_PORT container listen port      (default: 8000 — must match LISTEN_PORT in env)
#   VOLUME_NAME   workspace named volume     (default: agent-host-cc-workspace)
#   CONTAINER_NAME --name value              (default: unset; Docker auto-names)
#   DETACH        "1" → -d, else -it foreground (default: unset → foreground)
#   EXTRA_ARGS    extra args appended to docker run (default: empty)

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

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found in PATH." >&2
  exit 127
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon is not running." >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env-file '${ENV_FILE}' not found." >&2
  echo "Create one from .env.example: cp .env.example .env && chmod 600 .env" >&2
  exit 2
fi
if ! docker image inspect "${IMAGE_NAME}:${IMAGE_TAG}" >/dev/null 2>&1; then
  echo "ERROR: image ${IMAGE_NAME}:${IMAGE_TAG} not found locally." >&2
  echo "Build it first:  ./scripts/build-docker.sh ${IMAGE_TAG}" >&2
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

echo ">>> docker ${ARGS[*]}"
docker "${ARGS[@]}"
