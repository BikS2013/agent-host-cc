#!/usr/bin/env bash
# Convenience wrapper that auto-selects between Docker and Apple `container`.
#
# Selection order:
#   1. Honor BUILDER env var if set:   BUILDER=docker | apple
#   2. Else prefer 'docker' if its daemon is reachable.
#   3. Else fall back to 'container' if it is installed.
#   4. Else fail with a helpful message.
#
# Usage: same as build-docker.sh / build-apple-container.sh.
#   ./scripts/build.sh                  # auto-detect, tag :dev
#   ./scripts/build.sh v1.2.0           # auto-detect, tag :v1.2.0
#   BUILDER=apple ./scripts/build.sh    # force Apple container

set -euo pipefail

cd "$(dirname "$0")/.."

BUILDER="${BUILDER:-}"

pick_builder() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "docker"; return 0
  fi
  if command -v container >/dev/null 2>&1; then
    echo "apple"; return 0
  fi
  return 1
}

if [[ -z "${BUILDER}" ]]; then
  BUILDER="$(pick_builder)" || {
    echo "ERROR: neither docker (running) nor 'container' CLI is available." >&2
    echo "Install Docker Desktop or Apple container, or set BUILDER explicitly." >&2
    exit 127
  }
fi

case "${BUILDER}" in
  docker) exec ./scripts/build-docker.sh "$@" ;;
  apple)  exec ./scripts/build-apple-container.sh "$@" ;;
  *)
    echo "ERROR: unknown BUILDER='${BUILDER}'. Expected 'docker' or 'apple'." >&2
    exit 2
    ;;
esac
