# Configuration Guide — `agent-host-cc`

> **Status:** Authoritative configuration reference for operators of the `agent-host-cc` service.
> **Companion documents:**
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/project-design.md` (architecture and runtime semantics)
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/project-functions.md` (functional and non-functional requirements)
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/how-to/deploy-locally.md` (build + run runbook)
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/how-to/connect-openai-client.md` (client wiring)
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/.env.example` (the canonical template)

This document enumerates every configuration variable the service reads, where it MUST be set, what each value means, and how missing or expired values behave at startup.

---

## 1. Configuration sources and priority

The service reads configuration from a single authoritative source: **the process environment** (`process.env`) at startup. There is no built-in `.env` loader, no config file, and no CLI flags. Operators populate `process.env` from one of the following sources, listed from highest priority (first-applied) to lowest:

| Priority | Source | Applied by | Notes |
|---|---|---|---|
| 1 (highest) | Direct shell exports (`export KEY=…` before `docker run`) | The operator's shell | Values forwarded to the container via `-e KEY` flags or inherited by orchestrators. |
| 2 | `--env KEY=VALUE` on `docker run` / `container run` | The runtime CLI | Overrides any `--env-file` value with the same key. |
| 3 | `--env-file /path/to/.env` on `docker run` / `container run` | The runtime CLI | Loaded by Docker / Apple `container`, **NOT** by the service. |
| 4 (lowest) | (none) | — | **No code-level fallback for required variables.** Missing required → `ConfigurationError` + `process.exit(78)`. |

> **Project rule (NF-3) — no silent fallbacks for required variables.** Two intentional exceptions exist (`WORKSPACE_DIR=/workspace` default and the deterministic `chatId` derivation when `metadata.chat_id` is absent). Both are recorded in this project's `CLAUDE.md` "Configuration Fallback Exceptions" section. No other defaults are tolerated.

The service **never** reads a `.env` file from disk. If you want `.env` semantics, point the runtime at the file with `--env-file`, which causes Docker / Apple `container` to populate `process.env` for the spawned process before the Node entrypoint runs.

---

## 2. Required-always variables

The two variables in this section MUST be set for any deployment, regardless of which provider, files-API backend, or topology you choose. Missing either one raises `ConfigurationError` and exits the process with code 78.

### 2.1 `AGENT_HOST_API_KEY`

- **Purpose.** Bearer token that every OpenAI-compatible client MUST present in `Authorization: Bearer <token>`. Required on every endpoint except `GET /healthz` (F-5).
- **How to obtain.** Generate locally with a strong RNG: `openssl rand -hex 32` produces a 64-character hex token suitable for production.
- **Recommended storage.** Treat as a secret: store in an `.env` file referenced via `--env-file` (file mode `0600`), in a secret manager, or in Docker / Apple `container` runtime secrets. Never commit to git.
- **Options.** Any non-empty string. Hex / base64 / opaque alphanumeric all accepted; clients copy the value verbatim into the Authorization header.
- **Default.** None (required).
- **Expiry pairing.** `AGENT_HOST_API_KEY_EXPIRES_AT` (optional, see §10).

### 2.2 `MODEL_IDS`

- **Purpose.** Comma-separated list of model identifiers the service exposes via `GET /v1/models` and accepts on `POST /v1/chat/completions` and `POST /v1/responses` after the `MODEL_PREFIX` is stripped (F-2, F-6).
- **How to obtain.** Use whichever model names your provider deployment exposes. For Anthropic public, the canonical names are the SDK-supported model strings (e.g. `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-opus-4-7`). For Foundry, use the deployment names you configured in your Azure AI Foundry resource.
- **Recommended storage.** Container env (`-e`). Not secret.
- **Options.** A comma-separated list, e.g. `claude-sonnet-4-6,claude-haiku-4-5,claude-opus-4-7`. Whitespace around commas is trimmed. Empty list → `ConfigurationError`.
- **Default.** None (required).

---

## 3. Provider — Anthropic public (default path)

Selected when `CLAUDE_CODE_USE_FOUNDRY` is **not** set to `"1"`. The Claude Agent SDK forwards requests to `https://api.anthropic.com`.

### 3.1 `ANTHROPIC_API_KEY`

- **Purpose.** API key forwarded to the Claude Agent SDK; ultimately reaches `api.anthropic.com` (F-13).
- **How to obtain.** Anthropic Console → Settings → API Keys → Create. Begins with `sk-ant-…`.
- **Recommended storage.** Secret. Use `--env-file` referencing a `0600` file, a secret manager, or runtime secret mounts. Never commit.
- **Options.** Any string Anthropic accepts as a key.
- **Default.** None — required when `CLAUDE_CODE_USE_FOUNDRY != "1"`. If `CLAUDE_CODE_USE_FOUNDRY="1"`, this variable is ignored.
- **Expiry pairing.** `ANTHROPIC_API_KEY_EXPIRES_AT` (see §10).

