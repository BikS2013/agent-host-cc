# Plan 004 — Chat UI Sub-Application (`chat-ui/`)

> **Status:** Drafted 2026-05-10. Ready for implementation.
> **Inputs:**
> - Refined request: `docs/design/refined-request-chat-ui.md` (FU-1 … FU-17, AC-CU-1 … AC-CU-12, A-1 … A-12).
> - Codebase scan: `docs/reference/codebase-scan-chat-ui.md` (integration points 1–7).
> - Investigation: `docs/design/investigation-chat-ui.md` (recommendations 1–8: Vite + Preact + signals; `@fastify/static` + SPA fallback; hand-rolled `requestBuilder`; `undici.request` + `pipeline` SSE relay; Zod 4 discriminated union; `@preact/signals`; fail-fast bootstrap of `~/.agent-host-cc/chat-ui/`; vitest split).
> - User confirmations on the Open Questions banner: Q-1 browser SPA, Q-4 API-key only, Q-5 preserve history on profile switch, Q-8 sub-application (NOT routed through `/tool-conventions scaffold`).
>
> **Exemption:** Per A-11 / Q-8 confirmation, this sub-app is exempt from `/tool-conventions scaffold`. Do NOT instruct any phase to invoke the tool-doc-config-architect subagent.
>
> **Root location:** `chat-ui/`. The host service's `src/` MUST NOT be modified by this plan.

---

## Open decisions (chosen defaults — flag overrides before merge)

These were ambiguous in the inputs; the plan picks a sensible default for each and records the override path so a reviewer can flip the choice without re-planning.

| # | Decision | Default chosen | Override path |
|---|---|---|---|
| OD-1 | Dev-mode topology | **Two ports during dev**: Vite dev server on `5173` (HMR) proxying `/api/*` to Fastify on `5174`. **Production-like `npm run start`** runs Fastify alone on `CHAT_UI_PORT` (default `5173`) and serves both static and `/api`. | If HMR is not desired, drop the dev script and run `vite build --watch` + `tsx watch server` on a single port — record the change in `chat-ui/README.md`. |
| OD-2 | Profile listing on the wire | `apiKey` is **redacted** (`***`) in `GET /api/profiles` payloads; the SPA never receives raw keys. The proxy (`POST /api/chat`) reads the on-disk profile server-side. A `GET /api/profiles/:name?reveal=true` endpoint is provided ONLY when the form's "reveal" toggle is clicked. | If the user wants raw keys in the SPA, remove the redaction (NOT recommended; widens key exposure). |
| OD-3 | Profile-switch banner format | A synthetic transcript entry with role `system` and content `— switched to profile "<name>" —`, rendered with a distinct style. Stored in the same `messages` signal but tagged with `kind: "switch-banner"` so it is NOT forwarded upstream. | If the user wants the banner rendered out-of-band (toast), move it from the `messages` signal into a separate `notices` signal. |
| OD-4 | REST shape for `/api/profiles*` | `GET /api/profiles` (list, redacted), `POST /api/profiles` (create), `PUT /api/profiles/:name` (update), `DELETE /api/profiles/:name`, `GET /api/profiles/:name?reveal=true` (single-shot reveal), `POST /api/profiles/:name/activate` (sets server-side default; the SPA may also pass `profileName` in `POST /api/chat`). | If the user prefers SPA-only active-profile state, drop the activate endpoint and pass `profileName` on every chat call. |
| OD-5 | `agent-host-cc` model-prefix UX | Profile-creation form for `backendKind=agent-host-cc` calls `GET {baseUrl}/v1/models` (with `Authorization: Bearer {apiKey}`) on Save and offers the returned IDs as suggestions. The hint text reads: *"Include the server's `MODEL_PREFIX` (default `cc.`), e.g. `cc.claude-sonnet-4-6`."* | If the host's `/v1/models` is unreachable, fall back to a free-text input — the form must NOT block save on a `/v1/models` failure. |
| OD-6 | TS layout | **One `package.json` at `chat-ui/`** with two TS configs: `tsconfig.server.json` (server build → `dist-server/`) and `tsconfig.json` (client, used by Vite). Both extend a shared `tsconfig.base.json`. | If a clean monorepo split is preferred later, lift the client into `chat-ui/client/` with its own `package.json`. |
| OD-7 | `apiKey` storage on disk | Plaintext inside `profiles.json` with file mode `0600` and dir mode `0700`, per FU-7. No OS-keychain integration in v1. | If keychain integration is later required, introduce an `apiKeyRef` field referencing keychain entries; update Zod schema and storage. |

---

## Phase summary

