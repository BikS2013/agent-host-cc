# agent-host-cc

OpenAI-compatible HTTP host for the Anthropic Claude Code agent, packaged as a single OCI container. Exposes `POST /v1/chat/completions` and `POST /v1/responses` (streaming and non-streaming), plus `GET /v1/models`, `GET /healthz`, `GET /files/:chatId/*path`, and `GET /skills` (debug). Drop it behind any OpenAI-SDK-compatible client — Open WebUI, the official `openai` Node/Python SDKs, custom UIs, evaluation harnesses — without coupling your deployment to Azure AI Foundry or to any upstream UI container. Supports the Anthropic public API by default; Azure AI Foundry is opt-in via a single environment variable.

A bundled Preact chat UI lives under `chat-ui/` for hands-on testing of the API surface.

## Quick start (container)

```bash
# 1. Configure environment.
cp .env.example .env && chmod 600 .env
#    Edit .env: AGENT_HOST_API_KEY (use `openssl rand -hex 32`),
#    ANTHROPIC_API_KEY (or Foundry vars), MODEL_IDS, optional FILES_API_*.

# 2. Run. The run script auto-builds the image on first use, reclaims the
#    container name from any stale leftover, and bind-mounts ~/.claude.
./scripts/run-apple-container.sh        # Apple `container`
./scripts/run-docker.sh                 # Docker
./scripts/run.sh                        # auto-detect

# 3. Smoke-test.
curl -s http://localhost:8091/healthz   # → {"ok":true}
```

Defaults: container listens on host port **8091** (forwarded to container :8000). Container name **`agent-host-cc`**. Workspace named volume **`agent-host-cc-workspace`** mounted at `/workspace`. Host `~/.claude` is bind-mounted at `/home/node/.claude` with absolute-path symlink targets auto-discovered and re-mounted.

Override at the call site with env vars — see the header comment in each script for the full matrix (`HOST_PORT`, `CONTAINER_NAME`, `VOLUME_NAME`, `CLAUDE_DIR`, `CLAUDE_MODE`, `REBUILD`, `NO_BUILD`, `DETACH`, `EXTRA_ARGS`, `ENV_FILE`).

## Quick start (local API, no container)

```bash
npm install
./scripts/run-dev.sh
```

The launcher sources `.env` into the child process (so the no-fallback config check passes), applies dev-time defaults (`WORKSPACE_DIR=$PWD/.local-workspace`, `LISTEN_PORT=8092` to avoid clashing with the container on 8091), and runs `npm run dev` (`tsx watch`). On startup the server prints a banner with the bound URL, the resolved provider, the model list, and every env var it reads — secrets are masked except `AGENT_HOST_API_KEY` which is revealed so you can copy it to authenticate the first request.

```bash
curl -s http://localhost:8092/healthz
KEY=$(grep -E '^AGENT_HOST_API_KEY=' .env | head -1 | cut -d= -f2-)
curl -s -H "Authorization: Bearer $KEY" http://localhost:8092/skills | jq '.skillCount'
```

## Quick start (chat UI)

```bash
./scripts/run-dev-ui.sh
```

Boots Vite (SPA, `:5173`) and the Fastify profile/relay backend (`:5174`) concurrently. The launcher prints the URL to open (`http://localhost:5173`), sanity-checks `chat-ui/node_modules`, sources an optional `chat-ui/.env`, and reminds the operator that connection info to the agent-host lives per-profile in `~/.agent-host-cc/chat-ui/profiles.json` (the chat-ui carries **no** API key in env by design).

## The `/skills` debug endpoint

`GET /skills` (Bearer-auth, same key as `/v1/*`) walks the running container's filesystem under `os.homedir()/.claude` and reports what the Claude Agent SDK would discover: skills, agents, commands, plugins, the existence of `settings.json`, the active `settingSources` value, and any warnings. Useful for verifying that the `~/.claude` bind-mount is working end-to-end before you debug "agent can't see my skills" through the chat surface.

```bash
curl -s -H "Authorization: Bearer $KEY" http://localhost:8091/skills | jq '{
  exists,
  settingSources,
  skillCount: (.skills | length),
  bySource: (.skills | group_by(.source) | map({(.[0].source): length}) | add),
  warnings
}'
```

## Scripts

| Script | What it does |
|---|---|
| `scripts/run-dev.sh` | Run the API locally — sources `.env`, sets dev defaults, `tsx watch`. |
| `scripts/run-dev-ui.sh` | Run the chat UI locally — Vite + Fastify via `concurrently`, prints the URL to follow. |
| `scripts/run.sh` | Container run — auto-detects Docker vs Apple `container`. |
| `scripts/run-docker.sh` | Container run via Docker. Auto-builds, reclaims name, mounts `~/.claude` (+ symlink targets). |
| `scripts/run-apple-container.sh` | Same as above, via Apple's `container` CLI. |
| `scripts/build.sh` / `build-docker.sh` / `build-apple-container.sh` | Build the OCI image. |
| `scripts/stop.sh` / `stop-docker.sh` / `stop-apple-container.sh` | Stop a running container (graceful or `FORCE=1`). |
| `scripts/delete-docker.sh` / `scripts/delete-apple-container.sh` | Full teardown — stop + remove containers, optionally `WITH_VOLUME=1` / `WITH_IMAGE=1`. |
| `scripts/docker-entrypoint.sh` | In-image entrypoint — re-chowns `/workspace` then drops to uid 1000 via `su-exec`. |

## Common operator tasks

```bash
# Rebuild after a source change and roll the container in one go
REBUILD=1 ./scripts/run-apple-container.sh

# Run in background
DETACH=1 ./scripts/run-apple-container.sh

# Mount a different ~/.claude (e.g. a sandboxed copy)
CLAUDE_DIR=/tmp/sandbox-claude ./scripts/run-apple-container.sh

# Skip the ~/.claude mount entirely
CLAUDE_DIR= ./scripts/run-apple-container.sh

# Read-only ~/.claude mount
CLAUDE_MODE=ro ./scripts/run-apple-container.sh

# Different host port
HOST_PORT=9000 ./scripts/run-apple-container.sh

# Full teardown including the workspace volume
WITH_VOLUME=1 ./scripts/delete-apple-container.sh
```

## Documentation

- **Architecture, components, request flow** — `docs/design/project-design.md`.
- **Deploy locally (Docker + Apple container, troubleshooting)** — `docs/how-to/deploy-locally.md`.
- **Connect a client (Open WebUI, OpenAI SDKs, curl)** — `docs/how-to/connect-openai-client.md`.
- **Configuration variables (every knob, defaults, validation matrix)** — `docs/design/configuration-guide.md`.
- **Functional and non-functional requirements** — `docs/design/project-functions.md`.
- **Chat UI sub-app README** — `chat-ui/README.md`.

## Trust note for the `~/.claude` mount

When `CLAUDE_DIR` is set (the default), the in-container agent reads your host `~/.claude/settings.json`, `plugins/`, `skills/`, `agents/`, and `commands/` — that means it inherits all your hooks, MCP server definitions, and enabled plugins. Combined with the in-runner `permissionMode: "bypassPermissions"` (`src/claudeCodeRunner.ts`), the container should be treated as fully trusted with your host Claude configuration. Do not expose port 8091 beyond `localhost` without further hardening (network ACL, separate API key rotation, hook audit). The `/skills` endpoint is intentionally bearer-protected for the same reason — it leaks the contents and layout of your `~/.claude`.

## License

Proprietary (placeholder — replace with your chosen license before distributing).
