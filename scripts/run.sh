#!/usr/bin/env bash
# Convenience wrapper that auto-selects between Docker and Apple `container`.
#
# Selection order (same as build.sh):
#   1. Honor RUNNER env var if set:    RUNNER=docker | apple
#   2. Else prefer 'docker' if its daemon is reachable.
#   3. Else fall back to 'container' if it is installed.
#   4. Else fail with a helpful message.
#
# All other env vars and positional args pass through to the underlying script
# (see scripts/run-docker.sh or scripts/run-apple-container.sh).
#
# Usage:
#   ./scripts/run.sh                  # auto-detect, foreground, :dev
#   ./scripts/run.sh v1.2.0           # auto-detect, foreground, :v1.2.0
#   DETACH=1 ./scripts/run.sh         # auto-detect, background
#   RUNNER=apple ./scripts/run.sh     # force Apple container

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
    echo "Install Docker Desktop or Apple container, or set RUNNER explicitly." >&2
    exit 127
  }
fi

case "${RUNNER}" in
  docker) exec ./scripts/run-docker.sh "$@" ;;
  apple)  exec ./scripts/run-apple-container.sh "$@" ;;
  *)
    echo "ERROR: unknown RUNNER='${RUNNER}'. Expected 'docker' or 'apple'." >&2
    exit 2
    ;;
esac