| Phase | Title | Depends on | Parallelizable with |
|---|---|---|---|
| 0 | Repo scaffolding | — | — |
| 1 | Server config bootstrap + errors | 0 | — |
| 2 | Profile schema (Zod) | 0 | 1 |
| 3 | Profile storage (filesystem) | 1, 2 | — |
| 4 | Request builder (per backend) | 2 | 3 |
| 5 | Chat relay (Fastify route + undici + SSE) | 1, 3, 4 | — |
| 6a | Profile REST routes + Fastify wiring | 1, 3 | 6b, 6c |
| 6b | SPA shell (Vite + Preact + signals) | 0 | 6a, 6c |
| 6c | SPA components (Profile editor, transcript, composer) | 6b | 6a |
| 7 | Server static-serve + SPA fallback | 5, 6a, 6b | — |
| 8 | Tests (unit + integration) | 2, 3, 4, 5 | partially with 6 |
| 9 | README + design doc updates | all | — |
| 10 | Verification & AC sign-off | all | — |

**Dependencies summary:**
- Schema (Phase 2) blocks every branch that imports profile types: 3, 4, 5, 6a, 6c, 8.
- Errors (Phase 1) are imported by 3, 5, 6a.
- Storage (Phase 3) is consumed by 5 and 6a.
- Request builder (Phase 4) is consumed by 5.
- The SPA branch (6b, 6c) has no server runtime dep until Phase 7 wires static serving — so it can start in parallel with 6a as soon as Phase 0 finishes.

