---
language: typescript
framework: fastify
package_manager: npm
build_command: "tsc -p tsconfig.json"
test_command: "vitest run"
lint_command: null
entry_points:
  - src/index.ts
last_scanned_commit: null
scanned_for_request: refined-request-chat-ui.md
scanned_at: "2026-05-10T18:15:00Z"
---

# Codebase Scan — agent-host-cc

## 1. Project Overview

`agent-host-cc` is a TypeScript/Node ≥ 22 service (ESM, strict mode) that wraps
the Anthropic Claude Code agent SDK and exposes it through OpenAI-compatible
Chat Completions (`POST /v1/chat/completions`) and Responses (`POST /v1/responses`)
HTTP endpoints via Fastify 5. The project uses npm for package management, `tsc`
for compilation to `dist/`, `tsx` for dev-time hot reload, and vitest for all
tests. Container images are built by shell scripts under `scripts/` and run as
a self-contained Docker / Apple Container image; the service binds to
`0.0.0.0:<LISTEN_PORT>` (default 8000). The repo is **not** under git version
control at the time of scanning.

---

## 2. Module Map

| Path | Purpose | Representative symbols |
|---|---|---|
| `src/index.ts` | Process entry point — calls `loadConfig`, wires up all subsystems, starts Fastify | `main`, `warnIfNear` |
| `src/httpServer.ts` | Fastify app factory — mounts all routes, auth guard, error handler, SSE flush | `buildApp`, `requireAuth`, `deriveChatId` |
| `src/types.ts` | All Zod request schemas + TypeScript type exports for both API surfaces | `ChatCompletionRequestSchema`, `ResponsesRequestSchema`, `MessageSchema`, `FileRefSchema` |
| `src/config.ts` | Config loader — reads `process.env`, enforces no-fallback rule via `required()`, returns typed `Config` | `loadConfig`, `required`, `intOr`, `resolveProvider` |
| `src/errors.ts` | Typed error hierarchy — every `AgentHostError` subclass carries `httpStatus`, `errorType`, and an `{ error: … }` envelope | `AgentHostError`, `ConfigurationError`, `UnauthorizedError`, `InvalidRequestError`, `ModelNotFoundError` |
| `src/claudeCodeRunner.ts` | SDK adapter — instantiates the Anthropic Claude Code agent, yields raw SDK events as `AsyncIterable<unknown>` | `createClaudeCodeRunner` |
| `src/agentRunner.ts` | Runner interface definition (`AgentRunner` + `RunRequest`); keeps httpServer decoupled from SDK | `AgentRunner`, `RunRequest` |
| `src/openAiChatSseAdapter.ts` | Converts raw SDK event stream → OpenAI Chat Completion SSE wire format (delta chunks, stop chunk, `[DONE]`) | `adaptToOpenAiSse`, `deltaChunk`, `stopChunk`, `errorChunk` |
| `src/openAiResponseAdapter.ts` | Converts SDK event stream → OpenAI Responses API SSE event sequence; also aggregates for non-streaming path | `adaptToOpenAiResponseSse`, `aggregateResponsesNonStreaming`, `translateResponsesInputToMessages` |
| `src/attachmentProcessor.ts` | Pre-processes `files[]` / inline `image_url` / remote URLs before forwarding to agent | `createAttachmentProcessor` |
| `src/attachmentProcessor/` | Sub-modules: `dataUrlDecoder.ts`, `filesApiFetcher.ts`, `remoteUrlFetcher.ts`, `ssrfGuard.ts`, `urlDetector.ts` | (utility helpers) |
| `src/workspaceManager.ts` | Per-chat disk workspace lifecycle (create, size-check, cleanup) | `createWorkspaceManager` |
| `test/unit/` | Vitest unit tests — one file per source module (15 files) | — |
| `test/integration/` | Vitest integration tests — full Fastify app against mock provider (2 files) | — |
| `test/fixtures/` | Shared mock helpers: `mockAnthropicProvider.ts`, `mockFilesApi.ts` | — |
| `scripts/` | Shell scripts for container build/run/stop across Docker and Apple Container backends (9 files) | — |
| `docs/design/` | Plans 001–003, project-design.md, project-functions.md, configuration-guide.md | — |
| `docs/reference/` | Reference material (prior scans, dependency validation, verification reports) | — |

---

## 3. Conventions

- **Named, side-effect-free exports; no default exports.** Every module exports
  named functions / interfaces. `src/index.ts` is the only file with a top-level
  `main()` side-effect. (observed: `src/httpServer.ts:33`, `src/config.ts:73`,
  `src/openAiChatSseAdapter.ts:29`)

- **Zod schemas are the single source of truth for wire types.**
  `z.looseObject()` (Zod 4 API) is used for request bodies so extra fields
  do not trigger validation failure; discriminated unions cover content parts.
  TypeScript types are derived via `z.infer<…>`. (observed: `src/types.ts:3–106`)

