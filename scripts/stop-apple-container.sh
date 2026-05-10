#!/usr/bin/env bash
# Stop any running Apple `container` instance started from the agent-host-cc image.
#
# Usage:
#   ./scripts/stop-apple-container.sh                  # stop all running agent-host-cc:dev
#   ./scripts/stop-apple-container.sh v1.2.0           # stop running agent-host-cc:v1.2.0
#   IMAGE_NAME=acme/host ./scripts/stop-apple-container.sh
#
# Environment overrides:
#   IMAGE_NAME    image repository name      (default: agent-host-cc)
#   IMAGE_TAG     image tag                  (default: $1 or "dev")
#   ALL_TAGS      "1" → stop containers from any tag of IMAGE_NAME (default: unset)
#   FORCE         "1" → use `container kill` instead of `container stop` (default: unset)

set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_NAME="${IMAGE_NAME:-agent-host-cc}"
IMAGE_TAG="${IMAGE_TAG:-${1:-dev}}"
ALL_TAGS="${ALL_TAGS:-}"
FORCE="${FORCE:-}"

if ! command -v container >/dev/null 2>&1; then
  echo "ERROR: 'container' CLI not found in PATH." >&2
  exit 127
fi

if ! container system status >/dev/null 2>&1; then
  echo "Apple container system service is not running — nothing to stop."
  exit 0
fi

# Apple `container ls` output (header + rows) — the IMAGE column carries the
# tag, e.g. `agent-host-cc:dev`. We filter rows on STATE=running.
if [[ "${ALL_TAGS}" == "1" ]]; then
  match="^${IMAGE_NAME}(:|$)"
  desc="${IMAGE_NAME}:* (any tag)"
else
  match="^${IMAGE_NAME}:${IMAGE_TAG}$"
  desc="${IMAGE_NAME}:${IMAGE_TAG}"
fi

IDS=()
while IFS= read -r line; do
  [[ -n "${line}" ]] && IDS+=("${line}")
done < <(
  container ls 2>/dev/null \
    | awk -v m="${match}" 'NR>1 && $5 == "running" && $2 ~ m { print $1 }'
)

if [[ ${#IDS[@]} -eq 0 ]]; then
  echo "No running containers from ${desc}."
  exit 0
fi

echo "Found ${#IDS[@]} running container(s) from ${desc}:"
container ls 2>/dev/null \
  | awk -v m="${match}" 'NR==1 || ($5 == "running" && $2 ~ m)'
echo

if [[ "${FORCE}" == "1" ]]; then
  for id in "${IDS[@]}"; do
    echo ">>> container kill ${id}"
    container kill "${id}" || true
  done
else
  for id in "${IDS[@]}"; do
    echo ">>> container stop ${id}"
    container stop "${id}" || true
  done
fi

echo
echo "Stopped ${#IDS[@]} container(s)."
