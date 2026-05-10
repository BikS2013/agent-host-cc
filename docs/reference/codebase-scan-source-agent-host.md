---
language: TypeScript
runtime_version: ">=22.0.0"
framework: fastify@5
package_manager: npm (package-lock.json)
build_command: "npm run build"       # tsc -p tsconfig.json  → dist/
test_command: "npm test"             # vitest run
lint_command: null                   # no lint script; typecheck via tsc --noEmit
entry_points:
  - src/index.ts                     # process entry: loadConfig → buildApp → listen
  - src/httpServer.ts                # HTTP route registrations (POST /v1/chat/completions, GET /v1/models, GET /healthz, GET /files/:chatId/*)
dependencies:
  http_framework:
    - fastify@^5.0.0
    - "@fastify/multipart@^9.0.0"    # declared but not yet wired to any route
  validation:
    - zod@^4.0.0
  logging:
    - pino@^9.0.0                    # via Fastify's built-in logger option
  http_client:
    - undici@^6.0.0                  # used in filesApiFetcher.ts + remoteUrlFetcher.ts
  agent_sdk:
    - "@anthropic-ai/claude-agent-sdk@^0.2.138"
  test:
    - vitest@^2.1.0
    - tsx@^4.19.0                    # dev runner for `npm run dev`
  types:
    - "@types/node@^22.0.0"
    - typescript@^5.6.0
container_runtime:
  base_image: node:22-alpine
  stages: [deps, build, runtime]
  expose_port: 8000
  run_user: "agent (uid assigned by adduser -S, not pinned to 1000)"
  workspace_mount: /workspace
last_scanned_commit: 280be54d8bb5deb54191582215931ac808b4f3e8
scanned_for_request: refined-request.md
scanned_at: "2026-05-10T00:00:00Z"
---

# Codebase Scan — agent-host (source)

## 1. Project Overview

The source is a TypeScript/ESM service (`"type":"module"`, Node ≥ 22) built on Fastify v5.
It exposes an OpenAI-compatible HTTP surface that wraps the `@anthropic-ai/claude-agent-sdk`
`query()` call. Requests are authenticated with a bearer token, attachments (data URLs, remote
URLs, Files-API blobs) are pre-processed into a per-chat workspace directory on disk, and the
SDK is driven with the `claude_code` tool/system-prompt preset.  The project is currently
**hard-coupled to Azure AI Foundry** (CLAUDE_CODE_USE_FOUNDRY must equal `"1"`) and to **Open
WebUI's Files API** URL scheme.  The migration to `agent-host-cc` must remove both couplings.

---

## 2. Module Map — `src/`