### 3.2 `ANTHROPIC_API_KEY_EXPIRES_AT`

- **Purpose.** Optional ISO-8601 date marking when the operator intends to rotate `ANTHROPIC_API_KEY` (F-17).
- **How to obtain.** Operator-chosen. Anthropic API keys do not auto-expire, but you can set a reminder date here.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any ISO-8601 date or datetime, e.g. `2026-12-31` or `2026-12-31T23:59:59Z`.
- **Default.** None (optional). When unset, no expiry tracking is performed.
- **Behavior.** At startup: WARN if within 30 days, ERROR if in the past, INFO otherwise. Service starts in either case.

---

## 4. Provider — Azure AI Foundry (opt-in)

Selected when `CLAUDE_CODE_USE_FOUNDRY="1"`. All three variables in this group MUST resolve together. Partial Foundry configuration → `ConfigurationError` + exit 78.

### 4.1 `CLAUDE_CODE_USE_FOUNDRY`

- **Purpose.** Provider switch. When `"1"`, the runner injects Foundry credentials; otherwise the runner uses the public-API path (F-13).
- **How to obtain.** Operator-set.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** `"1"` to opt into Foundry; any other value (or unset) keeps the public path.
- **Default.** Unset (treated as public path).

### 4.2 `ANTHROPIC_FOUNDRY_API_KEY`

- **Purpose.** API key for the Azure AI Foundry deployment of Anthropic Claude (F-13).
- **How to obtain.** Azure Portal → AI Foundry resource → Keys.
- **Recommended storage.** Secret. Use `--env-file` referencing a `0600` file, Azure Key Vault references, or runtime secret mounts.
- **Options.** Any string the Foundry endpoint accepts.
- **Default.** None — required when `CLAUDE_CODE_USE_FOUNDRY="1"`.
- **Expiry pairing.** `ANTHROPIC_FOUNDRY_API_KEY_EXPIRES_AT` (see §10).

### 4.3 `ANTHROPIC_FOUNDRY_RESOURCE`

- **Purpose.** Azure AI Foundry resource name. The SDK builds the endpoint URL from this value (F-13).
- **How to obtain.** Azure Portal → AI Foundry → resource overview.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Resource name string, e.g. `biksaiservice-east-us-2`.
- **Default.** None — required when `CLAUDE_CODE_USE_FOUNDRY="1"`.

### 4.4 `ANTHROPIC_FOUNDRY_API_KEY_EXPIRES_AT`

- **Purpose.** Optional ISO-8601 expiry / rotation reminder for `ANTHROPIC_FOUNDRY_API_KEY` (F-17).
- **Same shape as §3.2.** WARN within 30 days, ERROR in the past, service starts regardless.

---

## 5. Files API backend

These variables configure the upstream HTTP backend used to resolve `files[]` entries on requests. The backend is generic — any service that exposes a "fetch by id" endpoint works (F-8).

> **Optional feature.** The Files API is **opt-in**. If you only call `/v1/chat/completions` and `/v1/responses` with text and `image_url` data URLs (no `files[]` extension), you can leave both `FILES_API_BASE_URL` and `FILES_API_KEY` unset — the service starts cleanly, logs `files API disabled: …` at startup, and silently drops any `files[]` entries that arrive (consistent with the swallow-on-fetch-failure semantics applied to every other attachment fetch in the processor). Configuration is **partial-rejected**: setting only one of the two is a `ConfigurationError` at startup.

### 5.1 `FILES_API_BASE_URL`

- **Purpose.** Base URL of the upstream files-API backend (F-8).
- **How to obtain.** From the operator of the upstream files service. Common case is an Open WebUI deployment reachable from the container network.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** A `http(s)://` URL with no trailing slash, e.g. `http://192.168.65.1:3080` (host gateway from a Docker container) or `https://files.example.com`.
- **Default.** None — but **optional**. Unset to disable `files[]` handling entirely; required to be set together with `FILES_API_KEY` to enable it.

### 5.2 `FILES_API_KEY`

- **Purpose.** Bearer token forwarded to the upstream files-API as `Authorization: Bearer <token>` (F-8).
- **How to obtain.** From the upstream service. For Open WebUI: Profile → Account → API Keys → Generate.
- **Recommended storage.** Secret. Use `--env-file` referencing a `0600` file or a secret manager.
- **Options.** Any string the upstream accepts.
- **Default.** None — but **optional** (paired with `FILES_API_BASE_URL`; see §5 note above).
- **Expiry pairing.** `FILES_API_KEY_EXPIRES_AT` (see §10).