- **Strict no-fallback config rule enforced by `required()` helper.**
  Any required env var that is absent or empty throws `ConfigurationError` —
  no silent defaults. Optional numeric fields use `intOr()` with an explicit
  documented default. The pattern is: `const v = required(env, "VAR_NAME")`.
  (observed: `src/config.ts:32–44`)

- **Error responses always use `{ error: { type, message, …extras } }` envelope.**
  `AgentHostError.toErrorEnvelope()` builds this shape; Fastify's `setErrorHandler`
  catches all `AgentHostError` subclasses and non-2xx Fastify errors, preventing
  unstructured 500 leakage. (observed: `src/errors.ts:17–22`, `src/httpServer.ts:55–78`)

- **SSE is written directly to `reply.raw`.**
  Content-type `text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`
  headers are set manually; the async generator yields `data: …\n\n` strings;
  the sequence always ends with `data: [DONE]\n\n` in a `finally` block even on
  mid-stream errors. (observed: `src/httpServer.ts:155–162`, `src/openAiChatSseAdapter.ts:48–54`)

- **Tests use vitest with named `describe`/`it` blocks and async generator fakes.**
  No mocking framework; test doubles are inline async generator functions or
  small factory helpers in `test/fixtures/`. Import paths use `.js` extensions
  (ESM-compatible). (observed: `test/unit/openAiChatSseAdapter.test.ts:1–36`,
  `test/fixtures/mockAnthropicProvider.ts`)

---

## 4. Integration Points

### In-Scope (chat-ui must consume / produce compatible payloads)

**Chat Completions endpoint — primary surface for all three backends.**

- **Location:** `src/httpServer.ts:114–163` / route `POST /v1/chat/completions`
- **Auth:** `Authorization: Bearer <AGENT_HOST_API_KEY>` (exact bearer match checked
  in `requireAuth`, `src/httpServer.ts:50–53`). HTTP 401 on mismatch.
- **Request shape** (Zod-validated, `src/types.ts:33–42`):
  ```
  {
    model: string,           // must match a MODEL_IDS entry after stripping MODEL_PREFIX
    messages: Message[],     // array of { role, content } — min 1
    stream?: boolean,        // omit or true → SSE; false → JSON aggregate
    temperature?: number,
    top_p?: number,
    max_tokens?: number,
    metadata?: { chat_id?: string },
    files?: FileRef[]        // extension; out of scope for chat-ui v1
  }
  ```
  `Message.role` is `"system" | "user" | "assistant"`.
  `Message.content` is `string | ContentPart[]` where `ContentPart` is either
  `{ type: "text", text }` or `{ type: "image_url", image_url: { url, detail? } }`.
  Extra top-level fields are allowed (`z.looseObject`).
- **Streaming response wire format** (SSE, `src/openAiChatSseAdapter.ts`):
  - Each line: `data: <JSON>\n\n`
  - Delta chunk: `{ id, object:"chat.completion.chunk", created, model, choices:[{ index:0, delta:{ content:"…" }, finish_reason:null }] }`
  - Stop chunk: same shape with `delta:{}` and `finish_reason:"stop"`
  - Error chunk: `{ …, error:{ type, message } }` — still followed by `[DONE]`
  - Terminal line: `data: [DONE]\n\n`
- **Non-streaming response** (when `stream: false`):
  `{ id, object:"chat.completion", created, model, choices:[{ index:0, message:{ role:"assistant", content:string }, finish_reason:"stop" }] }`
- **Error envelope** (all error HTTP statuses): `{ error: { type, message, …extras } }`
  — types defined in `src/errors.ts:1–12` (e.g. `"unauthorized"`, `"invalid_request"`,
  `"model_not_found"`).
- **Model name matching:** inbound `model` value is stripped of `MODEL_PREFIX`
  (default `"cc."`) before checking against `MODEL_IDS`. Chat-ui profile's
  `defaultModel` must therefore include the prefix if the server is configured
  with the default prefix (e.g. `"cc.claude-sonnet-4-6"`).

**Responses endpoint — out of scope for chat-ui v1 but documented for completeness.**

- **Location:** `src/httpServer.ts:165–211` / route `POST /v1/responses`
- **Auth:** same `Authorization: Bearer` scheme.
- **Request shape** (Zod-validated, `src/types.ts:91–100`):
  ```
  {
    model: string,
    input: string | ResponsesInputMessage[],
    stream?: boolean,
    temperature?: number,
    top_p?: number,
    max_output_tokens?: number,
    metadata?: { chat_id?: string },
    files?: ResponsesFileRef[]
  }
  ```
- **Streaming SSE sequence** (Responses API event set):
  `response.created` → `response.in_progress` → `response.output_item.added` →
  `response.content_part.added` → `response.output_text.delta` (× N) →
  `response.output_text.done` → `response.content_part.done` →
  `response.output_item.done` → `response.completed` → `data: [DONE]\n\n`
  (see `src/openAiResponseAdapter.ts:10–17`)

**Zod schema compatibility — the UI must produce payloads that pass `ChatCompletionRequestSchema.safeParse`.**

- **Location:** `src/types.ts:33–42`
- `model` must be a non-empty string. `messages` must be a non-empty array.
  `stream`, `temperature`, `top_p`, `max_tokens` are optional. `files` is optional
  and out of scope for chat-ui v1.