| File | Purpose | Key exported symbols |
|---|---|---|
| `src/index.ts` | Process entry point. Calls `loadConfig`, wires workspace + attachment + runner, calls `buildApp`, starts listen. Emits expiry warnings. | `main()` |
| `src/config.ts` | Configuration loader. Reads env vars, validates required ones, returns typed `Config` object. Currently requires both `CLAUDE_CODE_USE_FOUNDRY=1` and OPENWEBUI vars. | `loadConfig`, `Config` |
| `src/errors.ts` | Typed error hierarchy. `AgentHostError` base → 9 concrete subclasses, each with `httpStatus`, `errorType`, and `toErrorEnvelope()`. | `AgentHostError`, `ConfigurationError`, `UnauthorizedError`, `InvalidRequestError`, `ModelNotFoundError`, `PayloadTooLargeError`, `UpstreamFilesFetchError`, `UpstreamUrlFetchError`, `UnsafeUrlError`, `AgentRunError`, `AgentTimeoutError` |
| `src/types.ts` | Zod schemas + TS types for the Chat Completions request body. `ChatCompletionRequestSchema` is the single Zod parse point for `POST /v1/chat/completions`. | `ChatCompletionRequestSchema`, `ChatCompletionRequest`, `Message`, `ContentPart`, `FileRef`, `AttachmentManifest` |
| `src/httpServer.ts` | Fastify app factory. Mounts all four HTTP routes, `requireAuth` helper, error handler (surfacing both `AgentHostError` and Fastify-native errors). Hard-codes `cc.` prefix strip. | `buildApp`, `HttpServerOptions`, `stripCcPrefix` (local), `deriveChatId` (local) |
| `src/agentRunner.ts` | Pure interface definition. Two types only — consumed by `httpServer.ts` and implemented by `claudeCodeRunner.ts`. | `AgentRunner`, `RunRequest` |
| `src/claudeCodeRunner.ts` | Sole `AgentRunner` implementation. Resolves the bundled `claude` native binary, drives `query()`, manages `AbortController` timeout, wraps errors. **Hard-codes Foundry env injection.** | `createClaudeCodeRunner`, `ClaudeCodeRunnerOptions`, `resolveClaudeExecutable` (local) |
| `src/openAiResponseAdapter.ts` | **Despite the name, emits Chat Completions SSE chunks** (`chat.completion.chunk` objects). See Section 6. | `adaptToOpenAiSse`, `SseHeader` |
| `src/workspaceManager.ts` | Disk workspace abstraction: sanitize filename/chatId, sha-256 dedup, collision suffix, per-chat byte cap (`PayloadTooLargeError`), oldest-first eviction. | `createWorkspaceManager`, `WorkspaceManager`, `WorkspaceManagerOptions` |
| `src/attachmentProcessor.ts` | Orchestrates all attachment sources per request. Calls dataUrlDecoder, remoteUrlFetcher, filesApiFetcher, urlDetector. Appends manifest note to last user message. | `createAttachmentProcessor`, `AttachmentProcessorOptions`, `ProcessInput`, `ProcessOutput` |
| `src/attachmentProcessor/dataUrlDecoder.ts` | Decodes `data:<mime>;base64,<payload>` strings to `Buffer`. MIME-to-extension mapping. | `decodeDataUrl`, `isDataUrl`, `DecodedDataUrl` |
| `src/attachmentProcessor/ssrfGuard.ts` | Async DNS-resolving SSRF guard. Rejects non-http(s) schemes and private/loopback/ULA/link-local addresses (IPv4 + IPv6). | `assertSafeUrl` |
| `src/attachmentProcessor/remoteUrlFetcher.ts` | Fetches a remote URL via undici, calls `assertSafeUrl` first (unless `ssrfBypass:true` for tests), streams with byte cap. | `fetchRemoteUrl`, `FetchOptions`, `FetchedRemote` |
| `src/attachmentProcessor/filesApiFetcher.ts` | Fetches a file from an upstream Files API. **Hard-codes the Open WebUI path template** `/api/v1/files/<id>/content`. Function named `fetchFromOpenWebUiFiles`. | `fetchFromOpenWebUiFiles`, `FilesApiOptions`, `FetchedFile` |
| `src/attachmentProcessor/urlDetector.ts` | Regex-based URL extractor. Strips fenced code and inline code regions first. | `extractUrls` |

---

## 3. File Inventory — `test/`