### 5.3 `FILES_API_PATH_TEMPLATE`

- **Purpose.** Path template appended to `FILES_API_BASE_URL` to form the per-file fetch URL. The literal `{id}` is replaced with the URL-encoded file id from the request (F-8).
- **How to obtain.** From the upstream service's API contract.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any path string containing `{id}` exactly once. Examples:
  - `/api/v1/files/{id}/content` (Open WebUI compatible — the **default**).
  - `/files/{id}` (minimalist alternative backend).
  - `/v2/storage/objects/{id}/raw` (custom backend).
- **Default.** `/api/v1/files/{id}/content`.

### 5.4 `FILES_API_KEY_EXPIRES_AT`

- **Purpose.** Optional ISO-8601 expiry / rotation reminder for `FILES_API_KEY` (F-17).
- **Same shape as §3.2.** WARN within 30 days, ERROR in the past, service starts regardless.

---

## 6. HTTP server

### 6.1 `LISTEN_HOST`

- **Purpose.** IP address Fastify binds to.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** `0.0.0.0` (all interfaces — required inside a container so the host port mapping reaches the process), `127.0.0.1` (loopback-only — for local debugging without a container), or a specific interface address.
- **Default.** `0.0.0.0`.

### 6.2 `LISTEN_PORT`

- **Purpose.** TCP port Fastify listens on inside the container.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any unprivileged TCP port (1024–65535). The container's `EXPOSE 8000` is documentation only; what actually matters is what `LISTEN_PORT` resolves to.
- **Default.** `8000`.

### 6.3 `BODY_LIMIT_BYTES`

- **Purpose.** Maximum request body size Fastify accepts before returning a 413 `payload_too_large` envelope (NF-6).
- **Why this exists.** Base64-encoded image data URLs inflate the payload size (~1.37x the binary). The default 64 MB limit lets a ~46 MB raw image survive a single-shot request.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any positive integer (bytes).
- **Default.** `67108864` (64 MB).

---

## 7. Workspace

The agent's working directory and attachment storage live under `WORKSPACE_DIR/<chatId>/`. These variables shape filesystem behavior and per-chat caps.

### 7.1 `WORKSPACE_DIR` *(silent-default exception #1)*

- **Purpose.** Root directory under which every per-chat workspace is created (F-11).
- **Recommended storage.** Container env (`-e`). The Dockerfile's `chown 1000:1000 /workspace` step makes `/workspace` the canonical container target.
- **Options.** Any absolute path. Inside the container the conventional value is `/workspace`. Local-host (non-container) runs SHOULD set this explicitly.
- **Default.** `/workspace` — **silent-default exception #1** (registered in `CLAUDE.md` per NF-3). Rationale: this is the documented mount target and matches the Dockerfile non-root user's owned directory. Container deployments rely on it; non-container runs SHOULD override.

### 7.2 `WORKSPACE_MAX_BYTES_PER_CHAT`

- **Purpose.** Hard cap on the total bytes any single `<chatId>/` directory may hold. Exceeding the cap during attachment processing yields a 413 `payload_too_large` envelope with `limitBytes` and `currentBytes` populated (F-11, AC-11).
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any positive integer (bytes).
- **Default.** `209715200` (200 MB).

### 7.3 `MAX_INLINE_IMAGE_BYTES`

- **Purpose.** Threshold for keeping an `image_url` attachment as an inline Anthropic image block versus disk-only with a manifest entry (F-7).
- **Behavior.** If the decoded image is ≤ this value AND the MIME starts with `image/`, the bytes are forwarded inline to the SDK; otherwise the file is written to the workspace and only the manifest line references it.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any positive integer (bytes).
- **Default.** `20971520` (20 MB).

### 7.4 `MAX_REMOTE_FETCH_BYTES`

- **Purpose.** Per-URL response-size cap when the attachment processor fetches a remote URL or a `files[]` entry. Streams aborted past this size yield `upstream_url_fetch_failed` (or `upstream_files_fetch_failed`) on the offending request (F-9, F-10).
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any positive integer (bytes).
- **Default.** `52428800` (50 MB).

### 7.5 `MAX_URL_FETCHES_PER_TURN`

- **Purpose.** Maximum number of plain-text URLs the in-message URL detector will fetch per request (F-9). Code blocks and inline-code regions are excluded from detection.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any non-negative integer. `0` disables in-message URL fetching while still allowing `files[]` and `image_url` parts.
- **Default.** `5`.

