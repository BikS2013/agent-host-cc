#!/usr/bin/env bash
# Convenience wrapper that auto-selects between Docker and Apple `container`
# (same selection logic as run.sh and build.sh).
#
# Selection order:
#   1. Honor RUNNER env var if set:    RUNNER=docker | apple
#   2. Else prefer 'docker' if its daemon is reachable.
#   3. Else fall back to 'container' if it is installed.
#   4. Else fail with a helpful message.
#
# Usage (same as the underlying scripts):
#   ./scripts/stop.sh                 # stop all running agent-host-cc:dev
#   ./scripts/stop.sh v1.2.0          # stop a specific tag
#   ALL_TAGS=1 ./scripts/stop.sh      # stop any tag of the image
#   FORCE=1 ./scripts/stop.sh         # SIGKILL instead of graceful stop

set -euo pipefail

cd "$(dirname "$0")/.."

RUNNER="${RUNNER:-}"

pick_runner() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "docker"; return 0
  fi
  if command -v container >/dev/null 2>&1; then
    echo "apple"; return 0
  fi
  return 1
}

if [[ -z "${RUNNER}" ]]; then
  RUNNER="$(pick_runner)" || {
    echo "ERROR: neither docker (running) nor 'container' CLI is available." >&2
    exit 127
  }
fi

case "${RUNNER}" in
  docker) exec ./scripts/stop-docker.sh "$@" ;;
  apple)  exec ./scripts/stop-apple-container.sh "$@" ;;
  *)
    echo "ERROR: unknown RUNNER='${RUNNER}'. Expected 'docker' or 'apple'." >&2
    exit 2
    ;;
esac
