# How To — Deploy `agent-host-cc` Locally

> **Audience:** Operators standing up `agent-host-cc` on a developer workstation or single host.
> **Outcome:** A running container (Docker or Apple `container`) listening on `http://localhost:8000`, exposing `GET /healthz`, `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses`, and `GET /files/:chatId/*path`.
> **Companion documents:**
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/configuration-guide.md` (every config variable)
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/how-to/connect-openai-client.md` (client wiring)
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/.env.example` (environment template)

---

## Prerequisites

- **Node.js 22 or newer** for the build step (`node --version` should report `v22.x` or higher).
- **One of:**
  - **Docker Desktop** ≥ 4.30 (any recent build with BuildKit enabled), OR
  - **Apple `container` v0.12+** on macOS (`container --version` reports `0.12.0` or higher).
- **An Anthropic API key** (default path) OR an Azure AI Foundry deployment of Claude (opt-in path).
- A reachable upstream **Files API** (e.g. an Open WebUI deployment exposing `/api/v1/files/<id>/content`). If you do not need `files[]` attachment resolution, you may still satisfy the required-variable check by pointing `FILES_API_BASE_URL` at any reachable HTTP endpoint and supplying any non-empty `FILES_API_KEY`; failed fetches are logged and swallowed per request.

---

## Step 1 — Clone and build

```bash
cd /Users/giorgosmarinos/aiwork/agent-host-cc/
npm install
npm run build
```

Verify the TypeScript build emitted `dist/index.js`:

```bash
test -f dist/index.js && echo "build OK" || echo "build failed"
```

`npm run build` is a one-time prerequisite for the Docker build's `COPY --from=build /app/dist ./dist` stage.

---

## Step 2 — Configure environment

```bash
cp .env.example .env
```

Open `.env` and populate at minimum the **required** variables. The two mandatory ones are:

```bash
# 1. Bearer token clients must present in `Authorization: Bearer ...`.
#    Generate a strong token:
openssl rand -hex 32
# Paste the output as the value of AGENT_HOST_API_KEY in .env.

# 2. Models you intend to expose. Use whatever names your provider deployment supports.
#    Example for Anthropic public:
echo 'MODEL_IDS=claude-sonnet-4-6,claude-haiku-4-5,claude-opus-4-7' >> .env
```

For the **default Anthropic public path**, also set:

```
ANTHROPIC_API_KEY=sk-ant-api03-…
```

For the **Files API backend** (always required):

```
FILES_API_BASE_URL=http://host.docker.internal:3080
FILES_API_KEY=<paste-token-here>
# FILES_API_PATH_TEMPLATE defaults to /api/v1/files/{id}/content
```

`host.docker.internal` works on Docker Desktop for macOS / Windows. On Linux, use the host gateway address (`172.17.0.1` for the default bridge) or the Docker network's gateway. On Apple `container`, use `192.168.64.1` (the default container-host bridge) or the explicit host IP.

**Set permissions** on the `.env` file because it now contains secrets:

```bash
chmod 600 .env
```

See `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/configuration-guide.md` for the full variable reference and the validation matrix.

---

## Step 3 — Build the image

### Docker

```bash
docker build -t agent-host-cc:dev .
```

### Apple `container`

```bash
container build -t agent-host-cc:dev .
```

Both invocations consume the same `Dockerfile` at the project root. The build runs as a multi-stage `node:22-alpine` build, producing a non-root image with `agent` (uid 1000) owning `/workspace`.

Verify the image:

```bash
# Docker
docker images agent-host-cc:dev

# Apple container
container images list | grep agent-host-cc
```

---

## Step 4 — Run the container

The service expects a writable mount target at `/workspace` (the per-chat workspace root) and reads its configuration from the host environment.

### Docker

```bash
docker run --rm \
  --name agent-host-cc \
  --env-file .env \
  -p 8000:8000 \
  -v agent-host-cc-workspace:/workspace \
  agent-host-cc:dev
```

The named volume `agent-host-cc-workspace` persists the per-chat directories across container restarts. To use a host-path bind mount instead, replace `-v agent-host-cc-workspace:/workspace` with `-v "$PWD/workspace":/workspace` and ensure the host directory is owned by uid 1000 (`sudo chown -R 1000:1000 ./workspace`).

### Apple `container`

```bash
container run --rm \
  --name agent-host-cc \
  --env-file .env \
  --publish 8000:8000 \
  --volume agent-host-cc-workspace:/workspace \
  agent-host-cc:dev
```

Both runtimes pass the `.env` file's contents into the container's `process.env` at startup; the service itself does not read `.env` from disk.

To run in the background, add `-d` (Docker) or `--detach` (Apple `container`).

---

## Step 5 — Smoke-test the running service

In a second terminal, set a shell variable to your bearer token and hit the endpoints:

```bash
export TOKEN="$(grep '^AGENT_HOST_API_KEY=' .env | cut -d= -f2-)"

# Health probe — no auth required.
curl -s http://localhost:8000/healthz
# Expected: {"ok":true}

# Models endpoint — bearer-auth required.
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/v1/models | jq .
# Expected: {"object":"list","data":[{"id":"claude-sonnet-4-6","object":"model",...},...]}

# 401 check — no Authorization header.
curl -i -s http://localhost:8000/v1/models | head -1
# Expected: HTTP/1.1 401 Unauthorized
```

A streaming chat completion smoke test:

```bash
curl -N -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/v1/chat/completions \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Say hello in one word."}],
    "stream": true
  }'