- The schema uses `z.looseObject` so additional fields (e.g. `user`) are silently
  dropped, not rejected.
- Validation failure returns HTTP 422 with `{ error: { type:"invalid_request",
  message, issues:[{ path, message }] } }` (`src/httpServer.ts:116–122`).

**SSE wire format — the UI's SSE parser must handle these lines.**

- **Location:** `src/openAiChatSseAdapter.ts:12–27`
- The only SSE field used is `data:`; no `id:` or `event:` fields are emitted.
- `data: [DONE]` is the terminal sentinel (not a JSON object).
- An error mid-stream emits one `data: { …, error:{ type, message } }` chunk
  then `data: [DONE]` — the stream is not abruptly closed.
- Tool-use calls appear as delta text with the pattern `\n\n*[<toolName> …]*\n`
  embedded in the `content` field (italic-markdown shim).

**Config patterns — the chat-ui must replicate the same pattern internally.**

- **Location:** `src/config.ts:32–44`
- `required(env, "NAME")` throws `ConfigurationError` on missing/empty values.
- `intOr(env, "NAME", default)` is the only permitted pattern for numeric
  optional settings with a documented default.
- The two permitted explicit defaults in chat-ui v1 are: `CHAT_UI_PORT` → `5173`
  and `openai.baseUrl` → `https://api.openai.com`.
- Any additional default introduced must be recorded in CLAUDE.md
  "Configuration Fallback Exceptions" before merging (per FU-6 / NF-3).

**Models endpoint — optional, but useful for UI validation.**

- **Location:** `src/httpServer.ts:83–89` / route `GET /v1/models`
- Returns `{ object:"list", data:[{ id, object:"model", created:0, owned_by:"agent-host" }] }`
- Auth required. Chat-ui may call this on profile save to validate `defaultModel`.

### Out of Scope (modules the chat-ui must NOT touch)

The following source modules are entirely internal to the agent-host-cc service.
The chat-ui is a pure HTTP client; it must not import from `../src/` under any
circumstances (per FU-1).

| Module | Reason out of scope |
|---|---|
| `src/claudeCodeRunner.ts` | Agent SDK wiring — server-internal only |
| `src/agentRunner.ts` | Interface consumed only by httpServer — server-internal |
| `src/attachmentProcessor.ts` + `src/attachmentProcessor/` | Attachment pre-processing — server-side |
| `src/workspaceManager.ts` | Disk workspace lifecycle — server-side |
| `src/openAiResponseAdapter.ts` | Responses endpoint adapter — not called by chat-ui v1 |
| `scripts/` | Container build/run scripts — deployment only |
| `test/` | Host service tests — not part of chat-ui |

### New Integration Points (not currently in the codebase)

The following are required by the chat-ui but do not exist in the repo today:

| Item | Recommended landing location |
|---|---|
| `chat-ui/` subfolder (new sub-application) | `/Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/` — do NOT modify root `package.json` |
| Profile Zod schemas (3 backend kinds) | `chat-ui/src/profiles/schemas.ts` |
| URL + headers builder per backend kind | `chat-ui/src/profiles/requestBuilder.ts` |
| SSE parser for `chat.completion.chunk` | `chat-ui/src/sse/parser.ts` |
| Profile disk storage (`~/.agent-host-cc/chat-ui/profiles.json`) | `chat-ui/src/profiles/storage.ts` |
| Fastify dev server (SPA host) | `chat-ui/src/server.ts` |
| Frontend SPA entry | `chat-ui/src/ui/` (React/Preact or vanilla — implementer choice) |
| Unit tests | `chat-ui/test_scripts/` (per project convention) |
| `ConfigurationError` equivalent for chat-ui | `chat-ui/src/errors.ts` — mirror the `{ error: { type, message } }` shape |

---

## 5. Notes

- **No git history.** `git rev-parse HEAD` failed; `last_scanned_commit` is null.
  Downstream phases cannot use git blame or short-SHA references for this repo.

- **`test_scripts/` folder exists but is empty.** The project convention requires
  test scripts in `test_scripts/`, but only the formal `test/` directory has
  content. The chat-ui must place its vitest tests under `chat-ui/test_scripts/`
  per the project convention (FU-16).

- **Zod 4 API in use (`z.looseObject`).** The codebase uses Zod 4 (`"zod": "^4.0.0"`),
  which introduced `z.looseObject` as a replacement for `z.object().passthrough()`.
  The chat-ui profile schemas must also use Zod 4 to stay consistent and avoid
  a dual-version dependency tree.

- **Model prefix stripping is server-side only.** The server strips `MODEL_PREFIX`
  (default `"cc."`) from the inbound `model` field before matching against
  `MODEL_IDS`. Chat-ui profiles that target the local backend must therefore
  include the prefix in `defaultModel` (e.g. `"cc.claude-sonnet-4-6"`), not the
  bare Claude model name. This is a non-obvious footgun worth calling out in the
  chat-ui README and profile-creation form hint text.
