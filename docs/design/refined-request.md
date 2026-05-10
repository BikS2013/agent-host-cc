# Refined Request: agent-host-cc — Standalone Claude-Code Agent Host

## User Confirmation (2026-05-10)

The following decisions were confirmed by the user via `AskUserQuestion` after this document's first draft. They override any conflicting language below; downstream phases (planning, design, implementation) MUST honor this section as authoritative.

- **CONFIRMED-1 Provider abstraction.** Decouple from Foundry. Anthropic public API is the default; Foundry is opt-in via `CLAUDE_CODE_USE_FOUNDRY=1`. (Matches D-1, F-13.)
- **CONFIRMED-2 OpenAI surface.** Implement **both `/v1/chat/completions` and `/v1/responses`**. The previous draft restricted v1 to Chat Completions only — that restriction is **revoked**. The Responses API is in scope for v1. See revised F-20 below and revised AC-17/AC-18 below.
- **CONFIRMED-3 cc-monitor scope.** Out of scope for v1. Pointer file in `docs/reference/` only. (Matches D-3.)
- **CONFIRMED-4 Container distribution.** Local Docker + Apple `container` CLI only. No registry push automation in v1. (Matches D-6.)
- Decisions D-4 (attachment pipeline preserved + generalized), D-5 (bearer-token mandatory), and D-7 (per-chat workspace, oldest-first eviction) stand unchanged. OQ-8 (deterministic chatId derivation when `metadata.chat_id` absent) and OQ-9 (project name `agent-host-cc`, image tag `agent-host-cc:dev`) remain to be confirmed during implementation kickoff.

### Revised functional requirements (overrides below)

- **F-1 (revised)** stays: `POST /v1/chat/completions` SSE + non-streaming.
- **F-20 (NEW) — OpenAI Responses API.** The service MUST also expose `POST /v1/responses` accepting the OpenAI Responses API request schema (`model`, `input` as string or message array with text + `input_image` parts, `stream`, `temperature`, `top_p`, `max_output_tokens`, `metadata.chat_id`, optional `files[]` extension), validated with Zod. Streaming responses MUST emit `text/event-stream` with the canonical Responses event sequence (`response.created`, `response.output_text.delta`, `response.output_text.done`, `response.completed`, terminating with `data: [DONE]\n\n`). Non-streaming responses MUST return the aggregated `Response` JSON object. Tool-use blocks from the Claude SDK MUST be surfaced as `response.output_text.delta` italic markdown the same way the Chat Completions adapter does, OR (preferred) as `response.output_item.added` items with `type:"reasoning"` if the consuming clients support it. The Responses adapter MUST share the SDK runner with `/v1/chat/completions`; only the surface mapping differs.
- **F-21 (NEW) — Adapter selection.** The HTTP layer MUST route to the correct adapter based on the request path. Both endpoints MUST share `attachmentProcessor`, `workspaceManager`, the runner abstraction, and the configuration loader.

### Revised scope adjustments

- **In scope (added):** `POST /v1/responses` (streaming + non-streaming), with the same auth, attachment, and workspace handling as `/v1/chat/completions`.
- **Out of scope (removed):** the previous bullet "The OpenAI Responses API (`/v1/responses`)" is removed from "Out of scope".
- **Source file rename revised.** Do NOT rename `openAiResponseAdapter.ts`. Instead:
  1. Create a new module `openAiChatSseAdapter.ts` that contains the Chat Completions SSE rendering currently in `openAiResponseAdapter.ts` (the misnamed file actually emits Chat Completions chunks).
  2. Implement a fresh `openAiResponseAdapter.ts` that emits the canonical Responses API event stream — reclaiming the filename for what it should have been.
  3. Update `httpServer.ts` to mount both adapters on their respective routes.

### Revised acceptance criteria (additions)

- **AC-17 — Responses API streaming smoke.** A streaming `POST /v1/responses` with a single text input returns a well-formed Responses event stream ending with `data: [DONE]\n\n`. The aggregated `output_text` is non-empty.
- **AC-18 — Responses API non-streaming.** A `POST /v1/responses` with `stream:false` returns the aggregated Responses JSON object including `id`, `object:"response"`, `model`, `output[]`, and `usage`.
- **AC-19 — Responses API attachment parity.** A `POST /v1/responses` with an `input_image` data URL writes to the per-chat workspace and is forwarded to the SDK as inline image (mirrors AC-8 for the Responses surface).
- **AC-20 — OpenAI SDK Responses smoke.** Using the official OpenAI Node SDK's `client.responses.create({ model, input, stream:true })` against `baseURL=http://localhost:8000/v1` produces a successful streaming response.

