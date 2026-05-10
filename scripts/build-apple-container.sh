#!/usr/bin/env bash
# Build the agent-host-cc container image with Apple's native `container` CLI.
#
# Apple container CLI (https://github.com/apple/container) is a Docker-alternative
# runtime that ships with macOS 15+ on Apple Silicon. It uses lightweight VMs and
# virtiofs mounts. The Dockerfile in this project is fully compatible — but image
# tagging and run flags differ slightly from Docker.
#
# Usage:
#   ./scripts/build-apple-container.sh                       # builds agent-host-cc:dev
#   ./scripts/build-apple-container.sh v1.2.0                # builds agent-host-cc:v1.2.0
#   IMAGE_NAME=acme/host ./scripts/build-apple-container.sh  # builds acme/host:dev
#
# Environment overrides:
#   IMAGE_NAME   image repository name      (default: agent-host-cc)
#   IMAGE_TAG    image tag                  (default: $1 or "dev")
#   NO_CACHE     "1" to pass --no-cache     (default: unset)
#   EXTRA_ARGS   extra args appended        (default: empty)
#
# Notes:
#   * Apple container builds Linux images on Apple Silicon natively (linux/arm64).
#     Cross-building to linux/amd64 requires `--arch amd64`; set EXTRA_ARGS to add it.
#   * The system service must be running. Start it once per boot with `container system start`.

set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_NAME="${IMAGE_NAME:-agent-host-cc}"
IMAGE_TAG="${IMAGE_TAG:-${1:-dev}}"
NO_CACHE="${NO_CACHE:-}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

if ! command -v container >/dev/null 2>&1; then
  echo "ERROR: 'container' CLI not found in PATH." >&2
  echo "Apple container CLI ships with macOS 15+ on Apple Silicon." >&2
  echo "Install: https://github.com/apple/container — or use scripts/build-docker.sh instead." >&2
  exit 127
fi

# Ensure the system service is up; ignore errors if it is already running.
if ! container system status >/dev/null 2>&1; then
  echo ">>> container system start"
  container system start
fi

ARGS=(build -t "${IMAGE_NAME}:${IMAGE_TAG}")
[[ "${NO_CACHE}" == "1" ]] && ARGS+=(--no-cache)
# shellcheck disable=SC2206
[[ -n "${EXTRA_ARGS}" ]] && ARGS+=(${EXTRA_ARGS})

echo ">>> container ${ARGS[*]} ."
container "${ARGS[@]}" .

echo
echo "Built image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Inspect:    container image inspect ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Run:        container run --rm --env-file .env -p 8000:8000 -v agent-host-cc-workspace:/workspace ${IMAGE_NAME}:${IMAGE_TAG}"
