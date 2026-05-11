# agent-host-cc Chat UI

A minimal, single-user, **localhost-only** browser chat UI for testing the
three OpenAI-compatible backends supported by the project:

1. `agent-host-cc` — a local or remote instance of this very service.
2. `openai` — the official OpenAI public API.
3. `azure-openai` — Azure AI Foundry / Azure OpenAI deployments (key-based auth).

The UI is a self-contained sub-application. It does **not** modify the host
service's `package.json` and does **not** import from `../src/`.

> **Security note.** This app binds to `127.0.0.1` only and stores API keys
> on disk under your home directory at `~/.agent-host-cc/chat-ui/profiles.json`
> with permissions `0600` (parent dir `0700`). It is a **dev-time tool**; do
> not expose its port to a network.

---

## Install

Requires **Node.js ≥ 22**.

```bash
cd chat-ui
npm install
```

## Run (development, two-port topology)

```bash
npm run dev
```

This starts two processes via `concurrently`:

- **Vite dev server** on `http://127.0.0.1:5173` — serves the SPA with HMR.
- **Fastify API server** on `http://127.0.0.1:5174` — serves `/api/profiles*`
  and `/api/chat`. Vite's dev server proxies `/api/*` to it.

Open `http://127.0.0.1:5173` in your browser.

If `5173` or `5174` is already in use, set `CHAT_UI_PORT` (Fastify) and pass
`--port` to Vite (`npm run dev:ui -- --port 5180`).

## Run (production-like, single-port)

```bash
npm run build
npm run start
```

`npm run build` runs `vite build` (emits `dist/client/`) and `tsc -p
tsconfig.server.json` (emits `dist/server/`). `npm run start` then launches
Fastify alone on `127.0.0.1:CHAT_UI_PORT` (default `5173`); it serves both
the static SPA bundle and the `/api/*` routes from one port.

## Test & typecheck

```bash
npm test           # vitest run
npm run typecheck  # both server + client tsconfigs
```

---

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CHAT_UI_PORT` | optional | `5173` | TCP port Fastify binds to. `0` ⇒ OS-assigned. |
| `CHAT_UI_PROFILES_PATH` | optional | `~/.agent-host-cc/chat-ui/profiles.json` | Override the profiles file path (rarely needed). |
| `CHAT_UI_SERVE_STATIC` | optional | `true` | Set to `false` to skip serving the SPA bundle (dev-API-only mode). |
| `LOG_LEVEL` | optional | `info` | pino log level. |

These are the **only** authorised defaults — every other config field has no
fallback. Missing required fields throw `ConfigurationError` at startup.

---

## Profile JSON shape

Profiles live at `~/.agent-host-cc/chat-ui/profiles.json`. The file is
managed entirely through the UI and the REST API — you should rarely edit it
by hand. The shape is a discriminated union on `backendKind`:

### Common fields (every profile)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | UUID v4 | yes | Server-assigned on create. |
| `name` | string | yes | Unique across all profiles. |
| `backendKind` | `"agent-host-cc"` \| `"openai"` \| `"azure-openai"` | yes | Discriminator. |
| `apiKey` | string | yes | Stored locally only; redacted on the wire. |
| `systemPrompt` | string | optional | Prepended to message history if no system message present. |
| `temperature` | number `[0, 2]` | optional | Sampling temperature. |
| `maxTokens` | int > 0 | optional | Cap on response tokens. |

### `backendKind: "agent-host-cc"`

| Field | Required | Example |
|---|---|---|
| `baseUrl` | yes | `http://localhost:8000` |
| `defaultModel` | yes | `cc.claude-sonnet-4-6` |

> **Model prefix gotcha.** The host service strips `MODEL_PREFIX` (default
> `cc.`) server-side before matching against `MODEL_IDS`. Profiles that
> target the local backend therefore must include the prefix in
> `defaultModel` (e.g. `cc.claude-sonnet-4-6`, not `claude-sonnet-4-6`). The
> profile is forwarded **verbatim** by the chat-ui — no client-side prefix
> munging.

### `backendKind: "openai"`

| Field | Required | Default | Example |
|---|---|---|---|
| `baseUrl` | optional | `https://api.openai.com` | (rarely overridden) |
| `defaultModel` | yes | — | `gpt-4o-mini` |

### `backendKind: "azure-openai"`

| Field | Required | Example |
|---|---|---|
| `endpoint` | yes | `https://my-resource.openai.azure.com` |
| `deployment` | yes | `gpt-4o-mini` (the deployment name, not the model name) |
| `apiVersion` | yes | `2024-10-21` (or `…-preview`) |

> Azure OpenAI is invoked at `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}`
> with header `api-key: {apiKey}`. The `model` field is **omitted** from the
> body (Azure infers it from the deployment).

### Example file

```json
{
  "activeProfileId": "8b3f1e0a-2c5d-4a91-9c0a-7ab3df2f1c1d",
  "profiles": [
    {
      "id": "8b3f1e0a-2c5d-4a91-9c0a-7ab3df2f1c1d",
      "name": "local-agent-host",
      "backendKind": "agent-host-cc",
      "baseUrl": "http://localhost:8000",
      "apiKey": "sk-local-bearer-XXXX",
      "defaultModel": "cc.claude-sonnet-4-6",
      "systemPrompt": "You are concise.",
      "temperature": 0.2
    }
  ]
}
```

