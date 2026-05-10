#!/usr/bin/env bash
# Stop any running Docker container started from the agent-host-cc image.
#
# Usage:
#   ./scripts/stop-docker.sh                           # stop all running agent-host-cc:dev
#   ./scripts/stop-docker.sh v1.2.0                    # stop running agent-host-cc:v1.2.0
#   IMAGE_NAME=acme/host ./scripts/stop-docker.sh      # stop running acme/host:dev
#
# Environment overrides:
#   IMAGE_NAME    image repository name      (default: agent-host-cc)
#   IMAGE_TAG     image tag                  (default: $1 or "dev")
#   TIMEOUT       seconds to wait for graceful stop before SIGKILL (default: 10)
#   ALL_TAGS      "1" → stop containers from any tag of IMAGE_NAME (default: unset)
#   FORCE         "1" → use `kill` instead of `stop` (default: unset)

set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_NAME="${IMAGE_NAME:-agent-host-cc}"
IMAGE_TAG="${IMAGE_TAG:-${1:-dev}}"
TIMEOUT="${TIMEOUT:-10}"
ALL_TAGS="${ALL_TAGS:-}"
FORCE="${FORCE:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found in PATH." >&2
  exit 127
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon is not running." >&2
  exit 1
fi

# Find candidate containers (running only).
if [[ "${ALL_TAGS}" == "1" ]]; then
  filter="ancestor=${IMAGE_NAME}"
  desc="${IMAGE_NAME}:* (any tag)"
else
  filter="ancestor=${IMAGE_NAME}:${IMAGE_TAG}"
  desc="${IMAGE_NAME}:${IMAGE_TAG}"
fi

IDS=()
while IFS= read -r line; do
  [[ -n "${line}" ]] && IDS+=("${line}")
done < <(docker ps --filter "${filter}" --format '{{.ID}}')

if [[ ${#IDS[@]} -eq 0 ]]; then
  echo "No running containers from ${desc}."
  exit 0
fi

echo "Found ${#IDS[@]} running container(s) from ${desc}:"
docker ps --filter "${filter}" --format 'table {{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Status}}'
echo

if [[ "${FORCE}" == "1" ]]; then
  echo ">>> docker kill ${IDS[*]}"
  docker kill "${IDS[@]}"
else
  echo ">>> docker stop -t ${TIMEOUT} ${IDS[*]}"
  docker stop -t "${TIMEOUT}" "${IDS[@]}"
fi

echo
echo "Stopped ${#IDS[@]} container(s)."
