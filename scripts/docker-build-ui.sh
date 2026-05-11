#!/usr/bin/env bash
# Build the chat-ui Docker image.
#
# Tags:
#   - agent-host-cc-ui:latest
#   - agent-host-cc-ui:<short-git-sha>  (when in a git checkout)
#
# Usage:
#   ./scripts/docker-build-ui.sh                  # default tags
#   IMAGE_NAME=foo TAG=bar ./scripts/docker-build-ui.sh
#
# Env overrides:
#   IMAGE_NAME   default "agent-host-cc-ui"
#   TAG          default "latest"
#   BUILD_ARGS   extra args passed verbatim to `docker build`

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
UI_DIR="${REPO_ROOT}/chat-ui"

IMAGE_NAME="${IMAGE_NAME:-agent-host-cc-ui}"
TAG="${TAG:-latest}"
PRIMARY_REF="${IMAGE_NAME}:${TAG}"

if [[ ! -f "${UI_DIR}/Dockerfile" ]]; then
  echo "[docker-build-ui] error: ${UI_DIR}/Dockerfile not found" >&2
  exit 1
fi

# Derive a short git sha so each build is identifiable.
GIT_SHA=""
if git -C "${REPO_ROOT}" rev-parse --short HEAD >/dev/null 2>&1; then
  GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
fi

echo "[docker-build-ui] building ${PRIMARY_REF} (context: ${UI_DIR})"

# BuildKit is required for the --mount=type=cache directive in the Dockerfile.
export DOCKER_BUILDKIT=1

# shellcheck disable=SC2086  # intentional word-splitting on BUILD_ARGS
docker build \
  ${BUILD_ARGS:-} \
  -f "${UI_DIR}/Dockerfile" \
  -t "${PRIMARY_REF}" \
  "${UI_DIR}"

if [[ -n "${GIT_SHA}" ]]; then
  SHA_REF="${IMAGE_NAME}:${GIT_SHA}"
  docker tag "${PRIMARY_REF}" "${SHA_REF}"
  echo "[docker-build-ui] tagged ${SHA_REF}"
fi

# Report image id + size.
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "${PRIMARY_REF}")"
IMAGE_SIZE_BYTES="$(docker image inspect --format '{{.Size}}' "${PRIMARY_REF}")"
IMAGE_SIZE_MB=$(( IMAGE_SIZE_BYTES / 1024 / 1024 ))

echo "[docker-build-ui] done"
echo "  image:  ${PRIMARY_REF}"
echo "  id:     ${IMAGE_ID}"
echo "  size:   ${IMAGE_SIZE_MB} MB"
