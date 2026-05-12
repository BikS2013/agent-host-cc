#!/usr/bin/env bash
# Run the chat-ui Docker image.
#
# Usage:
#   ./scripts/docker-run-ui.sh
#   HOST_PORT=8080 CONTAINER_PORT=5174 ./scripts/docker-run-ui.sh
#   ENV_FILE=./.env.chat-ui ./scripts/docker-run-ui.sh
#   USE_HOST_NETWORK=1 ./scripts/docker-run-ui.sh   # Linux: --network host
#
# Env overrides:
#   IMAGE_NAME         default "agent-host-cc-ui"
#   TAG                default "latest"
#   HOST_PORT          host-side port (default 5174)
#   CONTAINER_PORT     container-side port (default 5174)
#   ENV_FILE           optional --env-file path
#   USE_HOST_NETWORK   when set to a truthy value, swap port-mapping for
#                      `--network host` (the only mode in which the
#                      127.0.0.1-bound Fastify server is reachable from the
#                      host without source modification — Linux only)
#   CONTAINER_NAME     default "agent-host-cc-ui"
#   EXTRA_ARGS         extra args appended verbatim to `docker run`

set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-agent-host-cc-ui}"
TAG="${TAG:-latest}"
IMAGE_REF="${IMAGE_NAME}:${TAG}"

HOST_PORT="${HOST_PORT:-5174}"
CONTAINER_PORT="${CONTAINER_PORT:-5174}"
CONTAINER_NAME="${CONTAINER_NAME:-agent-host-cc-ui}"

if ! docker image inspect "${IMAGE_REF}" >/dev/null 2>&1; then
  echo "[docker-run-ui] error: image ${IMAGE_REF} not found." >&2
  echo "[docker-run-ui] hint: run ./scripts/docker-build-ui.sh first." >&2
  exit 1
fi

NETWORK_ARGS=()
if [[ -n "${USE_HOST_NETWORK:-}" && "${USE_HOST_NETWORK}" != "0" && "${USE_HOST_NETWORK}" != "false" ]]; then
  echo "[docker-run-ui] using --network host (HOST_PORT/CONTAINER_PORT ignored)"
  NETWORK_ARGS=(--network host)
else
  NETWORK_ARGS=(-p "${HOST_PORT}:${CONTAINER_PORT}")
fi

ENV_ARGS=()
if [[ -n "${ENV_FILE:-}" ]]; then
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "[docker-run-ui] error: ENV_FILE=${ENV_FILE} does not exist" >&2
    exit 1
  fi
  ENV_ARGS=(--env-file "${ENV_FILE}")
fi

# Always pass CHAT_UI_PORT so the server inside the container listens on the
# port the host operator chose. The Dockerfile sets a default of 5174 which
# this overrides when CONTAINER_PORT differs.
ENV_ARGS+=(-e "CHAT_UI_PORT=${CONTAINER_PORT}")

echo "[docker-run-ui] running ${IMAGE_REF}"
echo "  name:           ${CONTAINER_NAME}"
echo "  host port:      ${HOST_PORT}"
echo "  container port: ${CONTAINER_PORT}"
if [[ -n "${ENV_FILE:-}" ]]; then
  echo "  env file:       ${ENV_FILE}"
fi

# `--rm -it` for an interactive smoke run; the script exits when the
# container exits (Ctrl-C is forwarded as SIGINT, which Fastify handles).
# shellcheck disable=SC2086  # intentional word-splitting on EXTRA_ARGS
exec docker run --rm -it \
  --name "${CONTAINER_NAME}" \
  "${NETWORK_ARGS[@]}" \
  "${ENV_ARGS[@]}" \
  ${EXTRA_ARGS:-} \
  "${IMAGE_REF}"
