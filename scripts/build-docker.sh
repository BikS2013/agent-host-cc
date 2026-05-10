#!/usr/bin/env bash
# Build the agent-host-cc container image with Docker.
#
# Usage:
#   ./scripts/build-docker.sh                          # builds agent-host-cc:dev
#   ./scripts/build-docker.sh v1.2.0                   # builds agent-host-cc:v1.2.0
#   IMAGE_NAME=acme/host ./scripts/build-docker.sh     # builds acme/host:dev
#   PLATFORM=linux/amd64 ./scripts/build-docker.sh     # cross-build for x86_64
#
# Environment overrides:
#   IMAGE_NAME   image repository name        (default: agent-host-cc)
#   IMAGE_TAG    image tag                    (default: $1 or "dev")
#   PLATFORM     buildx --platform value      (default: native; unset disables --platform)
#   PROGRESS     buildx --progress value      (default: auto)
#   NO_CACHE     "1" to pass --no-cache       (default: unset)
#   EXTRA_ARGS   extra args appended to docker build (default: empty)

set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_NAME="${IMAGE_NAME:-agent-host-cc}"
IMAGE_TAG="${IMAGE_TAG:-${1:-dev}}"
PLATFORM="${PLATFORM:-}"
PROGRESS="${PROGRESS:-auto}"
NO_CACHE="${NO_CACHE:-}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found in PATH." >&2
  echo "Install Docker Desktop (https://www.docker.com/products/docker-desktop/) or use scripts/build-apple-container.sh instead." >&2
  exit 127
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon is not running." >&2
  echo "Start Docker Desktop and retry." >&2
  exit 1
fi

ARGS=(build -t "${IMAGE_NAME}:${IMAGE_TAG}" --progress "${PROGRESS}")
[[ -n "${PLATFORM}" ]]   && ARGS+=(--platform "${PLATFORM}")
[[ "${NO_CACHE}" == "1" ]] && ARGS+=(--no-cache)
# shellcheck disable=SC2206
[[ -n "${EXTRA_ARGS}" ]] && ARGS+=(${EXTRA_ARGS})

echo ">>> docker ${ARGS[*]} ."
docker "${ARGS[@]}" .

echo
echo "Built image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Inspect:    docker image inspect ${IMAGE_NAME}:${IMAGE_TAG} | head -40"
echo "Run:        docker run --rm --env-file .env -p 8000:8000 -v agent-host-cc-workspace:/workspace ${IMAGE_NAME}:${IMAGE_TAG}"