| File | Kind | Purpose / Notes |
|---|---|---|
| `test/unit/attachmentProcessor.test.ts` | unit | Tests the full `process()` pipeline: data URLs, remote URLs (with SSRF bypass), files[], URL detection |
| `test/unit/claudeCodeRunner.test.ts` | unit | Mocks SDK `query`. Verifies Foundry env injection (`CLAUDE_CODE_USE_FOUNDRY=1`, keys), cwd, timeout |
| `test/unit/config.test.ts` | unit | Validates `loadConfig` with all required vars, missing-var error, Foundry guard, MODEL_IDS CSV, optional overrides |
| `test/unit/dataUrlDecoder.test.ts` | unit | Encode/decode round-trips for PNG, JPEG, unknown MIME |
| `test/unit/errors.test.ts` | unit | `toErrorEnvelope()` shape for each subclass |
| `test/unit/filesApiFetcher.test.ts` | unit | Starts an inline HTTP server; tests bearer auth, 404 path → `UpstreamFilesFetchError` |
| `test/unit/httpServer.test.ts` | unit | Fastify inject tests: 401 without token, 422 on bad body, 404 on unknown model, cc. prefix strip, non-streaming path |
| `test/unit/openAiResponseAdapter.test.ts` | unit | Verifies Chat Completions chunk format, `tool_use` italic rendering, mid-stream error → error chunk + `[DONE]` |
| `test/unit/remoteUrlFetcher.test.ts` | unit | Fetches from inline HTTP server, byte cap enforcement, content-type → extension mapping |
| `test/unit/ssrfGuard.test.ts` | unit | Accepts public hostnames; rejects `127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `::1` |
| `test/unit/types.test.ts` | unit | Zod schema parse/reject cases for `ChatCompletionRequestSchema` |
| `test/unit/urlDetector.test.ts` | unit | URL extraction with code-block stripping |
| `test/unit/workspaceManager.test.ts` | unit | Write/dedup/collision/evict/size/path-traversal-protection |
| `test/integration/agentHost.integration.test.ts` | integration | Full Fastify inject with mocked SDK `query`; verifies image data URL written + forwarded as image block to SDK |
| `test/fixtures/mockFoundry.ts` | fixture | Starts an in-process HTTP server that accepts any POST and responds with configurable SSE chunks. Used by integration test. **Rename → `mockAnthropicProvider.ts`** |
| `test/fixtures/mockOpenWebUI.ts` | fixture | Starts an in-process HTTP server serving `/api/v1/files/<id>/content`. **Rename → `mockFilesApi.ts`** |

**vitest config:** `test/` glob, `environment: "node"`, `testTimeout: 10000ms`, coverage disabled.

---

## 4. Conventions & Patterns

- **Import style** — all imports use named imports with `.js` extensions (ESM, `"moduleResolution":"bundler"` in tsconfig). (`src/httpServer.ts:1-10`)
- **Error handling** — all errors extend `AgentHostError` and are serialized by `toErrorEnvelope()` in the single Fastify error handler; Fastify-native errors are surfaced via their `statusCode`/`code` properties rather than swallowed. (`src/httpServer.ts:39-63`)
- **Configuration** — `loadConfig(env)` accepts an env map (defaults to `process.env`), making it fully unit-testable without process mutation. No silent fallbacks for required keys; optional keys use inline `?? default`. (`src/config.ts:23-27`)
- **Factory pattern** — every stateful module is a factory function (`createWorkspaceManager`, `createAttachmentProcessor`, `createClaudeCodeRunner`, `buildApp`) returning a plain object or Fastify instance. No classes. (`src/workspaceManager.ts:48`)
- **Logging** — Fastify's built-in Pino logger with `redact: ["req.headers.authorization"]`. Log level from `process.env.LOG_LEVEL`. (`src/httpServer.ts:28-31`)
- **Zod v4** — uses `z.looseObject` (Zod v4 API, not v3's `z.object(...).passthrough()`). (`src/types.ts:33`)

---

## 5. Environment Variables Reference

| Variable | Required? | Default | Used in | Notes |
|---|---|---|---|---|
| `AGENT_HOST_API_KEY` | **required** | — | `config.ts:38`, `httpServer.ts:36` | Bearer token for all routes except `/healthz` |
| `ANTHROPIC_FOUNDRY_API_KEY` | **required** (today) | — | `config.ts:39`, `claudeCodeRunner.ts:78` | **Must become conditional** on provider selection |
| `ANTHROPIC_FOUNDRY_RESOURCE` | **required** (today) | — | `config.ts:40`, `claudeCodeRunner.ts:79` | **Must become conditional** on provider selection |
| `CLAUDE_CODE_USE_FOUNDRY` | **required** (today; must be `"1"`) | — | `config.ts:41-44`, `claudeCodeRunner.ts:79` | **Must become optional** (default: public API path) |
| `OPENWEBUI_BASE_URL` | **required** (today) | — | `config.ts:45`, `index.ts:26` | **Rename** → `FILES_API_BASE_URL` (generic) |
| `OPENWEBUI_API_KEY` | **required** (today) | — | `config.ts:46`, `index.ts:26` | **Rename** → `FILES_API_KEY` |
| `MODEL_IDS` | **required** | — | `config.ts:47-49` | CSV of allowed model IDs |
| `WORKSPACE_DIR` | optional | `"/workspace"` | `config.ts:58` | Container mount point |
| `WORKSPACE_MAX_BYTES_PER_CHAT` | optional | `209715200` (200 MB) | `config.ts:59` | Per-chat directory byte cap |
| `MAX_URL_FETCHES_PER_TURN` | optional | `5` | `config.ts:60` | SSRF-guarded URL fetch budget per request |
| `MAX_REMOTE_FETCH_BYTES` | optional | `52428800` (50 MB) | `config.ts:61` | Per-fetch byte cap for remote URLs and files API |
| `URL_FETCH_TIMEOUT_MS` | optional | `30000` | `config.ts:62` | HTTP client timeout |
| `AGENT_TIMEOUT_MS` | optional | `300000` (5 min) | `config.ts:63` | AbortController timeout for SDK `query()` |
| `AGENT_MAX_TURNS` | optional | `20` | `config.ts:64` | `maxTurns` passed to SDK |
| `LOG_LEVEL` | optional | `"info"` | `config.ts:65`, `httpServer.ts:29` | Pino log level |
| `LISTEN_PORT` | optional | `8000` | `config.ts:66` | Fastify listen port |
| `OPENWEBUI_API_KEY_EXPIRES_AT` | optional | — | `config.ts:67`, `index.ts:17` | **Rename** → `FILES_API_KEY_EXPIRES_AT`; ISO-8601 expiry for rotation warnings |
| `ANTHROPIC_FOUNDRY_API_KEY_EXPIRES_AT` | optional | — | `config.ts:68`, `index.ts:18` | ISO-8601 expiry; emits WARN (≤30 days) or ERROR (past) at startup |
| **`ANTHROPIC_API_KEY`** | **new (required when Foundry not selected)** | — | — | Not currently read; must be added for public API path |

**New variables required by F-13 provider abstraction:**

| Variable | Condition | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | required when `CLAUDE_CODE_USE_FOUNDRY` unset or `≠"1"` | Anthropic public API key; forwarded into SDK env |
| `ANTHROPIC_API_KEY_EXPIRES_AT` | optional | Expiry warning for public API key rotation |
| `FILES_API_PATH_TEMPLATE` | optional | Default: `/api/v1/files/{id}/content`. Allows non-OW backends. |
| `MODEL_PREFIX` | optional | Default `"cc."`. Configurable prefix strip in `stripCcPrefix`. |

---

## 6. The `openAiResponseAdapter.ts` — What It Actually Does

**The filename is a misnomer.** The module implements **Chat Completions SSE** (not the OpenAI
Responses API). Its exported function and the event objects it emits:

```
export async function* adaptToOpenAiSse(
  events: AsyncIterable<unknown>,
  header: SseHeader,              // { id, model, created }
): AsyncIterable<string>
```

SSE events emitted (all `chat.completion.chunk` object shape):

| Trigger | Emitted SSE chunk |
|---|---|
| SDK `assistant` event, `text` block | `deltaChunk(header, blk.text)` — `choices[0].delta.content = text` |
| SDK `assistant` event, `tool_use` block | `deltaChunk(header, "\n\n*[<name>: <truncated-input>]*\n")` — italic markdown |
| Stream end (normal) | `stopChunk(header)` — `choices[0].delta={}, finish_reason:"stop"` |
| Mid-stream error | `errorChunk(header, "agent_error", msg)` |
| Always in `finally` | `"data: [DONE]\n\n"` |

**Migration plan per refined-request.md:**
1. Rename the existing content → new file `openAiChatSseAdapter.ts`. Update import in `httpServer.ts`.
2. Implement a fresh `openAiResponseAdapter.ts` with the Responses API event sequence
   (`response.created`, `response.output_text.delta`, `response.output_text.done`, `response.completed`, `data:[DONE]`).
3. Mount both adapters in `httpServer.ts` on their respective paths.

---

## 7. Integration Points — Sanitization Targets (per NF-1)

The following occurrences must be sanitized in the new project. Every item is **in source code**
unless noted as a comment/string only.

### 7a. Coupling to Open WebUI (code + naming)

| File | Line(s) | Kind | Required change |
|---|---|---|---|
| `src/config.ts` | 7–8 | `Config` interface fields `openWebuiBaseUrl`, `openWebuiApiKey` | Rename fields → `filesApiBaseUrl`, `filesApiKey` |
| `src/config.ts` | 19 | `openWebuiApiKeyExpiresAt` field | Rename → `filesApiKeyExpiresAt` |
| `src/config.ts` | 45–46 | `required(env, "OPENWEBUI_BASE_URL")`, `required(env, "OPENWEBUI_API_KEY")` | Change env var names → `FILES_API_BASE_URL`, `FILES_API_KEY` |
| `src/config.ts` | 55–56 | Object literal keys `openWebuiBaseUrl`, `openWebuiApiKey` | Rename to match new field names |
| `src/config.ts` | 67 | `env.OPENWEBUI_API_KEY_EXPIRES_AT` | Change → `env.FILES_API_KEY_EXPIRES_AT` |
| `src/index.ts` | 17 | `warnIfNear("OPENWEBUI_API_KEY", ...)` | Update label + field reference |
| `src/index.ts` | 26 | `baseUrl: cfg.openWebuiBaseUrl, apiKey: cfg.openWebuiApiKey` | Update to renamed fields |
| `src/attachmentProcessor.ts` | 3 | Import of `fetchFromOpenWebUiFiles` | Rename import → `fetchFromFilesApi` |
| `src/attachmentProcessor.ts` | 87 | Call `fetchFromOpenWebUiFiles(...)` | Rename call → `fetchFromFilesApi(...)` |
| `src/attachmentProcessor/filesApiFetcher.ts` | 11 | Function `fetchFromOpenWebUiFiles` | Rename → `fetchFromFilesApi` |
| `src/attachmentProcessor/filesApiFetcher.ts` | 12 | Hard-coded path template `/api/v1/files/${id}/content` | Replace with configurable `FILES_API_PATH_TEMPLATE` |
| `src/errors.ts` | 69 | String `"Open WebUI files API returned..."` | Neutralize → `"Files API returned..."` |
| `src/httpServer.ts` | 25, 46 | Comments "from Open WebUI", "and Open WebUI" | Remove/neutralize (comments only) |
| `package.json` | 5 | `description` mentions "Open WebUI cc.* models" + `plan-002-typescript-agent-host.md` | Update description; remove plan reference |
| `test/fixtures/mockOpenWebUI.ts` | all | File and function name `startMockOpenWebUI` | Rename file → `mockFilesApi.ts`; rename function → `startMockFilesApi` |
| `test/integration/agentHost.integration.test.ts` | 23, 33 | Import + call of `startMockOpenWebUI` | Update to new fixture name |
| `test/unit/config.test.ts` | 10–11 | `OPENWEBUI_BASE_URL`, `OPENWEBUI_API_KEY` in test env | Update to `FILES_API_BASE_URL`, `FILES_API_KEY` |
| `test/unit/filesApiFetcher.test.ts` | 21, 23, 30 | `describe("fetchFromOpenWebUiFiles", ...)`, call sites | Rename describe block and calls |

### 7b. Coupling to Foundry (must become opt-in)

| File | Line(s) | Kind | Required change |
|---|---|---|---|
| `src/config.ts` | 39–44 | `required(env, "ANTHROPIC_FOUNDRY_API_KEY")`, `required(env, "ANTHROPIC_FOUNDRY_RESOURCE")`, guard `CLAUDE_CODE_USE_FOUNDRY !== "1"` | Replace with provider-selection logic: Foundry block only when `CLAUDE_CODE_USE_FOUNDRY=1`; add `ANTHROPIC_API_KEY` required for public path |
| `src/claudeCodeRunner.ts` | 8–13 | `ClaudeCodeRunnerOptions` fields `foundryApiKey`, `foundryResource` | Generalize to provider-neutral options: `{ apiKey, foundryResource?, useFoundry }` or split into two runner factories |
| `src/claudeCodeRunner.ts` | 77–80 | Hard-coded env block `CLAUDE_CODE_USE_FOUNDRY:"1"`, `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_RESOURCE` | Wrap in `if (opts.useFoundry)` branch; add `else` branch that sets only `ANTHROPIC_API_KEY` |
| `src/index.ts` | 36–40 | `createClaudeCodeRunner({ foundryApiKey, foundryResource, ... })` | Update call site to pass provider-aware options from `cfg` |
| `test/unit/claudeCodeRunner.test.ts` | 12–18, 27–30 | Verifies Foundry env injection; no public API test | Add public API path test; update runner options type |
| `test/fixtures/mockFoundry.ts` | all | Name `startMockFoundry` | Rename file → `mockAnthropicProvider.ts`; function → `startMockAnthropicProvider`; fixture is generic enough to reuse for both Foundry and public |

### 7c. `cc.` prefix — hard-coded vs configurable

| File | Line(s) | Kind | Required change |
|---|---|---|---|
| `src/httpServer.ts` | 20 | `const stripCcPrefix = (m: string) => m.startsWith("cc.") ? m.slice(3) : m;` | Replace with `MODEL_PREFIX`-aware strip; prefix read from config |
| `src/httpServer.ts` | 108 | `const model = stripCcPrefix(r.model);` | Already calls the helper — no change to call site, only the helper |

### 7d. Out-of-scope references to delete

| Item | Reason |
|---|---|
| Any reference to `cc-monitor`, `claude-bridge`, `claude-skills`, `claude-artifact-server`, `pipelines` | None exist in the source `agent-host/` tree — no deletion needed; guard against accidental re-introduction in new project |
| `@fastify/multipart` in dependencies | Declared in `package.json` but not imported anywhere in `src/`. **Remove** unless a future feature needs it. |

---

## 8. Dockerfile Analysis

**Stage 1 — `deps` (node:22-alpine)**
```
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
```
- Copies lockfile with a glob (`*`), which silently degrades to `npm install` if no lockfile is
  present. In the new project the lockfile will always exist after `npm ci`, so the `|| npm install`
  fallback should be dropped or kept deliberately.

**Stage 2 — `build` (node:22-alpine)**
```
COPY tsconfig.json ./ && COPY src ./src && RUN npm run build
```
- Runs `tsc` to emit `dist/`. No additional asset copying (no static files, no templates).

**Stage 3 — runtime (node:22-alpine)**
```
RUN addgroup -S agent && adduser -S agent -G agent && \
    mkdir -p /workspace && chown agent:agent /workspace
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER agent
EXPOSE 8000
CMD ["node", "dist/index.js"]
```
- `adduser -S` does **not** pin uid=1000; the Alpine default for the first system user created
  this way is uid=100 in older Alpine, uid=1000 in newer. If uid=1000 is a hard requirement
  (AC-3 wording), use `adduser -S -u 1000 agent` explicitly.
- `node_modules` is copied from the `deps` stage (prod deps only). The native SDK platform
  packages (`@anthropic-ai/claude-agent-sdk-linux-x64-musl` etc.) are inside `node_modules`
  and thus included automatically.
- **Alpine/virtiofs quirk:** On some Docker Desktop + virtiofs combinations, `createRequire`
  resolving the SDK's platform package path fails at runtime. `claudeCodeRunner.ts` already
  handles this: `resolveClaudeExecutable()` tries musl variant first, then glibc, and passes
  the resolved path via `pathToClaudeCodeExecutable`. If resolution fails it passes `undefined`
  and lets the SDK fall back to its own detection (which may fail silently). The new Dockerfile
  should also ensure the platform package for the target arch/musl is not pruned by `--omit=dev`.
  (It is a `dependency`, not `devDependency`, so it survives `--omit=dev`.)
- No `.dockerignore` entries that would prevent `node_modules` from being copied in the
  `deps` stage (the `.dockerignore` only excludes it from the build context, not from
  `COPY --from=deps`).

---

## 9. Integration Points — Per-Requirement Mapping (F-1 through F-21)

| Req | Source implementation | Status / Changes needed |
|---|---|---|
| F-1 Chat Completions | `httpServer.ts:98-147` | Copy as-is; update `stripCcPrefix` to use `MODEL_PREFIX` |
| F-2 Models endpoint | `httpServer.ts:67-73` | Copy as-is |
| F-3 Health endpoint | `httpServer.ts:65` | Copy as-is |
| F-4 Workspace artifact | `httpServer.ts:75-96` | Copy as-is |
| F-5 Bearer-token auth | `httpServer.ts:34-37` | Copy as-is |
| F-6 Model prefix strip | `httpServer.ts:20, 108` | Generalize: read prefix from `cfg.modelPrefix` (default `"cc."`) |
| F-7 Data URL attachment | `attachmentProcessor.ts:57-64`, `dataUrlDecoder.ts` | Copy as-is |
| F-8 Files[] attachment | `attachmentProcessor.ts:85-93`, `filesApiFetcher.ts` | Rename function; add path-template config |
| F-9 In-message URL fetch | `attachmentProcessor.ts:43-51`, `urlDetector.ts` | Copy as-is |
| F-10 SSRF guard | `ssrfGuard.ts` | Copy as-is |
| F-11 Per-chat workspace | `workspaceManager.ts` | Copy as-is |
| F-12 SDK execution | `claudeCodeRunner.ts` | Add public API provider branch; keep `resolveClaudeExecutable` |
| F-13 Provider abstraction | **Not implemented** in source | New: conditional provider selection in `config.ts` + `claudeCodeRunner.ts` |
| F-14 SSE adapter | `openAiResponseAdapter.ts` | Rename file → `openAiChatSseAdapter.ts`; keep implementation |
| F-15 Structured error envelope | `errors.ts`, `httpServer.ts:39-63` | Copy as-is |
| F-16 Config no fallbacks | `config.ts:23-27` | Copy `required()` helper; update required var list for F-13 |
| F-17 Expiry warnings | `index.ts:11-18` | Copy; update to cover new `FILES_API_KEY_EXPIRES_AT` + `ANTHROPIC_API_KEY_EXPIRES_AT` |
| F-18 Containerized deployment | `Dockerfile` | Copy; pin uid=1000 explicitly |
| F-19 Operator runbook | Not in source `src/` | New: `docs/how-to/deploy-locally.md` |
| F-20 Responses API | **Not implemented** | New: fresh `openAiResponseAdapter.ts` (Responses event stream) |
| F-21 Adapter selection | **Not implemented** | New: route `/v1/responses` in `httpServer.ts` to new adapter |

**Out of scope modules** (must not be touched during migration):
- `src/workspaceManager.ts` — logically complete; no Open-WebUI coupling.
- `src/attachmentProcessor/dataUrlDecoder.ts` — no coupling; copy verbatim.
- `src/attachmentProcessor/ssrfGuard.ts` — no coupling; copy verbatim.
- `src/attachmentProcessor/urlDetector.ts` — no coupling; copy verbatim.
- `src/attachmentProcessor/remoteUrlFetcher.ts` — no coupling; copy verbatim.
- `src/agentRunner.ts` — pure interface; copy verbatim.
- `src/errors.ts` — single string fix at line 69 only.
- `src/types.ts` — copy verbatim; add new `ResponsesRequestSchema` for F-20.

---

## 10. Notes

- **`@fastify/multipart` is undeclared dead weight.** It is listed in `dependencies` but not imported anywhere in `src/`. Remove it in `agent-host-cc` unless multipart form uploads are planned.
- **`WORKSPACE_DIR` has a silent fallback** (`?? "/workspace"` at `config.ts:58`). This is an intentional exception to the no-fallback rule (the default is the documented container mount point). Must be registered in CLAUDE.md's exception list per NF-3 before implementation, alongside the `deriveChatId` fallback (`httpServer.ts:152-158`).
- **No `MODEL_PREFIX` config today.** The `cc.` strip is hard-coded in `httpServer.ts:20`. The new project must expose this as an optional env var with default `"cc."` (per F-6 requirement).
- **`@fastify/multipart` aside, no devDependency is a `dependency` by mistake** — the SDK platform packages install transitively from `@anthropic-ai/claude-agent-sdk`, which is a runtime dep, so they survive `--omit=dev` correctly.