**Phase 6 parallelization (for the orchestrator's coder split):**
- **Coder A** → 6a (server REST routes + Fastify wiring): files under `chat-ui/server/`.
- **Coder B** → 6b (SPA shell + state): files under `chat-ui/client/src/main.ts`, `state.ts`, `lib/`.
- **Coder C** → 6c (SPA components): files under `chat-ui/client/src/components/`.
- File sets are disjoint; only the shared TypeScript types in `chat-ui/server/profileSchema.ts` are read by all three (already produced by Phase 2). Phase 6c imports the signals defined in 6b (`state.ts`); start 6c shortly after 6b's signal contract is stable, or have 6b stub the signal exports first so 6c can begin against the contract.

---

## Phase 0 — Repo scaffolding

**Goal:** Create the `chat-ui/` folder with package manifests, TS configs, and a Vite config. No source logic yet.

**Files to create (all under `chat-ui/`):**

- `chat-ui/package.json`
  - Name: `agent-host-cc-chat-ui`. Private. Type: `module`. Engines `node >= 22`.
  - Direct deps: `fastify@^5`, `@fastify/static@^7`, `undici@^6`, `zod@^4`, `preact@^10`, `@preact/signals@^1`.
  - Dev deps: `vite@^5`, `@preact/preset-vite@^2`, `typescript@^5`, `tsx@^4`, `vitest@^1`, `@types/node@^22`.
  - Scripts:
    - `dev:server`: `tsx watch server/index.ts`
    - `dev:ui`: `vite`
    - `dev`: runs both in parallel (use `npm-run-all` OR document running each in two terminals — pick `npm-run-all` to keep it one command; add it as a devDep)
    - `build:server`: `tsc -p tsconfig.server.json`
    - `build:ui`: `vite build`
    - `build`: `npm run build:server && npm run build:ui`
    - `start`: `node dist-server/index.js` (production-like single-port mode)
    - `typecheck`: `tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.json --noEmit`
    - `test`: `vitest run`
- `chat-ui/tsconfig.base.json` — shared compiler options (strict, ESM, ES2022 target, JSX `preserve`/`preact`).
- `chat-ui/tsconfig.json` — extends base; client-side; includes `client/`. JSX importSource `preact`.
- `chat-ui/tsconfig.server.json` — extends base; server-side; includes `server/`; `outDir: "dist-server"`.
- `chat-ui/vite.config.ts` — `@preact/preset-vite`; `root: "client"`; `build.outDir: "../dist-ui"` (relative to `client/`); dev `server.port: 5173`; `server.proxy = { "/api": "http://127.0.0.1:5174" }`.
- `chat-ui/.gitignore` — ignores `node_modules/`, `dist-server/`, `dist-ui/`, `.env`.
- `chat-ui/test_scripts/.gitkeep` — fulfils project convention (test scripts under `test_scripts/`).

**Acceptance:** `cd chat-ui && npm install` succeeds; `npm run typecheck` exits 0 (no source files yet but configs valid); `npm run build` exits 0 with empty/placeholder outputs.

**Maps to AC:** AC-CU-1 (precondition).

---

## Phase 1 — Server config bootstrap + errors

**Goal:** Implement the `~/.agent-host-cc/chat-ui/` bootstrap and the typed error hierarchy. No silent fallbacks except the two authorised defaults (`CHAT_UI_PORT=5173`, `openai.baseUrl=https://api.openai.com`).

**Files:**

- `chat-ui/server/errors.ts`
  - `ChatUiError` base (carries `httpStatus`, `errorType`, `toEnvelope()` returning `{ error: { type, message, …extras } }`, mirroring the host service's `src/errors.ts:17–22`).
  - `ConfigurationError extends ChatUiError` (HTTP 500, `type: "configuration"`).
  - `ProfileNotFoundError extends ChatUiError` (HTTP 404, `type: "profile_not_found"`, includes `profileName`).
  - `ProfileValidationError extends ChatUiError` (HTTP 422, `type: "invalid_profile"`, includes `issues: { path, message }[]`).
  - `UpstreamError extends ChatUiError` (HTTP 502, `type: "upstream_error"`, includes upstream `status`, `body` excerpt).
- `chat-ui/server/config.ts`
  - Exports `loadServerConfig(): { port: number; profilesPath: string; configDir: string }`.
  - `port` from `CHAT_UI_PORT` (default `5173`; `0` is allowed and means OS-assigned).
  - `profilesPath` from `CHAT_UI_PROFILES_PATH` or `~/.agent-host-cc/chat-ui/profiles.json`.
  - `bootstrapConfigDir(configDir, profilesPath)`: ensures the directory exists with mode `0700` and the file exists with mode `0600` (initialised to `{ "profiles": [] }`). Uses `fs.mkdir({ recursive: true, mode: 0o700 })` and `fs.open` with `O_CREAT|O_EXCL` then `chmod 0o600` on first creation; on existing files, asserts the mode and warns (but does not refuse to start) if mode is looser than `0600`.
  - No fallback for any other env var. If introduced, must be added to project CLAUDE.md "Configuration Fallback Exceptions" first (per FU-6).

**Acceptance:** Unit test: starting the server with no env creates `~/.agent-host-cc/chat-ui/profiles.json` with `0600` and parent dir with `0700`. `stat` confirms perms. `CHAT_UI_PROFILES_PATH=/tmp/foo.json` overrides the path.

**Maps to AC:** AC-CU-7, AC-CU-12.

---

## Phase 2 — Profile schema (Zod 4 discriminated union)

**Goal:** Single source of truth for profile shape. Per-`backendKind` validation matching FU-5 exactly.

**Files:**

- `chat-ui/server/profileSchema.ts`
  - `ProfileBaseFieldsSchema` — `name` (non-empty trimmed string), optional `systemPrompt`, optional `temperature` (number ≥ 0 ≤ 2), optional `maxTokens` (positive int).
  - `AgentHostProfileSchema` — `backendKind: z.literal("agent-host-cc")`, `baseUrl: z.string().url()`, `apiKey: z.string().min(1)`, `defaultModel: z.string().min(1)`. Hint comment: must include `MODEL_PREFIX` (typically `cc.`).
  - `OpenAiProfileSchema` — `backendKind: z.literal("openai")`, `baseUrl: z.string().url().default("https://api.openai.com")` (the only schema-level default authorised in FU-6), `apiKey: z.string().min(1)`, `defaultModel: z.string().min(1)`.
  - `AzureOpenAiProfileSchema` — `backendKind: z.literal("azure-openai")`, `endpoint: z.string().url()`, `deployment: z.string().min(1)`, `apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}(-preview)?$/)`, `apiKey: z.string().min(1)`. No `defaultModel`, no `baseUrl`.
  - `ProfileSchema = z.discriminatedUnion("backendKind", [AgentHostProfileSchema, OpenAiProfileSchema, AzureOpenAiProfileSchema]).and(ProfileBaseFieldsSchema)` — or compose via `z.intersection` if discriminatedUnion + and is awkward. Confirm Zod 4 idiom (the host project already uses Zod 4 discriminated unions in `src/types.ts`).
  - `ProfilesFileSchema = z.object({ profiles: z.array(ProfileSchema) }).refine(unique-by-name)`.
  - Exports TS types via `z.infer`.
  - `redactProfile(p)` helper: replaces `apiKey` with `"***"` for wire serialisation.

**Acceptance:** Unit tests cover (a) all three valid shapes parse, (b) each missing-required-field case throws with `issues` pointing at the offending path, (c) `redactProfile` zeroes `apiKey`, (d) unique-name refinement fails on collision.

**Maps to AC:** AC-CU-6, AC-CU-8.

---

## Phase 3 — Profile storage (filesystem)

**Goal:** Read/write/list/upsert/delete profiles atomically with strict file modes.

**Files:**

- `chat-ui/server/profileStore.ts`
  - `createProfileStore(profilesPath: string)` factory returning `{ list, get, upsert, remove, getRaw }`.
  - `list()`: read file, `JSON.parse`, run `ProfilesFileSchema.parse`, return `profiles.map(redactProfile)`.
  - `get(name, { reveal=false })`: as above but returns the un-redacted profile when `reveal=true`.
  - `getRaw(name)`: internal-only, used by the chat relay; throws `ProfileNotFoundError` if missing.
  - `upsert(profile)`: validates with `ProfileSchema`, replaces or appends by `name`, writes with atomic-rename pattern (`fs.writeFile` to `profiles.json.tmp` with mode `0600`, `fs.rename` over the original). On schema failure throws `ProfileValidationError`.
  - `remove(name)`: removes by name; throws `ProfileNotFoundError` if absent.
  - All file operations use `chmod 0o600` on the new file; the directory mode is asserted by `bootstrapConfigDir` already.

**Acceptance:** Unit tests use a tmp dir (`fs.mkdtemp(os.tmpdir() + "/chat-ui-test-")`), create the store, exercise upsert/get/remove, assert `stat` mode bits on Linux/macOS (skip mode assertion on Windows — note that A-12 is unix-only by implication). Round-trip preserves all FU-5 fields.

**Maps to AC:** AC-CU-6, AC-CU-7, AC-CU-8.

---

## Phase 4 — Request builder (per backend)

**Goal:** Pure function `buildUpstreamRequest(profile, openAiBody) → { url, headers, body }`. One branch per `backendKind`. No I/O.

**Files:**

- `chat-ui/server/requestBuilder.ts`
  - Input: a *full* `RawProfile` (un-redacted, with `apiKey`) and the `OpenAIChatCompletionsRequestBody` produced by the SPA.
  - Output: `{ url: string; headers: Record<string,string>; body: string /* JSON */ }`.
  - Branch `agent-host-cc`: `url = ${baseUrl}/v1/chat/completions`, headers `{ Authorization: "Bearer " + apiKey, "Content-Type": "application/json", "Accept": "text/event-stream" }`, body verbatim (with `model` from request OR `profile.defaultModel` if request omits).
  - Branch `openai`: same as above against `profile.baseUrl` (default `https://api.openai.com`).
  - Branch `azure-openai`: `url = ${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`, headers `{ "api-key": apiKey, "Content-Type": "application/json", "Accept": "text/event-stream" }`, body **with `model` field stripped** (deployment is in URL — see investigation pitfall §4).
  - In all branches: if profile defines `systemPrompt`, prepend a `{ role: "system", content: systemPrompt }` message ONLY if the incoming `messages[0].role !== "system"`. If profile defines `temperature` or `maxTokens` and the request omits them, fill them in from the profile (these are profile-level defaults that the SPA does not override per-turn in v1, per FU-14).

**Acceptance:** Unit tests cover all three branches, the `model`-stripped Azure body, the system-prompt-prepend rule (and the no-double-prepend case), and the `temperature`/`maxTokens` profile fill.

**Maps to AC:** AC-CU-2, AC-CU-3, AC-CU-4, AC-CU-8, AC-CU-10, AC-CU-11.

---

## Phase 5 — Chat relay (Fastify route + undici + SSE)

**Goal:** `POST /api/chat` that takes `{ profileName, messages, stream?: true, temperature?, max_tokens? }` from the SPA, looks up the raw profile, builds the upstream request via Phase 4, invokes `undici.request`, and pipelines the upstream `text/event-stream` straight to `reply.raw` with backpressure preserved, propagating client disconnect to an `AbortController`.

**Files:**

- `chat-ui/server/chatRelay.ts`
  - Exports `registerChatRoute(app: FastifyInstance, store: ProfileStore)`.
  - Request body Zod schema: `{ profileName: string, messages: Array<{role: "system"|"user"|"assistant", content: string}>, stream?: boolean (default true), temperature?: number, max_tokens?: number }`.
  - Steps:
    1. Validate body; on failure, throw `ProfileValidationError` (HTTP 422 envelope).
    2. `const profile = store.getRaw(profileName)` — throws `ProfileNotFoundError` (HTTP 404).
    3. `const { url, headers, body } = buildUpstreamRequest(profile, validatedBody)`.
    4. Set headers on `reply.raw`: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Call `reply.hijack()` so Fastify does not attempt to send a body.
    5. Create `AbortController`; subscribe `request.raw.on("close", () => abortController.abort())`.
    6. `const upstream = await undici.request(url, { method: "POST", headers, body, signal: abortController.signal })`.
    7. If `upstream.statusCode >= 400`: read full body, write a single `data: {"error":{"type":"upstream_error","status":<n>,"message":<excerpt>}}\n\n` then `data: [DONE]\n\n`, end the stream.
    8. Else `await pipeline(upstream.body, reply.raw, { end: false })`.
    9. In a `finally`, write `data: [DONE]\n\n` only if upstream did not already send one (track via a small transform that watches for the sentinel — or simpler: trust upstream and skip the trailing `[DONE]` if pipeline succeeded). Always call `reply.raw.end()`.
  - Error path: any thrown error before headers-flush is converted to `error.toEnvelope()` and sent as JSON with the appropriate HTTP status. After headers-flush, errors become a `data: {…error…}\n\n` followed by `data: [DONE]\n\n`.

**Acceptance:** Integration test (Phase 8) drives `app.inject({ method: "POST", url: "/api/chat", payload, headers })` against a mocked undici (`MockAgent`) yielding a canned SSE body; assert the response stream contains the deltas in order, the final `[DONE]`, and that `abortController.abort()` is called on socket close.

**Maps to AC:** AC-CU-2, AC-CU-3, AC-CU-4, AC-CU-5, AC-CU-11.

---

## Phase 6a — Profile REST routes + Fastify wiring (Coder A)

**Goal:** REST endpoints for profile CRUD + the Fastify bootstrap.

**Files:**

- `chat-ui/server/index.ts`
  - `loadServerConfig()` from Phase 1.
  - `bootstrapConfigDir(...)`.
  - `const store = createProfileStore(profilesPath)`.
  - Build Fastify instance. `setErrorHandler` translates `ChatUiError` to its envelope; otherwise responds with HTTP 500 and `{ error: { type: "internal", message: err.message } }`.
  - Register `@fastify/static` from `dist-ui/` with `wildcard: false` (Phase 7 will set the SPA fallback).
  - Register `registerChatRoute(app, store)` (Phase 5).
  - Register profile routes (this phase, see below).
  - Listen on `127.0.0.1:CHAT_UI_PORT`. On listen, log the resolved URL.
- `chat-ui/server/profileRoutes.ts`
  - `GET /api/profiles` → `store.list()` (redacted).
  - `POST /api/profiles` → body `ProfileSchema`; calls `store.upsert`. 201 on create, 200 on update, with redacted profile in body.
  - `PUT /api/profiles/:name` → same as POST but `name` in URL must match body.
  - `DELETE /api/profiles/:name` → 204 on success.
  - `GET /api/profiles/:name?reveal=true|false` → returns the profile; only includes `apiKey` if `reveal=true` AND request originates from `127.0.0.1` (assert via `request.ip`).
  - `POST /api/profiles/:name/activate` → in-memory `activeProfileName` server side; returns `{ activeProfileName }`. Optional convenience; SPA can also pass `profileName` per chat call.

**Acceptance:** `app.inject` integration tests cover create/list/get/update/delete and the `reveal=true` 127.0.0.1 gate.

**Maps to AC:** AC-CU-6, AC-CU-9.

---

## Phase 6b — SPA shell (Vite + Preact + signals) (Coder B)

**Goal:** Mount the Preact app, define the global state signals, and provide the typed API client. No business components yet; just the contract.

**Files:**

- `chat-ui/client/index.html` — minimal HTML with `<div id="app"></div>` and `<script type="module" src="/src/main.ts"></script>`.
- `chat-ui/client/src/main.ts` — `import { render } from "preact"; import { App } from "./components/App";` and mount.
- `chat-ui/client/src/state.ts`
  - `profiles = signal<RedactedProfile[]>([])`.
  - `activeProfileName = signal<string | null>(null)`.
  - `messages = signal<UiMessage[]>([])` where `UiMessage = { id, role, kind: "chat" | "switch-banner", content: Signal<string> }` (nested signal for streaming token append).
  - `streaming = signal<boolean>(false)`.
  - `lastError = signal<{ type: string; message: string } | null>(null)`.
  - Helper actions: `loadProfiles()`, `selectProfile(name)`, `clearTranscript()`, `sendMessage(text)`, `appendDelta(delta)`.
- `chat-ui/client/src/lib/api.ts`
  - Typed wrappers: `listProfiles()`, `createProfile(p)`, `updateProfile(p)`, `deleteProfile(name)`, `revealProfile(name)`.
  - Returns the parsed JSON. On non-2xx, throws an `ApiError` shaped `{ status, type, message }`.
- `chat-ui/client/src/lib/sseClient.ts`
  - `streamChat(body, { onDelta, onDone, onError, signal })`: opens `POST /api/chat` via `fetch` with `Accept: text/event-stream`; reads `response.body.getReader()`; parses `data: …` frames (handling chunk-boundary fragmentation by buffering until `\n\n`); calls `onDelta(text)` for each `chat.completion.chunk` delta; calls `onError(envelope.error)` when an error chunk arrives; calls `onDone()` on `data: [DONE]`.

**Acceptance:** Manual: `npm run dev` brings up the SPA at `127.0.0.1:5173`, the page renders an empty shell, the network tab shows `GET /api/profiles` proxied to `127.0.0.1:5174` returning `[]`.

**Maps to AC:** AC-CU-1.

---

## Phase 6c — SPA components (Profile editor, transcript, composer) (Coder C)

**Goal:** Implement the visible UI components against the signals contract from 6b.

**Files:**

- `chat-ui/client/src/components/App.tsx` — two-pane layout: left `<ProfileSelector />` + actions, right `<Transcript />` + `<Composer />`.
- `chat-ui/client/src/components/ProfileSelector.tsx`
  - Dropdown bound to `activeProfileName`. Changing emits an inline `kind: "switch-banner"` entry into `messages` (FU-10) and updates the signal.
  - "Manage…" button toggles the `<ProfileEditor />` modal.
- `chat-ui/client/src/components/ProfileEditor.tsx`
  - Profile list with edit/delete buttons.
  - Create/edit form whose visible fields adapt to the selected `backendKind` (renders the FU-5 matrix).
  - "Reveal API key" button calls `revealProfile(name)` and shows the raw key briefly.
  - `agent-host-cc` form: on Save, optionally call `GET {baseUrl}/v1/models` (via the local proxy) and suggest discovered IDs (OD-5).
  - Validation errors from the server are rendered inline next to the offending field (uses the `issues[]` array from `ProfileValidationError`).
- `chat-ui/client/src/components/Transcript.tsx`
  - Renders the `messages` signal. The in-progress assistant bubble subscribes to its own nested `content` signal so token deltas update only that node.
  - `kind: "switch-banner"` rows render with a distinct style and are NOT included when sending the next request (the `Composer.send` filters them out).
- `chat-ui/client/src/components/Composer.tsx`
  - Textarea + Send button. Enter sends, Shift+Enter inserts newline. Send is disabled when `streaming.value || !activeProfileName.value`.
  - On send: append a `user` message; create the in-progress `assistant` message with its own `content` signal; call `streamChat({ profileName: activeProfileName.value, messages: messagesForUpstream() })`; on each delta append to the assistant's `content` signal; on done, finalise; on error, set `lastError`.

**Acceptance:** Manual smoke against a running upstream confirms FU-9, FU-10, FU-12, FU-13, FU-14.

**Maps to AC:** AC-CU-2, AC-CU-3, AC-CU-4, AC-CU-5, AC-CU-11.

---

## Phase 7 — Server static-serve + SPA fallback

**Goal:** Wire `@fastify/static` correctly so production-like `npm run start` serves both the SPA and `/api`.

**Files (modify):**

- `chat-ui/server/index.ts` — register `@fastify/static` rooted at `dist-ui/` with `prefix: "/"`. Register `app.setNotFoundHandler` that, for GET requests under non-`/api/*` paths, replies with `dist-ui/index.html` (SPA fallback). For `/api/*` 404s, return the standard error envelope.

**Acceptance:** `npm run build && npm run start` serves the SPA at `127.0.0.1:5173` and proxies chat requests successfully against a running upstream.

**Maps to AC:** AC-CU-1, AC-CU-12.

---

## Phase 8 — Tests (unit + integration)

**Goal:** vitest coverage for the load-bearing logic. Tests live under `chat-ui/test/` for code under test and `chat-ui/test_scripts/` for any script-style runners (per project convention; the formal tests imported by `vitest run` are under `chat-ui/test/`, mirroring the host service's `test/` layout).

**Files:**

- `chat-ui/test/unit/profileSchema.test.ts` — schema validity per `backendKind`, missing-field cases, redaction.
- `chat-ui/test/unit/requestBuilder.test.ts` — three branches, Azure model-strip, system-prompt-prepend rule, profile defaults fill.
- `chat-ui/test/unit/profileStore.test.ts` — round-trip CRUD against tmp HOME; mode bits asserted on POSIX.
- `chat-ui/test/integration/chatRelay.test.ts` — `buildApp()` + `undici.MockAgent` upstream returning a canned SSE body. Cases: 200 streamed deltas, mid-stream error chunk, upstream 401 surfaced as upstream_error envelope, history preserved across two consecutive chat calls with different `profileName`.

**Acceptance:** `npm test` exits 0 with all four files green.

**Maps to AC:** AC-CU-8, AC-CU-11.

---

## Phase 9 — README + design doc updates

**Goal:** All documentation called out by FU-17 is in place and internally consistent.

**Files (create):**

- `chat-ui/README.md`
  - Install (`npm install`).
  - Dev mode (`npm run dev` — explains the two-port topology; OD-1).
  - Production-like (`npm run build && npm run start`).
  - Profile JSON shape (link to `server/profileSchema.ts`).
  - Profile storage location and permissions (`~/.agent-host-cc/chat-ui/profiles.json`, `0700`/`0600`).
  - Security note: localhost-only by design; never expose without a reverse proxy + auth.
  - Model-prefix gotcha for `agent-host-cc` (must include `cc.`).
  - Override env vars: `CHAT_UI_PORT`, `CHAT_UI_PROFILES_PATH`.

**Files (modify in a follow-up step within this phase):**

- `docs/design/project-design.md` — append a NEW section titled **"14. Chat UI sub-application (`chat-ui/`)"** with the bullet outline below; do NOT rewrite earlier sections.
- `docs/design/project-functions.md` — append the FU-CU-1 … FU-CU-17 rows (text staged below).

### Section to append to `docs/design/project-design.md`

> **Title:** `## 14. Chat UI sub-application (chat-ui/)`
>
> **Bullet outline** (the implementer expands each into prose):
> - Purpose: localhost dev tester for the OpenAI Chat Completions wire format against three backend kinds; not part of the deployable host service image.
> - Scope and non-goals: in/out of scope per refined-request-chat-ui.md.
> - Folder layout: `chat-ui/` self-contained; own `package.json`; no edits to root `package.json` or `src/`.
> - Server architecture: Fastify 5; `@fastify/static` for SPA assets; `setNotFoundHandler` SPA fallback; `/api/profiles*` REST + `POST /api/chat` SSE relay; `undici.request` + `pipeline()` for backpressure-correct relay.
> - Client architecture: Vite + Preact 10 + `@preact/signals`; signal-per-state-slice; nested signal per in-progress assistant message for token-level updates.
> - Configuration: `~/.agent-host-cc/chat-ui/profiles.json` (`0600`), parent dir `0700`; `CHAT_UI_PORT` and `CHAT_UI_PROFILES_PATH` envs; the only authorised defaults (per FU-6) are `CHAT_UI_PORT=5173` and `openai.baseUrl=https://api.openai.com`.
> - Profile schema: Zod 4 discriminated union on `backendKind` ∈ {`agent-host-cc`, `openai`, `azure-openai`}; per-kind required fields per FU-5.
> - Wire format: standard OpenAI Chat Completions SSE (`data: …\n\n`, terminal `data: [DONE]`); no transformation in the relay.
> - Relation to host service: pure HTTP client; communicates over the documented OpenAI-compatible surface; never imports from `../src/`.
> - Out of scope (v1): authentication on the UI itself, chat history persistence, per-turn knobs, file/image upload, Responses API, AAD/MI for Azure.

### Rows to append to `docs/design/project-functions.md`

The implementer adds the following rows to the "Functional requirements" table. Status starts as `planned`. Verbatim wording matches `refined-request-chat-ui.md`'s FU-1 … FU-17. Use the `FU-CU-N` ID prefix to keep the chat-ui requirements distinguishable from the host service's `F-N`.

| ID | Requirement (verbatim from refined-request-chat-ui.md) | Status |
|---|---|---|
| FU-CU-1 | Subfolder layout — `chat-ui/`, own `package.json`/`tsconfig.json`/`src/`/`README.md`, no import from host `src/`. | planned |
| FU-CU-2 | TypeScript only; Node ≥ 22; ESM; strict TS. | planned |
| FU-CU-3 | Browser SPA served by a local Fastify server bound to `127.0.0.1:<port>`. | planned |
| FU-CU-4 | Three backend kinds: `agent-host-cc`, `openai`, `azure-openai`. | planned |
| FU-CU-5 | Per-backend required fields per the FU-5 table; Zod-validated; loud failure on missing required fields. | planned |
| FU-CU-6 | No fallback for required configuration; only `openai.baseUrl` and `CHAT_UI_PORT` have authorised defaults. | planned |
| FU-CU-7 | Profiles persisted at `~/.agent-host-cc/chat-ui/profiles.json` with dir `0700`, file `0600`; revalidated on every read. | planned |
| FU-CU-8 | Profile management UI: list, create, edit, delete (with confirm). | planned |
| FU-CU-9 | Active-profile selector at the top of the chat surface; switch takes effect on next user message. | planned |
| FU-CU-10 | Conversation continuity on profile switch; inline transcript banner shown. | planned |
| FU-CU-11 | OpenAI Chat Completions wire format for all three backends; Azure path uses `/openai/deployments/{deployment}/chat/completions?api-version=…` with `api-key` header and no `model` in body. | planned |
| FU-CU-12 | Streaming on by default; renders `chat.completion.chunk` deltas; finalises on `[DONE]`; surfaces mid-stream error chunks inline. | planned |
| FU-CU-13 | Errors surfaced with HTTP status, upstream envelope, and a hint identifying the likely-faulty profile field. | planned |
| FU-CU-14 | Minimal chat controls: input+send, transcript, profile selector, "new conversation" button. | planned |
| FU-CU-15 | Independent dependency tree under `chat-ui/package.json`; root `package.json` not modified. | planned |
| FU-CU-16 | Test scripts under `chat-ui/test_scripts/` (or formal tests under `chat-ui/test/`) covering schemas, request builder, SSE parser. | planned |
| FU-CU-17 | Documentation updates: `plan-004-chat-ui.md`, project-design section, project-functions rows, `chat-ui/README.md`. | planned |

**Acceptance:** All four artefacts (plan-004, project-design section, project-functions rows, README.md) cross-reference each other and resolve.

**Maps to AC:** AC-CU-9.

---

## Phase 10 — Verification & AC sign-off

**Goal:** Execute the full verification flow that AC-CU-* mandates.

**Verification commands (Claude executes from the repo root):**

```bash
cd chat-ui
npm install
npm run typecheck
npm run build
npm test
```

All four MUST exit `0`.

**Manual checks (require running upstreams):**
- AC-CU-1: `npm run start` prints a `http://127.0.0.1:5173` URL; opening it renders the layout.
- AC-CU-2 / AC-CU-3 / AC-CU-4: with profiles `local` / `openai-prod` / `azure-foundry`, send "ping" against each and observe streamed reply.
- AC-CU-5: switch profiles mid-conversation; transcript shows three replies and three banners with the active profile name.
- AC-CU-6: try saving a profile with an empty `apiKey`; UI shows a per-field error; `profiles.json` unchanged.
- AC-CU-7: `stat -f "%Lp" ~/.agent-host-cc/chat-ui/` returns `700` and `…profiles.json` returns `600` (Linux: `stat -c %a`).
- AC-CU-10: `grep -REi "(sk-[a-z0-9]{20,}|api[_-]?key\s*[:=]\s*['\"][a-z0-9])" chat-ui/client/src chat-ui/server | grep -v 'apiKey:'` returns no matches.
- AC-CU-11: in two consecutive sends with different `profileName`, network inspector confirms both `messages[]` arrays contain the prior turns.
- AC-CU-12: with `CHAT_UI_PORT=0`, the server prints the OS-assigned port at startup.

**Acceptance:** Every AC-CU-1 … AC-CU-12 ticked off; sign-off recorded in `Issues - Pending Items.md` (mark FU-CU-* rows as `done` in `project-functions.md`).

**Maps to AC:** all AC-CU-1 … AC-CU-12.

---

## Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Vite + Fastify glue surprises (two-port dev, proxy mis-config) | OD-1 picks the well-known two-port pattern; `vite.config.ts` `server.proxy["/api"] = "http://127.0.0.1:5174"` is the canonical Vite idiom. README documents both `npm run dev` (two ports) and `npm run start` (single port). If glue still fights, fall back to running Vite in middleware mode (Option 2.B in the investigation). |
| R-2 | SSE buffering (intermediate proxies, Node default high-water marks) | Set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, AND `X-Accel-Buffering: no` on `reply.raw` BEFORE the first byte. Use `pipeline(upstream.body, reply.raw, { end: false })` per the investigation pitfall §4. Mirror the host service's existing `reply.raw` pattern. |
| R-3 | Profile file perms differ on macOS vs Linux | Storage tests assert `stat` mode bits via `fs.statSync(...).mode & 0o777`. Tests skip the assertion on `process.platform === "win32"`. macOS and Linux are POSIX-equivalent for the `0700`/`0600` bits this plan uses. |
| R-4 | Secret leakage if `profiles.json` gets committed | Profiles live OUTSIDE the repo (`~/.agent-host-cc/...`) by default. `chat-ui/.gitignore` ignores any `.env`. README spells out the localhost-only assumption and the secret-handling rules. `redactProfile` ensures `apiKey` never appears in `GET /api/profiles` responses. |
| R-5 | Model-prefix gotcha for `agent-host-cc` (codebase-scan anomaly #4) | Profile-creation form for `backendKind=agent-host-cc` calls `GET /v1/models` and suggests discovered IDs (OD-5). README has a dedicated "Model prefix" subsection. The hint text on the `defaultModel` field reads: *"Include the server's `MODEL_PREFIX` (default `cc.`), e.g. `cc.claude-sonnet-4-6`."* |
| R-6 | Zod 4 discriminated-union + `and(baseFields)` ergonomics | If `discriminatedUnion + and` does not yield clean error paths, fall back to three sibling `z.object` schemas with `backendKind` literals composed via `z.union` and a custom refinement that reports the offending `backendKind` in the issue path. The host service already uses Zod 4 in `src/types.ts` so the idiom is proven. |
| R-7 | Browser tab close not aborting upstream | Hook `request.raw.on("close", () => abortController.abort())` and pass `signal` to `undici.request`. Integration test asserts the `MockAgent` saw an abort. |
| R-8 | `apiKey` exposure via `GET /api/profiles/:name?reveal=true` | Endpoint asserts `request.ip === "127.0.0.1"` (or `::1`). Any non-loopback request returns 403. |
| R-9 | Port collision (5173 used by another local Vite project, 5174 by something else) | `CHAT_UI_PORT` env overrides; README documents how to change the API port (`CHAT_UI_PORT`) and the dev SPA port (Vite's `--port` flag). |

---

## Files to be added to `docs/design/project-functions.md` (staged for Phase 9)

See the table in Phase 9 above. Seventeen rows: `FU-CU-1` … `FU-CU-17`.

## Section to be appended to `docs/design/project-design.md` (staged for Phase 9)

Title: **`## 14. Chat UI sub-application (chat-ui/)`**. Bullet outline as listed in Phase 9.

---

## Master file inventory (all paths to be created)

```
chat-ui/package.json
chat-ui/tsconfig.base.json
chat-ui/tsconfig.json
chat-ui/tsconfig.server.json
chat-ui/vite.config.ts
chat-ui/.gitignore
chat-ui/README.md
chat-ui/test_scripts/.gitkeep

chat-ui/server/index.ts
chat-ui/server/config.ts
chat-ui/server/errors.ts
chat-ui/server/profileSchema.ts
chat-ui/server/profileStore.ts
chat-ui/server/profileRoutes.ts
chat-ui/server/requestBuilder.ts
chat-ui/server/chatRelay.ts

chat-ui/client/index.html
chat-ui/client/src/main.ts
chat-ui/client/src/state.ts
chat-ui/client/src/lib/api.ts
chat-ui/client/src/lib/sseClient.ts
chat-ui/client/src/components/App.tsx
chat-ui/client/src/components/ProfileSelector.tsx
chat-ui/client/src/components/ProfileEditor.tsx
chat-ui/client/src/components/Transcript.tsx
chat-ui/client/src/components/Composer.tsx

chat-ui/test/unit/profileSchema.test.ts
chat-ui/test/unit/requestBuilder.test.ts
chat-ui/test/unit/profileStore.test.ts
chat-ui/test/integration/chatRelay.test.ts
```

Modified docs (Phase 9):

```
docs/design/project-design.md      # append section 14
docs/design/project-functions.md   # append FU-CU-1 .. FU-CU-17
```

---

## End of plan-004