## Category
Development (greenfield project produced by extracting and re-platforming an existing service)

## Objective
Produce a self-contained, standalone TypeScript project at `/Users/giorgosmarinos/aiwork/agent-host-cc/` that packages the Anthropic Claude Code agent inside a container and exposes it through an OpenAI-compatible HTTP interface. The new project must extract every piece of code, configuration, and operational know-how it needs from the source `agent-host` service in `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host/` (and surrounding documentation under `/Users/giorgosmarinos/aiwork/open-webui-phase1/docs/`), and must continue to operate without any reference, build dependency, runtime dependency, or path linkage back to the `open-webui-phase1` repository. The result must be deployable as a Docker (or compatible OCI) container that any OpenAI-compatible client (Open WebUI, custom UIs, scripts using the OpenAI SDK, evaluation harnesses) can talk to.

## Scope

### In scope
- Extract the existing TypeScript service from `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host/` (sources under `src/`, tests under `test/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `Dockerfile`, `.dockerignore` if present) into the new project.
- Preserve and re-document the modules that make the service work: `httpServer`, `attachmentProcessor` (with sub-modules `dataUrlDecoder`, `ssrfGuard`, `remoteUrlFetcher`, `filesApiFetcher`, `urlDetector`), `workspaceManager`, `agentRunner` interface, `claudeCodeRunner`, `openAiResponseAdapter` (note: actually emits Chat Completions SSE chunks despite the filename), `config`, `errors`, `types`, `index`.
- Preserve the OpenAI Chat Completions surface: `POST /v1/chat/completions` (streaming SSE and non-streaming aggregate), `GET /v1/models`, `GET /healthz`, `GET /files/:chatId/*path` (workspace artifact serving with bearer-token auth and traversal protection).
- Preserve the attachment processing pipeline end-to-end:
  - `image_url` data URLs (base64-decoded, written to per-chat workspace, kept inline if under inline ceiling, otherwise disk-only).
  - `image_url` http(s) URLs (fetched with SSRF guard, written to disk, manifest line in last user message).
  - `files[]` entries (fetched from a configurable upstream Files API).
  - Plain-text URL detection in user messages with per-turn fetch budget.
- Per-chat workspace management with sanitized filenames, sha-suffix de-duplication, per-chat byte cap, oldest-first eviction, and path-traversal protection.
- Bearer-token authentication on every endpoint except `GET /healthz`, with the token sourced from a single configuration variable.
- Structured error envelope across all failure modes (`unauthorized`, `invalid_request`, `model_not_found`, `payload_too_large`, `upstream_files_fetch_failed`, `upstream_url_fetch_failed`, `unsafe_url`, `agent_error`, `agent_timeout`, `internal`).
- Configuration loading with no silent fallbacks for required variables: missing required value throws `ConfigurationError` and exits the process with code 78.
- Expiring-credential warnings (`*_EXPIRES_AT` ISO-8601 variables) with WARN-when-near and ERROR-when-past behavior at startup.
- Decoupling from Azure AI Foundry: the new service must support routing to either (a) Anthropic's public API (`api.anthropic.com`) using `ANTHROPIC_API_KEY`, or (b) an Azure AI Foundry / Anthropic-on-Foundry deployment using `ANTHROPIC_FOUNDRY_API_KEY` + `ANTHROPIC_FOUNDRY_RESOURCE` + `CLAUDE_CODE_USE_FOUNDRY=1`. Selection is driven by configuration; neither path is hard-coded.
- Decoupling from Open WebUI's Files API: the upstream `files[]` resolver must be a generic, configurable HTTP backend (base URL + bearer token + path template). Open WebUI's `/api/v1/files/<id>/content` becomes one supported backend pattern, not the only one.
- A `Dockerfile` that produces an image runnable on Docker Desktop, Apple `container`, or any OCI-compliant runtime, using a non-root user.
- A `docker-compose.yml` (or equivalent) reference for local single-container deployment, including a sample `.env.example`.
- A test suite covering unit (`vitest`) and integration tests, ported and adapted from the source project's `test/` tree, with all references to "Open WebUI", "Foundry-only", "phase1" abstracted to neutral, configurable equivalents.
- A complete documentation set under `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/`:
  - `docs/design/project-design.md` — architecture, components, data flow.
  - `docs/design/project-functions.md` — functional requirements register.
  - `docs/design/configuration-guide.md` — every config variable, source priority, storage recommendations, expiry handling.
  - `docs/design/plan-001-extract-and-rebrand.md` — migration plan from the source extraction.
  - `docs/design/plan-002-decouple-from-foundry.md` — provider abstraction work.
  - `docs/how-to/deploy-locally.md` — local container build and run runbook.
  - `docs/how-to/connect-openai-client.md` — connecting Open WebUI, OpenAI SDK, curl, etc.
  - `docs/reference/` — extracted reference material from the source project (sanitized).

### Out of scope
- The `cc-monitor` sibling service from the source project (separate monitoring tool with Electron/CLI dashboards, dockerode usage). It is not migrated and the new project must not depend on it. A short note in `docs/reference/` may mention its existence and where to find it; nothing more.
- The Open WebUI container, Pipelines container, or any other phase-1 surrounding infrastructure.
- The Python `claude-skills` and `claude-artifact-server` containers that plan-002 of the source project retired.
- Any DB-stored Open WebUI configuration (`OPENAI_API_CONFIGS`, etc.) — that is a UI-side concern of the consumer.
- Stateful multi-turn agent sessions held in memory across HTTP requests (the workspace persists per `chatId`, but no SDK session handle is held — same stance as source).
- A Pipelines inlet filter (the source already retired this in plan-002).
- Publishing the resulting image to a public container registry (build is local-only by default; pushing is left as an operator concern).
- Multiple `AgentRunner` implementations beyond `ClaudeCodeRunner` (the interface remains, only one impl ships).
- The OpenAI Responses API (`/v1/responses`) — see "Decisions" below; the `openAiResponseAdapter.ts` filename in the source is misleading: the actual implementation targets Chat Completions SSE.
- Any time-based workspace GC, admin DELETE endpoint, per-chat file token gating (all carried forward as future work, same as source).

## Requirements

### Functional

1. **F-1 OpenAI-compatible Chat Completions.** The service MUST expose `POST /v1/chat/completions` accepting the OpenAI request schema (model, messages with text and `image_url` content parts, optional `stream`, `temperature`, `top_p`, `max_tokens`, `metadata.chat_id`, optional `files[]` extension), validated with Zod. Both streaming SSE responses (`text/event-stream` with `chat.completion.chunk` payloads and a final `data: [DONE]\n\n`) and non-streaming aggregate JSON responses MUST be supported, controlled by the request's `stream` field.

2. **F-2 Models endpoint.** The service MUST expose `GET /v1/models` returning the OpenAI list shape (`{object:"list", data:[{id, object:"model", created, owned_by}]}`) populated from the `MODEL_IDS` config.

3. **F-3 Health endpoint.** `GET /healthz` MUST return `{ok:true}` with no authentication required.

4. **F-4 Workspace artifact endpoint.** `GET /files/:chatId/*path` MUST stream files from `<workspaceDir>/<chatId>/<path>` with bearer-token auth, path-traversal protection (resolved absolute path must start with the chat root + path separator), `application/octet-stream` content type, and 404 on missing or non-file paths.

5. **F-5 Bearer-token auth.** Every endpoint except `GET /healthz` MUST require `Authorization: Bearer <AGENT_HOST_API_KEY>` and reject mismatches with HTTP 401 and the `unauthorized` error envelope.

6. **F-6 Model namespace prefix stripping.** The service MUST accept model IDs both with and without a configurable prefix (default: `cc.`) and strip it before validation against `MODEL_IDS`. The prefix MUST be configurable via `MODEL_PREFIX` (default `cc.`, empty string disables stripping).

7. **F-7 Image attachment handling.** `image_url` content parts with `data:` URLs MUST be base64-decoded, written to the per-chat workspace, kept inline as Anthropic image blocks when under `MAX_INLINE_IMAGE_BYTES` (default 20 MB) AND the MIME starts with `image/`, otherwise disk-only with a manifest note in the user message.

8. **F-8 Files[] attachment handling.** `files[]` entries MUST be fetched from a configurable upstream Files API (base URL, bearer key, path template), written to the per-chat workspace, and surfaced as a manifest line appended to the last user message. Fetch failures MUST be swallowed per-entry without aborting the turn.

9. **F-9 In-message URL detection and fetch.** Plain-text URLs in user messages MUST be detected (excluding fenced code blocks and inline code), capped at `MAX_URL_FETCHES_PER_TURN` per request, fetched with the SSRF guard active, written to disk, and surfaced in the manifest.

10. **F-10 SSRF guard.** Remote URL fetches MUST reject non-http(s) schemes and MUST reject hostnames resolving to private/loopback/link-local/ULA ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`).

11. **F-11 Per-chat workspace.** Files MUST be written under `<WORKSPACE_DIR>/<sanitized chatId>/`. Filenames MUST be sanitized (no `..`, no abs paths, no null/control chars, max 200 chars). Identical content (sha-256 match) MUST de-duplicate; collisions on different content MUST suffix `-<sha[:8]>` before the extension. Per-chat total bytes MUST be capped at `WORKSPACE_MAX_BYTES_PER_CHAT`; oldest-first eviction MUST be available via the workspace manager API even if not yet auto-triggered.

12. **F-12 Claude Code agent execution.** The service MUST drive `@anthropic-ai/claude-agent-sdk` `query()` with: cleaned messages, model, `cwd=<workspace>/<chatId>`, configured `maxTurns`, an `AbortController` that fires on `AGENT_TIMEOUT_MS`, `tools: { type:"preset", preset:"claude_code" }`, `systemPrompt: { type:"preset", preset:"claude_code" }`, `settingSources: ["project"]`, `permissionMode: "bypassPermissions"`, and `allowDangerouslySkipPermissions: true`. The bundled `claude` native executable from the SDK's platform package MUST be resolved explicitly and passed via `pathToClaudeCodeExecutable` to avoid SDK auto-detection failures on Alpine/virtiofs.

13. **F-13 Provider abstraction.** The runner MUST support at least two provider configurations selected by env:
    - **Anthropic public API** when `ANTHROPIC_API_KEY` is set and `CLAUDE_CODE_USE_FOUNDRY` is not `1` (or unset).
    - **Anthropic-on-Foundry** when `CLAUDE_CODE_USE_FOUNDRY=1` AND both `ANTHROPIC_FOUNDRY_API_KEY` and `ANTHROPIC_FOUNDRY_RESOURCE` are set.
    Exactly one provider must resolve at startup; ambiguous or partial configurations MUST throw `ConfigurationError` and exit 78.

14. **F-14 SSE adapter.** The Chat Completions SSE adapter MUST emit `chat.completion.chunk` payloads for every assistant text block (1:1 with SDK text deltas), render `tool_use` blocks as visible italic markdown of the form `\n\n*[<tool>: <truncated-input>]*\n`, emit a final `delta:{}, finish_reason:"stop"` chunk, and terminate with `data: [DONE]\n\n`. Mid-stream errors MUST emit a final SSE error chunk before `[DONE]` and MUST NOT silently truncate.

15. **F-15 Structured error envelope.** All errors MUST serialize as `{error:{type, message, ...details}}` with the documented HTTP status codes and `error.type` codes (see "Source Error Contract" in the migration plan).

16. **F-16 Configuration with no fallbacks.** Required configuration variables that are missing MUST raise a typed `ConfigurationError` naming the variable and the process MUST exit with code 78. Optional variables MUST log their resolved value at INFO at startup (with secrets redacted).

17. **F-17 Expiring-credential warnings.** Each rotation-eligible credential variable MUST have a paired `*_EXPIRES_AT` ISO-8601 variable; at startup, if the value is within 30 days the service MUST log WARN; if past, ERROR. Service MUST still start in either case.

18. **F-18 Containerized deployment.** The service MUST ship a multi-stage `Dockerfile` producing a runnable image with a non-root user (`agent`, uid 1000) owning `/workspace`, exposing the configured listen port (default 8000), and starting the service as `node dist/index.js`. The image MUST be buildable and runnable with both Docker and Apple `container` (no platform-specific build steps).

19. **F-19 Operator runbook.** The repository MUST include a runbook documenting: building the image, generating a strong `AGENT_HOST_API_KEY` (`openssl rand -hex 32`), creating an `.env` file from `.env.example`, running the container with the documented mount points and port mapping, smoke-testing `/healthz` and `/v1/models`, and connecting an OpenAI SDK or Open WebUI client.

### Non-functional

20. **NF-1 Self-containment.** The new project MUST NOT import, reference, copy at runtime, or rely on any path inside `/Users/giorgosmarinos/aiwork/open-webui-phase1/`. A grep for `open-webui-phase1`, `phase1`, `claude-bridge`, `claude-skills`, `claude-artifact-server`, `cc-monitor`, or `pipelines` in the new project's source, configs, and docs MUST yield only intentional historical references in `docs/reference/` (clearly marked as historical context).

21. **NF-2 Conformance to project conventions.** All TypeScript, ESM, Node ≥ 22, Fastify, Zod, Pino, Undici, vitest. Test scripts (acceptance, smoke) live under `/test_scripts/`. Plans live under `/docs/design/plan-xxx-*.md`. Functional requirements are registered in `/docs/design/project-functions.md`. The complete design lives in `/docs/design/project-design.md`. Issue tracker at `/Issues - Pending Items.md`.

22. **NF-3 No silent fallbacks.** Required configuration MUST never silently fall back to a default. The single intentional derived-value exception (deterministic `chatId` hash when `metadata.chat_id` is absent) MUST be documented in `docs/design/project-design.md` AND in the project's CLAUDE.md memory exception list before being implemented.

23. **NF-4 Test coverage parity.** Every unit test in the source project's `test/unit/` tree MUST have an equivalent in the new project (potentially renamed/refactored to drop Open-WebUI-specific naming) and MUST pass green. Integration tests (`test/integration/`) MUST be ported with mocks renamed to neutral providers (e.g., `mockFoundry.ts` becomes `mockAnthropicProvider.ts` or similar; `mockOpenWebUI.ts` becomes `mockFilesApi.ts`).

24. **NF-5 Logging.** All logs MUST be JSON via Pino, with `req.headers.authorization`, base64 image bodies > 1 KB, and provider API keys redacted.

25. **NF-6 Body limit.** The Fastify server MUST accept request bodies up to 64 MB (to accommodate base64 image data URLs) and MUST surface body-too-large as a 413 with the structured error envelope, not as an opaque Fastify 500.

## Constraints

- **Language & runtime:** TypeScript, ESM, Node.js ≥ 22, per the source project and the project conventions in `CLAUDE.md`.
- **HTTP framework:** Fastify v5.
- **Validation:** Zod v4.
- **HTTP client:** Undici v6.
- **Logger:** Pino v9.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` v0.2.x or later (must remain pinned to a working minor).
- **Container conventions:** Multi-stage Dockerfile based on `node:22-alpine`. Non-root user. `/workspace` is the only writable mount target for the agent.
- **No code-level config fallbacks** for required variables (per project rule). Exception list lives in CLAUDE.md.
- **No version-control operations** unless the user explicitly requests them.
- **Documentation locations are fixed** by project conventions: design docs under `docs/design/`, references under `docs/reference/`, runbooks under `docs/how-to/`, test scripts under `test_scripts/`, issue log at the project root as `Issues - Pending Items.md`.
- **TS code only.** Any auxiliary tooling that needs to be authored as a "tool" inside this project must be TypeScript and follow the `/tool-conventions` scaffolding flow.

## Decisions Taken (in lieu of live clarification)

The parent task asked for several clarifications via `AskUserQuestion`, which is not available in this environment. The following decisions are recorded so the user can reverse any of them before implementation begins:

- **D-1 Provider abstraction:** the new project is **not Foundry-locked**. It supports Anthropic public API by default and Foundry as an opt-in alternative, selected by configuration (see F-13). The "claude-code-only" framing in the raw request refers to the **agent runtime** (only `ClaudeCodeRunner` ships), not to a single LLM endpoint provider.
- **D-2 OpenAI surface:** **only `/v1/chat/completions`** (streaming + non-streaming) is implemented in v1, plus `/v1/models`, `/healthz`, and the workspace `/files/:chatId/*` endpoint. The source file `openAiResponseAdapter.ts` is renamed to a more accurate `openAiChatSseAdapter.ts` (or kept with a clarifying comment) — it does not implement the OpenAI Responses API. Adding `/v1/responses` is deferred to a future plan.
- **D-3 cc-monitor:** **out of scope.** A historical pointer is added under `docs/reference/historical-context-cc-monitor.md` for traceability, nothing more. No code, no dependency.
- **D-4 Attachment processing:** **fully preserved.** Data URLs, remote URLs (with SSRF guard), and the Files API resolver all carry over. The Files API is generalized via a configurable backend (base URL + bearer key + path template) so it is no longer named after Open WebUI.
- **D-5 Auth model:** **bearer-token, mandatory** on every endpoint except `/healthz`. Open mode is not provided. The token is provisioned by the operator (`openssl rand -hex 32`).
- **D-6 Distribution:** **local Docker / Apple `container` build only.** No CI/CD pipeline to a registry in v1. The Dockerfile and a docker-compose example are shipped; pushing to a registry is documented as an operator-side option in `docs/how-to/deploy-locally.md`.
- **D-7 Workspace persistence:** **persistent per-chat workspace** is preserved (oldest-first eviction at the configured byte cap). No automatic time-based GC, no admin DELETE in v1 — same stance as the source.

## Acceptance Criteria

Each criterion is independently testable. "Pass" means demonstrated against the built image running on the local host.

- **AC-1 Self-contained build.** Running `npm ci && npm run build` inside `/Users/giorgosmarinos/aiwork/agent-host-cc/` succeeds with **zero references** to `/Users/giorgosmarinos/aiwork/open-webui-phase1/` in the resolved module graph (`npm ls` and a path-grep on the resulting `dist/` produce nothing pointing at the source repo). The project tree must build successfully even after the source repo is renamed or removed.

- **AC-2 Test parity.** `npm test` runs the full ported unit + integration suite green. The number of test files is greater than or equal to the source's `test/unit/` count plus `test/integration/` count. `mockFoundry`/`mockOpenWebUI` are replaced with provider-neutral mocks.

- **AC-3 Container builds.** `docker build -t agent-host-cc:dev .` (and equivalently `container build -t agent-host-cc:dev .`) completes and produces an image that runs as uid 1000 and listens on the configured port.

- **AC-4 Health probe.** `curl http://localhost:8000/healthz` against the running container returns `{"ok":true}` HTTP 200 with no auth header.

- **AC-5 Models endpoint.** `curl -H "Authorization: Bearer $AGENT_HOST_API_KEY" http://localhost:8000/v1/models` returns the configured model list. Without the header → 401 `unauthorized`.

- **AC-6 Text-only chat completion (Anthropic public API).** With `ANTHROPIC_API_KEY` configured and `CLAUDE_CODE_USE_FOUNDRY` unset, a streaming `POST /v1/chat/completions` with a single text user message returns a well-formed SSE stream ending with `data: [DONE]\n\n`. The aggregated text content is non-empty and reasonable.

- **AC-7 Text-only chat completion (Foundry).** With `CLAUDE_CODE_USE_FOUNDRY=1` plus `ANTHROPIC_FOUNDRY_API_KEY` and `ANTHROPIC_FOUNDRY_RESOURCE` set, the same request as AC-6 succeeds against a Foundry deployment. The integration test variant uses a mocked Foundry endpoint.

- **AC-8 Image attachment.** A `POST /v1/chat/completions` with an `image_url` content part using a `data:image/png;base64,…` payload causes:
  - the image to be written under `<WORKSPACE_DIR>/<chatId>/`,
  - the request forwarded to the SDK with an inline image block (verified via mock),
  - a manifest note appended to the last user message text.

- **AC-9 Files[] handling.** A `POST /v1/chat/completions` with a `files[]` entry referring to an ID resolvable by the configured Files API backend (mocked in tests) causes the file to be written to the per-chat workspace and a manifest line appended.

- **AC-10 In-text URL fetching with SSRF guard.** A user message containing `https://example.com/spec.pdf` triggers a remote fetch (mocked in tests). A user message containing `http://127.0.0.1:80/` is rejected with the SSRF guard and returns a 400 `unsafe_url` from the per-fetch path while the chat turn still completes.

- **AC-11 Workspace size cap.** A request that would push the chat directory over `WORKSPACE_MAX_BYTES_PER_CHAT` returns a 413 `payload_too_large` envelope with `limitBytes` and `currentBytes` populated.

- **AC-12 Workspace artifact serving.** After the agent writes a file under `/workspace/<chatId>/<file>`, a bearer-authenticated `GET /files/<chatId>/<file>` returns the file contents. A request with `..` or an absolute path is rejected as 400 `invalid_request`. A missing file returns 404.

- **AC-13 Configuration error.** Removing any required env var (e.g. `AGENT_HOST_API_KEY`) and starting the container produces a `ConfigurationError` log line naming the variable and exits with code 78. No silent default kicks in.

- **AC-14 Expiry warning.** Setting `ANTHROPIC_FOUNDRY_API_KEY_EXPIRES_AT` to a date 10 days in the future logs WARN at startup mentioning the variable and the date. Setting it to a past date logs ERROR. The service starts in both cases.

- **AC-15 Documentation completeness.** `docs/design/project-design.md`, `docs/design/project-functions.md`, `docs/design/configuration-guide.md`, and at least one runbook under `docs/how-to/` exist and are internally consistent (no dangling references, no `phase1` mentions outside `docs/reference/`).

- **AC-16 OpenAI SDK compatibility smoke.** Using the official OpenAI Node SDK (or Python SDK in a test script) configured with `baseURL=http://localhost:8000/v1` and `apiKey=$AGENT_HOST_API_KEY` produces a successful streaming chat completion against any one of the configured `MODEL_IDS`.

## Assumptions

- **A-1 Container runtime.** The operator has either Docker Desktop, Apple `container` v0.12+, or another OCI-compliant runtime locally. CI/CD against a registry is not assumed.
- **A-2 Anthropic credentials.** The operator has either an Anthropic public API key OR access to an Azure AI Foundry deployment of Claude models. The new project does not host or proxy these credentials beyond pass-through to the SDK.
- **A-3 Models.** The default `MODEL_IDS` list mirrors the source project (`claude-sonnet-4-6,claude-haiku-4-5,claude-opus-4-7`) but the README will document this is a placeholder; operators are expected to set `MODEL_IDS` to whatever their provider deployment exposes. No model name is hard-coded in source.
- **A-4 Files API backend.** Most consumers will set the backend to point at Open WebUI's `/api/v1/files/<id>/content`, but the configuration variables are named generically (`FILES_API_BASE_URL`, `FILES_API_KEY`, `FILES_API_PATH_TEMPLATE` with default `/api/v1/files/{id}/content`). Backends that don't follow this template can override the template.
- **A-5 Single container.** The deployment unit is one container. Horizontal scaling and shared workspace storage are out of scope for v1 (per-chat directories on a local volume).
- **A-6 No auth on `/healthz`.** Container orchestrators rely on this; the source project already follows this convention.
- **A-7 The source project remains read-only.** Extraction is a one-time copy + adapt; the source agent-host code under `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host/` is not modified during this work.
- **A-8 Git history is not preserved.** The source files are copied flat. If history preservation is later requested, it will be done as a separate task.

## Open Questions

The following items could not be confirmed in-session and SHOULD be confirmed before implementation begins. Default decisions are recorded in "Decisions Taken" above; flag these to the user explicitly.

- **OQ-1** Confirm provider scope: ship with **both** Anthropic public + Foundry support (current decision D-1), or restrict to Anthropic public only?
- **OQ-2** Confirm OpenAI surface: Chat Completions only (current decision D-2), or also implement `/v1/responses`?
- **OQ-3** Confirm `cc-monitor` is out of scope (current decision D-3).
- **OQ-4** Confirm attachment pipeline preservation in full (current decision D-4) — including the SSRF guard and the in-message URL auto-fetcher.
- **OQ-5** Confirm bearer-token auth is the only auth mode (current decision D-5).
- **OQ-6** Confirm container distribution stays local-only (current decision D-6); if a registry is wanted, name it (Docker Hub, GHCR, Azure Container Registry, etc.).
- **OQ-7** Confirm workspace persistence model (current decision D-7) — chat-directory persists, oldest-first eviction at cap, no GC.
- **OQ-8** Confirm whether the deterministic `chatId` derivation when `metadata.chat_id` is absent is acceptable (it is the only intentional fallback in the design and must be added to CLAUDE.md's exception list per the no-fallback rule).
- **OQ-9** Confirm the final project package name (`agent-host-cc`) and Docker image tag (`agent-host-cc:dev`/`:latest`).

## Migration Plan (extract → standalone)

This is the high-level migration sequence the implementation phase will follow. Each step is independently verifiable.

1. **Inventory & copy.** Copy the source `agent-host/` tree (excluding `node_modules/`, build artifacts, lockfile if not desired) to the new project root. Update `package.json` `name` to `agent-host-cc` and `description` to remove "Open WebUI cc.* models". Drop the `private:true` if a registry publish is later wanted (default: keep private).
2. **Strip phase-1 coupling.** Remove or rename references to `cc.*`, "Open WebUI", "Foundry-only", "phase 1", `OPENWEBUI_*` variables. Replace `OPENWEBUI_BASE_URL`/`OPENWEBUI_API_KEY` with `FILES_API_BASE_URL`/`FILES_API_KEY` (back-compat aliases acceptable for one release if explicitly approved).
3. **Provider abstraction.** Refactor `claudeCodeRunner.ts` so the env injection block conditionally sets either `ANTHROPIC_API_KEY` (public) or `CLAUDE_CODE_USE_FOUNDRY=1` + `ANTHROPIC_FOUNDRY_API_KEY` + `ANTHROPIC_FOUNDRY_RESOURCE` (Foundry). Remove the hard `CLAUDE_CODE_USE_FOUNDRY=1` requirement from `config.ts`.
4. **Filename rename.** Rename `openAiResponseAdapter.ts` → `openAiChatSseAdapter.ts` (the current name is misleading — it produces Chat Completions chunks, not Responses API events). Update imports and tests.
5. **Tests.** Port `test/unit/*` and `test/integration/*` into the new project. Rename `mockFoundry.ts` → provider-neutral mock; rename `mockOpenWebUI.ts` → `mockFilesApi.ts`. Confirm `vitest run` is green.
6. **Dockerfile.** Re-verify the multi-stage build under both Docker and Apple `container`. Ensure no `COPY` instruction reaches outside the new project root.
7. **Documentation.** Re-author the four mandatory docs (`project-design.md`, `project-functions.md`, `configuration-guide.md`, at least one runbook). Use the source's `plan-002-typescript-agent-host.md`, `plan-003-agent-host-implementation.md`, and `configuration-guide.md` as references; transcribe what applies, drop what doesn't, neutralize phase-1 specifics. Add `docs/reference/source-extraction-notes.md` capturing what was copied, what was renamed, and what was dropped.
8. **`.env.example` & docker-compose.** Provide an `.env.example` covering every required and optional variable with safe placeholder values, plus a `docker-compose.yml` that wires the container, a named volume for `/workspace`, and the env file.
9. **Smoke tests.** Add `test_scripts/smoke-anthropic-public.ts` and `test_scripts/smoke-foundry.ts` exercising AC-6, AC-7, AC-8, AC-9, AC-10, AC-12, AC-16 against a running container.
10. **Issue log.** Initialize `/Issues - Pending Items.md` with carry-over items from the source (admin DELETE workspace, per-chat file token, `/v1/responses` support, multi-runner) plus any deltas surfaced during migration.

## Original Request

```
I want you to examine the code inside the `../Open-WebUI-phase1` project (absolute path: `/Users/giorgosmarinos/aiwork/open-webui-phase1`).

Inside that project there is a folder named `agent-host/` (absolute path: `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host`) which contains an implementation that aims to be used as the harness needed to package the claude-code capabilities inside a container and expose them through an OpenAI-compatible HTTP interface.

I want you to:
1. Get any source code needed for this purpose from the `open-webui-phase1` project — focusing on the `agent-host/` folder but pulling in any other code or assets it depends on (config, scripts, Dockerfile, attachment processors, etc.).
2. Build a dedicated, clear, standalone solution at `/Users/giorgosmarinos/aiwork/agent-host-cc/` that allows me to deploy Claude-Code containers which are accessible through an OpenAI-compatible interface. The solution must NOT depend on the open-webui-phase1 repository — it must stand on its own.
3. Collect any documents needed from `../open-webui-phase1/docs/` (design docs, plans, configuration guides, how-tos) and use them to create clear, concise, and precise documentation under `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/` describing how the solution has been designed, how it has been implemented, and how users must use it.

Source project context (already explored):
- Source agent-host code: `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host/` — TypeScript, has `src/` with httpServer.ts, openAiResponseAdapter.ts, claudeCodeRunner.ts, agentRunner.ts, attachmentProcessor.ts (+ submodules), workspaceManager.ts, config.ts, types.ts, errors.ts, index.ts; plus Dockerfile, package.json, tsconfig.json, vitest.config.ts, test/.
- Source docs: `/Users/giorgosmarinos/aiwork/open-webui-phase1/docs/design/` contains `plan-002-typescript-agent-host.md`, `plan-003-agent-host-implementation.md`, `configuration-guide.md`, `project-design.md`, `project-functions.md`. `docs/how-to/connect-claude-skills-to-open-webui.md` is also relevant.
- Target project: `/Users/giorgosmarinos/aiwork/agent-host-cc/` — currently has only `CLAUDE.md` and empty `docs/{design,reference,research}/` and `test_scripts/` directories. Will host the standalone solution.

The new project will be named `agent-host-cc` (Claude-Code-only Agent Host).
```