### 7.6 `URL_FETCH_TIMEOUT_MS`

- **Purpose.** Per-URL fetch timeout (in ms) for both remote-URL attachments and `files[]` resolution.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any positive integer (milliseconds).
- **Default.** `30000` (30 seconds).

---

## 8. Agent

### 8.1 `AGENT_TIMEOUT_MS`

- **Purpose.** Per-turn timeout for the Claude Agent SDK `query()` call. When this elapses, the runner's `AbortController` fires and the request returns 504 `agent_timeout` (F-12).
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any positive integer (milliseconds).
- **Default.** `300000` (5 minutes).

### 8.2 `AGENT_MAX_TURNS`

- **Purpose.** SDK `maxTurns` cost guardrail — caps the number of agent iterations within a single chat completion (F-12).
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any positive integer.
- **Default.** `20`.

### 8.3 `MODEL_PREFIX`

- **Purpose.** Optional prefix that the service strips from the inbound `model` field before validating against `MODEL_IDS` (F-6). Allows clients to namespace model IDs (e.g. Open WebUI's `cc.claude-sonnet-4-6`) without changing the canonical names listed in `MODEL_IDS`.
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** Any string. Empty string disables stripping. Common values: `cc.`, `claude.`, `""`.
- **Default.** `cc.`.

### 8.4 `RESPONSES_TOOL_USE_RENDERING`

- **Purpose.** Selects how the Responses adapter renders the SDK's `tool_use` blocks (ADR-4).
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.**
  - `text` — render tool_use as italic-markdown inside `response.output_text.delta` events. Bit-for-bit parity with the Chat adapter's behavior.
  - `item` — **reserved for a future plan (FUT-5)**. Setting `item` in v1 raises `ConfigurationError` at startup and the process exits 78.
- **Default.** `text`.

---

## 9. Logging

### 9.1 `LOG_LEVEL`

- **Purpose.** Pino log level (NF-5).
- **Recommended storage.** Container env (`-e`); not secret.
- **Options.** `fatal`, `error`, `warn`, `info`, `debug`, `trace`.
- **Default.** `info`.

The service emits structured JSON via Pino. The Fastify logger redacts `req.headers.authorization`, base64 image payloads larger than 1 KB, and provider API keys.

---

## 10. Expiring credentials (the `*_EXPIRES_AT` family)

Per project rule "configuration parameters that expire", every rotation-eligible credential variable has a paired `*_EXPIRES_AT` ISO-8601 variable so the service can warn the operator before the key stops working (F-17).

| Credential variable | Paired expiry variable | Behavior at startup |
|---|---|---|
| `AGENT_HOST_API_KEY` | `AGENT_HOST_API_KEY_EXPIRES_AT` | WARN if within 30 days, ERROR if past, INFO otherwise |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY_EXPIRES_AT` | Same |
| `ANTHROPIC_FOUNDRY_API_KEY` | `ANTHROPIC_FOUNDRY_API_KEY_EXPIRES_AT` | Same |
| `FILES_API_KEY` | `FILES_API_KEY_EXPIRES_AT` | Same |

**Format.** ISO-8601 date or datetime. Examples:
- `2026-12-31` — interpreted as end-of-day UTC on that date.
- `2026-12-31T23:59:59Z` — explicit datetime.

**Behavior.** The expiry variables are themselves optional. When unset, no tracking is performed and a single INFO line confirms tracking is disabled. The service starts regardless of warning or error state — the goal is operator awareness, not gate-keeping.

---

## 11. Validation matrix

This table is the single source of truth for "is this variable required, and what does the service do at startup if it is missing?"

| Variable | Required when | Error on missing | Example value |
|---|---|---|---|
| `AGENT_HOST_API_KEY` | Always | `ConfigurationError("AGENT_HOST_API_KEY")` → exit 78 | `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` |
| `MODEL_IDS` | Always | `ConfigurationError("MODEL_IDS")` → exit 78 | `claude-sonnet-4-6,claude-haiku-4-5,claude-opus-4-7` |
| `CLAUDE_CODE_USE_FOUNDRY` | Optional | (none — selects branch) | `1` |
| `ANTHROPIC_API_KEY` | When `CLAUDE_CODE_USE_FOUNDRY != "1"` | `ConfigurationError("ANTHROPIC_API_KEY")` → exit 78 | `sk-ant-api03-…` |
| `ANTHROPIC_API_KEY_EXPIRES_AT` | Optional | (none) | `2026-12-31` |
| `ANTHROPIC_FOUNDRY_API_KEY` | When `CLAUDE_CODE_USE_FOUNDRY = "1"` | `ConfigurationError("ANTHROPIC_FOUNDRY_API_KEY")` → exit 78 | `<paste-foundry-key>` |
| `ANTHROPIC_FOUNDRY_RESOURCE` | When `CLAUDE_CODE_USE_FOUNDRY = "1"` | `ConfigurationError("ANTHROPIC_FOUNDRY_RESOURCE")` → exit 78 | `biksaiservice-east-us-2` |
| `ANTHROPIC_FOUNDRY_API_KEY_EXPIRES_AT` | Optional | (none) | `2026-12-31` |
| `FILES_API_BASE_URL` | Optional — only required if `files[]` extensions are used. Must be set together with `FILES_API_KEY`. | `ConfigurationError("FILES_API_BASE_URL")` if `FILES_API_KEY` is set without it → exit 78 | `http://192.168.65.1:3080` |
| `FILES_API_KEY` | Optional — only required if `files[]` extensions are used. Must be set together with `FILES_API_BASE_URL`. | `ConfigurationError("FILES_API_KEY")` if `FILES_API_BASE_URL` is set without it → exit 78 | `<paste-token-here>` |
| `FILES_API_PATH_TEMPLATE` | Optional (default `/api/v1/files/{id}/content`) | (none) | `/api/v1/files/{id}/content` |
| `FILES_API_KEY_EXPIRES_AT` | Optional | (none) | `2026-12-31` |
| `LISTEN_HOST` | Optional (default `0.0.0.0`) | (none) | `0.0.0.0` |
| `LISTEN_PORT` | Optional (default `8000`) | (none) | `8000` |
| `BODY_LIMIT_BYTES` | Optional (default `67108864`) | (none) | `67108864` |
| `WORKSPACE_DIR` | Optional (default `/workspace` — silent-default exception #1) | (none) | `/workspace` |
| `WORKSPACE_MAX_BYTES_PER_CHAT` | Optional (default `209715200`) | (none) | `209715200` |
| `MAX_INLINE_IMAGE_BYTES` | Optional (default `20971520`) | (none) | `20971520` |
| `MAX_REMOTE_FETCH_BYTES` | Optional (default `52428800`) | (none) | `52428800` |
| `MAX_URL_FETCHES_PER_TURN` | Optional (default `5`) | (none) | `5` |
| `URL_FETCH_TIMEOUT_MS` | Optional (default `30000`) | (none) | `30000` |
| `AGENT_TIMEOUT_MS` | Optional (default `300000`) | (none) | `300000` |
| `AGENT_MAX_TURNS` | Optional (default `20`) | (none) | `20` |
| `MODEL_PREFIX` | Optional (default `cc.`) | (none) | `cc.` |
| `RESPONSES_TOOL_USE_RENDERING` | Optional (default `text`) | `ConfigurationError` if set to `item` (FUT-5 reserved) | `text` |
| `AGENT_HOST_API_KEY_EXPIRES_AT` | Optional | (none) | `2026-12-31` |
| `LOG_LEVEL` | Optional (default `info`) | (none) | `info` |

---

## 12. Storage recommendations summary

| Variable kind | Recommended storage |
|---|---|
| Bearer tokens, API keys (`AGENT_HOST_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_FOUNDRY_API_KEY`, `FILES_API_KEY`) | A `0600` `.env` file passed via `--env-file`, or a runtime secret store. Never commit, never log. |
| Endpoints, ports, sizes, timeouts | Container env (`-e KEY=VALUE`). Visible, reproducible, non-secret. |
| Provider switch (`CLAUDE_CODE_USE_FOUNDRY`), resource name (`ANTHROPIC_FOUNDRY_RESOURCE`), `MODEL_IDS`, `MODEL_PREFIX` | Container env (`-e`). Not secret. |
| Expiry markers (`*_EXPIRES_AT`) | Container env (`-e`). Not secret; informational only. |

---

## 13. Cross-references

- Functional requirements: `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/project-functions.md` (F-13, F-16, F-17, NF-3, NF-5, NF-6 are most relevant to this guide).
- Architecture and runtime semantics: `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/project-design.md` §6 (Configuration model).
- `.env.example` template: `/Users/giorgosmarinos/aiwork/agent-host-cc/.env.example`.
- Local deploy runbook: `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/how-to/deploy-locally.md`.
- Client wiring: `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/how-to/connect-openai-client.md`.
- Project memory exception list: `/Users/giorgosmarinos/aiwork/agent-host-cc/CLAUDE.md` → "Configuration Fallback Exceptions".
