# Project Functions Register — `agent-host-cc`

> **Source of truth:** `docs/design/refined-request.md` (User Confirmation 2026-05-10 block overrides earlier draft language).
>
> **Purpose:** Authoritative register of every functional and non-functional requirement the project commits to deliver. Each row captures the requirement verbatim and a tracking status. As implementation progresses, the Status column moves through `planned → in-progress → implemented → verified`.
>
> **How to update:** Implementation phases add an "Implemented in" column reference (commit hash, plan ID) and flip the status. Designer / reviewer phases flip to `verified` once the matching acceptance criterion (AC-N) passes against a built image.

## Functional requirements

| ID | Requirement (verbatim from refined-request.md) | Status |
|---|---|---|
| F-1 | **OpenAI-compatible Chat Completions.** The service MUST expose `POST /v1/chat/completions` accepting the OpenAI request schema (model, messages with text and `image_url` content parts, optional `stream`, `temperature`, `top_p`, `max_tokens`, `metadata.chat_id`, optional `files[]` extension), validated with Zod. Both streaming SSE responses (`text/event-stream` with `chat.completion.chunk` payloads and a final `data: [DONE]\n\n`) and non-streaming aggregate JSON responses MUST be supported, controlled by the request's `stream` field. | planned |
| F-2 | **Models endpoint.** The service MUST expose `GET /v1/models` returning the OpenAI list shape (`{object:"list", data:[{id, object:"model", created, owned_by}]}`) populated from the `MODEL_IDS` config. | planned |
| F-3 | **Health endpoint.** `GET /healthz` MUST return `{ok:true}` with no authentication required. | planned |
| F-4 | **Workspace artifact endpoint.** `GET /files/:chatId/*path` MUST stream files from `<workspaceDir>/<chatId>/<path>` with bearer-token auth, path-traversal protection (resolved absolute path must start with the chat root + path separator), `application/octet-stream` content type, and 404 on missing or non-file paths. | planned |
| F-5 | **Bearer-token auth.** Every endpoint except `GET /healthz` MUST require `Authorization: Bearer <AGENT_HOST_API_KEY>` and reject mismatches with HTTP 401 and the `unauthorized` error envelope. | planned |
| F-6 | **Model namespace prefix stripping.** The service MUST accept model IDs both with and without a configurable prefix (default: `cc.`) and strip it before validation against `MODEL_IDS`. The prefix MUST be configurable via `MODEL_PREFIX` (default `cc.`, empty string disables stripping). | planned |
| F-7 | **Image attachment handling.** `image_url` content parts with `data:` URLs MUST be base64-decoded, written to the per-chat workspace, kept inline as Anthropic image blocks when under `MAX_INLINE_IMAGE_BYTES` (default 20 MB) AND the MIME starts with `image/`, otherwise disk-only with a manifest note in the user message. | planned |
| F-8 | **Files[] attachment handling.** `files[]` entries MUST be fetched from a configurable upstream Files API (base URL, bearer key, path template), written to the per-chat workspace, and surfaced as a manifest line appended to the last user message. Fetch failures MUST be swallowed per-entry without aborting the turn. | planned |
| F-9 | **In-message URL detection and fetch.** Plain-text URLs in user messages MUST be detected (excluding fenced code blocks and inline code), capped at `MAX_URL_FETCHES_PER_TURN` per request, fetched with the SSRF guard active, written to disk, and surfaced in the manifest. | planned |
| F-10 | **SSRF guard.** Remote URL fetches MUST reject non-http(s) schemes and MUST reject hostnames resolving to private/loopback/link-local/ULA ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`). | planned |
| F-11 | **Per-chat workspace.** Files MUST be written under `<WORKSPACE_DIR>/<sanitized chatId>/`. Filenames MUST be sanitized (no `..`, no abs paths, no null/control chars, max 200 chars). Identical content (sha-256 match) MUST de-duplicate; collisions on different content MUST suffix `-<sha[:8]>` before the extension. Per-chat total bytes MUST be capped at `WORKSPACE_MAX_BYTES_PER_CHAT`; oldest-first eviction MUST be available via the workspace manager API even if not yet auto-triggered. | planned |
| F-12 | **Claude Code agent execution.** The service MUST drive `@anthropic-ai/claude-agent-sdk` `query()` with: cleaned messages, model, `cwd=<workspace>/<chatId>`, configured `maxTurns`, an `AbortController` that fires on `AGENT_TIMEOUT_MS`, `tools: { type:"preset", preset:"claude_code" }`, `systemPrompt: { type:"preset", preset:"claude_code" }`, `settingSources: ["project"]`, `permissionMode: "bypassPermissions"`, and `allowDangerouslySkipPermissions: true`. The bundled `claude` native executable from the SDK's platform package MUST be resolved explicitly and passed via `pathToClaudeCodeExecutable` to avoid SDK auto-detection failures on Alpine/virtiofs. | planned |
| F-13 | **Provider abstraction.** The runner MUST support at least two provider configurations selected by env: **Anthropic public API** when `ANTHROPIC_API_KEY` is set and `CLAUDE_CODE_USE_FOUNDRY` is not `1` (or unset). **Anthropic-on-Foundry** when `CLAUDE_CODE_USE_FOUNDRY=1` AND both `ANTHROPIC_FOUNDRY_API_KEY` and `ANTHROPIC_FOUNDRY_RESOURCE` are set. Exactly one provider must resolve at startup; ambiguous or partial configurations MUST throw `ConfigurationError` and exit 78. | planned |
| F-14 | **SSE adapter.** The Chat Completions SSE adapter MUST emit `chat.completion.chunk` payloads for every assistant text block (1:1 with SDK text deltas), render `tool_use` blocks as visible italic markdown of the form `\n\n*[<tool>: <truncated-input>]*\n`, emit a final `delta:{}, finish_reason:"stop"` chunk, and terminate with `data: [DONE]\n\n`. Mid-stream errors MUST emit a final SSE error chunk before `[DONE]` and MUST NOT silently truncate. | planned |
| F-15 | **Structured error envelope.** All errors MUST serialize as `{error:{type, message, ...details}}` with the documented HTTP status codes and `error.type` codes. | planned |
| F-16 | **Configuration with no fallbacks.** Required configuration variables that are missing MUST raise a typed `ConfigurationError` naming the variable and the process MUST exit with code 78. Optional variables MUST log their resolved value at INFO at startup (with secrets redacted). | planned |
| F-17 | **Expiring-credential warnings.** Each rotation-eligible credential variable MUST have a paired `*_EXPIRES_AT` ISO-8601 variable; at startup, if the value is within 30 days the service MUST log WARN; if past, ERROR. Service MUST still start in either case. | planned |
| F-18 | **Containerized deployment.** The service MUST ship a multi-stage `Dockerfile` producing a runnable image with a non-root user (`agent`, uid 1000) owning `/workspace`, exposing the configured listen port (default 8000), and starting the service as `node dist/index.js`. The image MUST be buildable and runnable with both Docker and Apple `container` (no platform-specific build steps). | planned |
| F-19 | **Operator runbook.** The repository MUST include a runbook documenting: building the image, generating a strong `AGENT_HOST_API_KEY` (`openssl rand -hex 32`), creating an `.env` file from `.env.example`, running the container with the documented mount points and port mapping, smoke-testing `/healthz` and `/v1/models`, and connecting an OpenAI SDK or Open WebUI client. | planned |
| F-20 | **OpenAI Responses API.** The service MUST also expose `POST /v1/responses` accepting the OpenAI Responses API request schema (`model`, `input` as string or message array with text + `input_image` parts, `stream`, `temperature`, `top_p`, `max_output_tokens`, `metadata.chat_id`, optional `files[]` extension), validated with Zod. Streaming responses MUST emit `text/event-stream` with the canonical Responses event sequence (`response.created`, `response.output_text.delta`, `response.output_text.done`, `response.completed`, terminating with `data: [DONE]\n\n`). Non-streaming responses MUST return the aggregated `Response` JSON object. Tool-use blocks from the Claude SDK MUST be surfaced as `response.output_text.delta` italic markdown the same way the Chat Completions adapter does, OR (preferred) as `response.output_item.added` items with `type:"reasoning"` if the consuming clients support it. The Responses adapter MUST share the SDK runner with `/v1/chat/completions`; only the surface mapping differs. | planned |
| F-21 | **Adapter selection.** The HTTP layer MUST route to the correct adapter based on the request path. Both endpoints MUST share `attachmentProcessor`, `workspaceManager`, the runner abstraction, and the configuration loader. | planned |

### Chat UI sub-application (FU-CU-*)

> Source: `docs/design/refined-request-chat-ui.md` FU-1 … FU-17. Lives under `chat-ui/` and is independent of the host service. Renamed to `FU-CU-*` here so the chat-ui requirements are distinguishable from the host service's `F-*`. See `docs/design/project-design.md` §14 and `docs/design/plan-004-chat-ui.md`.

| ID | Requirement (verbatim from refined-request-chat-ui.md) | Status |
|---|---|---|
| FU-CU-1 | Subfolder layout — `chat-ui/`, own `package.json`/`tsconfig.json`/`src/`/`README.md`, no import from host `src/`. | implemented |
| FU-CU-2 | TypeScript only; Node ≥ 22; ESM; strict TS. | implemented |
| FU-CU-3 | Browser SPA served by a local Fastify server bound to `127.0.0.1:<port>`. | implemented |
| FU-CU-4 | Three backend kinds: `agent-host-cc`, `openai`, `azure-openai`. | implemented |
| FU-CU-5 | Per-backend required fields per the FU-5 table; Zod-validated; loud failure on missing required fields. | implemented |
| FU-CU-6 | No fallback for required configuration; only `openai.baseUrl` and `CHAT_UI_PORT` have authorised defaults. | implemented |
| FU-CU-7 | Profiles persisted at `~/.agent-host-cc/chat-ui/profiles.json` with dir `0700`, file `0600`; revalidated on every read. | implemented |
| FU-CU-8 | Profile management UI: list, create, edit, delete (with confirm). | implemented |
| FU-CU-9 | Active-profile selector at the top of the chat surface; switch takes effect on next user message. | implemented |
| FU-CU-10 | Conversation continuity on profile switch; inline transcript banner shown. | implemented |
| FU-CU-11 | OpenAI Chat Completions wire format for all three backends; Azure path uses `/openai/deployments/{deployment}/chat/completions?api-version=…` with `api-key` header and no `model` in body. | implemented |
| FU-CU-12 | Streaming on by default; renders `chat.completion.chunk` deltas; finalises on `[DONE]`; surfaces mid-stream error chunks inline. | implemented |
| FU-CU-13 | Errors surfaced with HTTP status, upstream envelope, and a hint identifying the likely-faulty profile field. | implemented |
| FU-CU-14 | Minimal chat controls: input+send, transcript, profile selector, "new conversation" button. | implemented |
| FU-CU-15 | Independent dependency tree under `chat-ui/package.json`; root `package.json` not modified. | implemented |
| FU-CU-16 | Test scripts under `chat-ui/test_scripts/` (or formal tests under `chat-ui/test/`) covering schemas, request builder, SSE parser. | implemented (tests live under `chat-ui/test/`, an authorised variant per the FU-16 wording; see Issues-Pending CU-DEVIATION-1) |
| FU-CU-17 | Documentation updates: `plan-004-chat-ui.md`, project-design section, project-functions rows, `chat-ui/README.md`. | implemented |

## Non-functional requirements

| ID | Requirement (verbatim from refined-request.md) | Status |
|---|---|---|
| NF-1 | **Self-containment.** The new project MUST NOT import, reference, copy at runtime, or rely on any path inside `<source-repo>/`. A grep for `open-webui-phase1`, `phase1`, `claude-bridge`, `claude-skills`, `claude-artifact-server`, `cc-monitor`, or `pipelines` in the new project's source, configs, and docs MUST yield only intentional historical references in `docs/reference/` (clearly marked as historical context). | planned |
| NF-2 | **Conformance to project conventions.** All TypeScript, ESM, Node ≥ 22, Fastify, Zod, Pino, Undici, vitest. Test scripts (acceptance, smoke) live under `/test_scripts/`. Plans live under `/docs/design/plan-xxx-*.md`. Functional requirements are registered in `/docs/design/project-functions.md`. The complete design lives in `/docs/design/project-design.md`. Issue tracker at `/Issues - Pending Items.md`. | planned |
| NF-3 | **No silent fallbacks.** Required configuration MUST never silently fall back to a default. The single intentional derived-value exception (deterministic `chatId` hash when `metadata.chat_id` is absent) MUST be documented in `docs/design/project-design.md` AND in the project's CLAUDE.md memory exception list before being implemented. | planned |
| NF-4 | **Test coverage parity.** Every unit test in the source project's `test/unit/` tree MUST have an equivalent in the new project (potentially renamed/refactored to drop Open-WebUI-specific naming) and MUST pass green. Integration tests (`test/integration/`) MUST be ported with mocks renamed to neutral providers (e.g., `mockFoundry.ts` becomes `mockAnthropicProvider.ts` or similar; `mockOpenWebUI.ts` becomes `mockFilesApi.ts`). | planned |
| NF-5 | **Logging.** All logs MUST be JSON via Pino, with `req.headers.authorization`, base64 image bodies > 1 KB, and provider API keys redacted. | planned |
| NF-6 | **Body limit.** The Fastify server MUST accept request bodies up to 64 MB (to accommodate base64 image data URLs) and MUST surface body-too-large as a 413 with the structured error envelope, not as an opaque Fastify 500. | planned |

## Acceptance criteria cross-reference

| AC | Verifies | Plan |
|---|---|---|
| AC-1 | NF-1 self-contained build | plan-001 |
| AC-2 | NF-4 test parity | plan-001, plan-002, plan-003 |
| AC-3 | F-18 container build with uid=1000 | plan-001 |
| AC-4 | F-3 health probe | plan-001 |
| AC-5 | F-2, F-5 models + auth | plan-001 |
| AC-6 | F-13 Anthropic public path | plan-002 |
| AC-7 | F-13 Foundry path | plan-002 |
| AC-8 | F-7 image attachment | plan-001 (preserved by copy) |
| AC-9 | F-8 files[] handling | plan-001 (preserved by copy with rename) |
| AC-10 | F-9, F-10 URL fetch + SSRF | plan-001 (preserved by copy) |
| AC-11 | F-11 workspace size cap | plan-001 (preserved by copy) |
| AC-12 | F-4 workspace artifact serving | plan-001 (preserved by copy) |
| AC-13 | F-16 configuration error path | plan-002 (provider partial) |
| AC-14 | F-17 expiry warning | plan-001 + plan-002 (new var names) |
| AC-15 | NF-2 documentation completeness | Phase 5 / Designer |
| AC-16 | F-1 OpenAI SDK Chat Completions smoke | plan-002 (smoke script) |
| AC-17 | F-20 Responses API streaming | plan-003 |
| AC-18 | F-20 Responses API non-streaming | plan-003 |
| AC-19 | F-20 Responses API attachment parity | plan-003 |
| AC-20 | F-20 OpenAI SDK Responses smoke | plan-003 |