# Expected: SSE frames ending with `data: [DONE]\n\n`.
```

A streaming responses-API smoke test:

```bash
curl -N -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/v1/responses \
  -d '{
    "model": "claude-sonnet-4-6",
    "input": "Say hello in one word.",
    "stream": true
  }'
# Expected: events response.created, response.in_progress, response.output_text.delta x N,
# response.completed, then `data: [DONE]\n\n`.
```

---

## Step 6 — Optional: Foundry mode

If you want the Claude Agent SDK to route via Azure AI Foundry instead of `api.anthropic.com`, add to `.env`:

```
CLAUDE_CODE_USE_FOUNDRY=1
ANTHROPIC_FOUNDRY_API_KEY=<paste-foundry-key>
ANTHROPIC_FOUNDRY_RESOURCE=biksaiservice-east-us-2
# ANTHROPIC_API_KEY may be left set; it is ignored when CLAUDE_CODE_USE_FOUNDRY=1.
```

Restart the container. The startup log line reports the resolved provider kind so you can confirm:

```
INFO  provider resolved kind=anthropic-foundry resource=biksaiservice-east-us-2
```

If the trio is partial — for example, `CLAUDE_CODE_USE_FOUNDRY=1` is set but `ANTHROPIC_FOUNDRY_RESOURCE` is missing — the service exits with code 78 and a `ConfigurationError` log line naming the missing variable. There is no silent fallback.

---

## Step 7 — Optional: pushing to a container registry

The v1 distribution model is **local-only**: the project ships a `Dockerfile` and a runbook, not a CI/CD pipeline (CONFIRMED-4). Pushing to a registry is an operator-side concern. Examples follow.

### Docker Hub

```bash
docker tag agent-host-cc:dev <dockerhub-user>/agent-host-cc:0.1.0
docker login
docker push <dockerhub-user>/agent-host-cc:0.1.0
```

### GitHub Container Registry (GHCR)

```bash
docker tag agent-host-cc:dev ghcr.io/<github-user-or-org>/agent-host-cc:0.1.0
echo "$GITHUB_PAT" | docker login ghcr.io -u <github-user> --password-stdin
docker push ghcr.io/<github-user-or-org>/agent-host-cc:0.1.0
```

### Azure Container Registry (ACR)

```bash
az login
az acr login --name <acr-name>
docker tag agent-host-cc:dev <acr-name>.azurecr.io/agent-host-cc:0.1.0
docker push <acr-name>.azurecr.io/agent-host-cc:0.1.0
```

The tag scheme is operator choice; the `:dev` tag is reserved for local builds in this project's documentation.

---

## Troubleshooting

### `ConfigurationError` on startup with exit code 78

The service exits with POSIX `EX_CONFIG` (78) when a required variable is missing, when a Foundry partial configuration is detected, or when `RESPONSES_TOOL_USE_RENDERING=item` is set. The single startup log line names the offending variable. Fix the value in `.env` and re-run.

Container orchestrators interpret exit code 78 as "do not restart" — a configuration problem won't fix itself by retrying.

### Port 8000 already in use

```
Error: listen EADDRINUSE: address already in use 0.0.0.0:8000
```

Either stop the process holding port 8000 (`lsof -nP -iTCP:8000 | grep LISTEN`) or choose a different host port:

```bash
docker run --rm --env-file .env -p 18000:8000 agent-host-cc:dev
# Now reachable at http://localhost:18000
```

### Bundled `claude` executable not found on Alpine

Symptom: chat completion requests fail with `agent_error` and a log line referencing `pathToClaudeCodeExecutable` or "ENOENT" against `node_modules/@anthropic-ai/claude-cli-*`.

The runner explicitly resolves the bundled native binary from the SDK's platform package (musl variant first, glibc second). If both lookups fail, the SDK falls back to its own auto-detection, which can fail on Apple `container`'s virtiofs path resolution.

Workaround: rebuild the image (sometimes a partial `npm install` leaves the platform package missing) and confirm the SDK's musl variant is installed:

```bash
docker run --rm agent-host-cc:dev ls node_modules/@anthropic-ai
# Expected: claude-agent-sdk plus a platform-specific package such as
# claude-cli-linux-musl-arm64 or claude-cli-linux-musl-x64.
```

If the platform package is missing, ensure the host's `npm install` ran on the same architecture as the container (or rebuild on the target architecture).

### Workspace permission denied

Symptom: `EACCES: permission denied, mkdir '/workspace/<chatId>'`.

The Dockerfile creates `/workspace` owned by `agent` (uid 1000). If you bind-mount a host directory that is not chowned to uid 1000, the non-root container user cannot write to it. Fix with:

```bash
sudo chown -R 1000:1000 ./workspace
```

…or use a named volume (Docker manages permissions automatically).

### Body too large (HTTP 413 `payload_too_large`)

The default `BODY_LIMIT_BYTES` is 64 MB. A base64-encoded image inflates the binary size by ~37%, so a raw 50 MB image becomes a ~68 MB request body and trips the limit. Either resize the image client-side or raise `BODY_LIMIT_BYTES` (and consider raising `MAX_INLINE_IMAGE_BYTES` and `WORKSPACE_MAX_BYTES_PER_CHAT` in tandem).

### `unsafe_url` on remote-URL fetches

The SSRF guard rejects non-`http(s)` schemes and any hostname resolving to private/loopback/link-local/ULA ranges. To attach a file from a local file server, expose it on a routable address or fetch the bytes client-side and inline them as a `data:` URL.