---

## Security notes

- **Localhost-only binding.** The Fastify listen host is hardcoded
  `127.0.0.1`; it is *not* an env-overridable setting. Do not patch the
  source to bind `0.0.0.0` without first adding TLS, auth, and CSP — none of
  which are present in v1.
- **API keys are redacted on the wire.** Every `GET /api/profiles*` response
  replaces `apiKey` with the literal string `"<redacted>"`. The only path to
  the raw key from the SPA is `GET /api/profiles/:id?reveal=true`, which is
  gated to localhost IPs.
- **`PUT /api/profiles/:id` with `apiKey === "<redacted>"` (or `""`)** keeps
  the existing on-disk key. This lets the SPA round-trip a profile it
  fetched without re-prompting for the secret.
- **Profile file modes.** `~/.agent-host-cc/chat-ui/` is created at `0700`,
  `profiles.json` at `0600`. Atomic tmp+rename writes preserve perms.
- **No secrets in logs.** The pino logger redacts `Authorization` and
  `api-key` headers. The chat relay does not log request bodies.

---

## REST API surface

All routes under `/api`. Non-2xx responses use the envelope
`{ "error": { "type": string, "message": string, ...extras } }`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/profiles` | List all profiles + active id (apiKeys redacted). |
| `POST` | `/api/profiles` | Create a new profile (server assigns id). |
| `GET` | `/api/profiles/:id` | Get one profile (apiKey redacted). |
| `GET` | `/api/profiles/:id?reveal=true` | Localhost-only: get one profile with the real apiKey. |
| `PUT` | `/api/profiles/:id` | Update a profile. `apiKey === "<redacted>"` or `""` keeps the existing key. |
| `DELETE` | `/api/profiles/:id` | Delete a profile. 409 if it's the only one and is active. |
| `POST` | `/api/profiles/:id/activate` | Set the active profile. |
| `POST` | `/api/chat` | Stream a chat completion via the active profile (SSE). |

See `docs/design/project-design.md` §14.6 for the complete contract.

---

## Containerization

A multi-stage `Dockerfile` and `.dockerignore` live next to this README so the chat-ui can be built and run as a standalone container. Helper scripts at the repo root drive the build and run, and `docker-compose.yml` mirrors the run script declaratively.

**Prerequisites.** Docker 23+ with BuildKit enabled (the build uses `--mount=type=cache,target=/root/.npm`). On Linux, `--network host` support is required for the smoke test (see the binding caveat below).

**Build, run, smoke-test:**

```bash
# from the repo root
./scripts/docker-build-ui.sh                  # builds agent-host-cc-ui:latest (+ :<short-sha>)
USE_HOST_NETWORK=1 ./scripts/docker-run-ui.sh &   # Linux: the only mode that's reachable from the host
sleep 3
curl -fsS http://127.0.0.1:5174/healthz       # → {"ok":true}
```

Or with compose:

```bash
docker compose up --build chat-ui
```

**Env / port overrides:**

| Variable | Script(s) | Default | Purpose |
|---|---|---|---|
| `IMAGE_NAME` | build, run | `agent-host-cc-ui` | Image repository name. |
| `TAG` | build, run | `latest` | Image tag. |
| `HOST_PORT` | run, compose | `5174` | Host-side port. |
| `CONTAINER_PORT` | run | `5174` | Container-side port. Also set as `CHAT_UI_PORT` inside the container. |
| `CHAT_UI_PORT` | compose | `5174` | Container-side port for compose. |
| `ENV_FILE` | run | _(none)_ | Path to a `--env-file` for additional env injection. |
| `USE_HOST_NETWORK` | run | _(unset)_ | When truthy, swap port-mapping for `--network host` (Linux). |
| `EXTRA_ARGS` / `BUILD_ARGS` | run / build | _(none)_ | Verbatim pass-through to `docker run` / `docker build`. |

**Image base & expected size.** Multi-stage build on `node:22-bookworm-slim`. The runtime stage carries only production `node_modules`, the compiled `dist/`, and `package.json`. Expected final size is ~150–250 MB.

**Bind-address caveat (read before smoke-testing).** The Fastify server binds to `127.0.0.1` inside the container by design — `server/config.ts` hardcodes the host because this is a dev-time tool that stores plaintext API keys on disk. A bridged `docker run -p HOST:CONTAINER ...` mapping therefore cannot reach it. The reachable modes are:

- **Linux:** `USE_HOST_NETWORK=1 ./scripts/docker-run-ui.sh` (uses `--network host`), or uncomment `network_mode: host` in `docker-compose.yml`.
- **Docker Desktop (macOS/Windows):** `--network host` does not bridge to the host loopback the same way, so the container is not reachable through any built-in flag. The pragmatic options are (a) run chat-ui directly via `npm run start` on the host instead, or (b) add an in-container TCP forwarder (e.g. `socat TCP-LISTEN:5174,fork,reuseaddr TCP:127.0.0.1:5174`) and bind to it — neither is wired into these scripts.

The Fastify `HEALTHCHECK` baked into the image polls `/healthz` every 30 s using Node's built-in `fetch`.

---

## Cross-references

- Plan: `docs/design/plan-004-chat-ui.md`
- Design: `docs/design/project-design.md` §14
- Refined request: `docs/design/refined-request-chat-ui.md`
- Investigation: `docs/design/investigation-chat-ui.md`
