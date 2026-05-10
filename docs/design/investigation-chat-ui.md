# Investigation: Minimal Multi-Backend Chat UI for agent-host-cc

## Executive Summary

This investigation evaluates concrete tooling and patterns for the new
`chat-ui/` sub-application defined in `docs/design/refined-request-chat-ui.md`.
The recommended stack is: **Vite + Preact + `@preact/signals` for the SPA**,
**Fastify with `@fastify/static` for the local dev server**, **a hand-rolled
backend-adapter layer (URL/headers/body builder + SSE parser) using `undici`
for upstream calls**, **`pipeline()` from `node:stream/promises` to relay
upstream `text/event-stream` to the browser without buffering**, **Zod 4 for
profile validation** (already pinned in the project), **plain
`@preact/signals` for client state**, **fail-fast configuration loading with no
hot-reload in v1**, and **vitest with a split between pure-function unit tests
and Fastify route integration tests using a mocked upstream**. This stack
honours the "minimal" constraint (Preact + signals adds ~5 KB gzipped, Vite
production builds use Rollup tree-shaking, undici is already a transitive
dependency in Node ≥ 22), keeps the dependency footprint small, requires no
modifications to root `package.json` or `src/`, and reuses the SSE wire format
already proven by `src/openAiChatSseAdapter.ts`.

## Context

- **What was investigated:** Practical implementation choices for a self-
  contained, browser-served, TypeScript-only chat UI under `chat-ui/` that
  speaks the OpenAI Chat Completions wire format against three backends
  (`agent-host-cc`, `openai`, `azure-openai`), supports SSE streaming by
  default, and persists named profiles at `~/.agent-host-cc/chat-ui/
  profiles.json` with strict permissions.
- **Driving requirements / constraints:**
  - Minimal dependency footprint and "lowest-friction" UX.
  - TypeScript only (no JS source); Node ≥ 22; ESM; Zod 4 already pinned.
  - No fallback values for required configuration — `ConfigurationError`
    must be raised on missing required fields.
  - Browser cannot reach Azure/OpenAI directly without leaking the API key,
    so the local Fastify server must proxy chat requests.
  - Sub-application must NOT modify root `package.json` and must NOT alter
    existing `src/`.
  - Fastify 5 + vitest + Zod 4 are the project standards.
- **Linked artifacts:**
  - Refined request: `docs/design/refined-request-chat-ui.md`
  - Codebase scan: `docs/reference/codebase-scan-chat-ui.md`

## Options Identified

The investigation is organised by topic area; each topic enumerates real
alternatives, then a single recommendation is given in the
**Recommendation** section.

### Topic 1 — SPA framework / build tool

#### Option 1.A: Vanilla TypeScript + esbuild
- **Description:** Hand-write DOM updates against template literals (or
  `htm`); use `esbuild --bundle --watch` to produce a single bundle; no
  framework runtime.
- **Strengths:** Smallest possible bundle (zero framework runtime); zero
  config; one binary.
- **Weaknesses:** No HMR out of the box; manual DOM diffing is
  surprisingly verbose for a streaming transcript with profile switching;
  hand-written reactivity tends to grow into a tiny ad-hoc framework
  anyway.
- **Effort/Complexity:** Medium (low setup, higher per-feature cost).
- **Risk:** Medium — easy to write subtle bugs in incremental DOM patching
  during streaming.
- **Best suited when:** the surface is genuinely a single screen with
  three controls.

#### Option 1.B: Vite + Preact + `@preact/signals`
- **Description:** Vite as dev server / build tool (uses esbuild for TS
  transpilation in dev, Rollup for production tree-shaking); Preact as the
  rendering engine; `@preact/signals` for fine-grained reactivity.
- **Strengths:** ~3 KB Preact core + ~2 KB signals gzipped; Vite gives
  instant HMR with a one-line config; signals update only the changing
  message bubble during token streaming, without re-rendering the
  transcript; first-class TypeScript and JSX support without extra
  config; idiomatic dev experience that any contributor will recognise.
- **Weaknesses:** Adds Vite + Preact + signals as direct deps (still tiny
  vs. React/Vue); two build tools (Vite for SPA, `tsc` for the Fastify
  server) — but they are isolated under `chat-ui/`.
- **Effort/Complexity:** Low.
- **Risk:** Low — Vite + Preact is a well-trodden combination.
- **Best suited when:** the team wants minimal bundle size AND an
  ergonomic component model.

#### Option 1.C: Vite + React
- **Description:** Same as 1.B but with React.
- **Strengths:** Largest ecosystem; familiar to most contributors.
- **Weaknesses:** ~40 KB React core gzipped (10× Preact); top-down re-
  renders are wasteful for a streaming token UI unless React 19 compiler
  or signals adapters are layered on; violates the "minimal" framing.
- **Effort/Complexity:** Low.
- **Risk:** Low.
- **Best suited when:** existing React component code is being reused —
  not the case here.

#### Option 1.D: SvelteKit / Svelte + Vite
- **Description:** Svelte's compiler-based reactivity; small runtime.
- **Strengths:** Tiny runtime; ergonomic store/`$:` reactivity.
- **Weaknesses:** Adds a new language file format (`.svelte`) into a
  TypeScript-only repo; tooling is one more thing to learn for
  contributors who already know the Fastify+TS stack.
- **Effort/Complexity:** Low–Medium.
- **Risk:** Low–Medium (single-language convention deviation).
- **Best suited when:** the team already uses Svelte.

### Topic 2 — Embedding / serving the SPA + proxy model

#### Option 2.A: `@fastify/static` + `setNotFoundHandler` SPA fallback, with sibling proxy routes on the same Fastify instance
- **Description:** One Fastify process. `@fastify/static` serves the
  Vite-built `dist/` directory at `/`. SPA deep-link fallback uses
  `fastify.setNotFoundHandler((req, reply) => reply.sendFile('index.
  html'))`. The same instance registers `POST /api/chat` (and
  `GET /api/profiles`, `PUT /api/profiles/:name`, etc.) which proxies to
  the configured upstream. The browser only ever sees `127.0.0.1:5173`.
- **Strengths:** Single process, single port, no CORS; API keys never
  leave Node; matches the project's existing Fastify idiom.
- **Weaknesses:** During Vite dev mode you either run two processes
  (Vite dev server with HMR + Fastify on a different port with a CORS
  exemption) or invoke `vite build --watch` and let Fastify serve the
  rebuilt `dist/` (slower feedback, no HMR).
- **Effort/Complexity:** Low.
- **Risk:** Low.
- **Best suited when:** the production-like dev experience matters more
  than HMR.

#### Option 2.B: Vite middleware mode mounted inside Fastify
- **Description:** Use Vite's programmatic `createServer({ middlewareMode:
  true })` and pipe its `middlewares` Connect stack into a
  `fastify.use(...)` (via `@fastify/middie`) so HMR works through the
  same Fastify port.
- **Strengths:** Single port, with HMR.
- **Weaknesses:** Adds `@fastify/middie` as a dep; couples dev mode to
  Vite's internal API; one more failure mode.
- **Effort/Complexity:** Medium.
- **Risk:** Medium — Vite middleware mode is supported but the wiring is
  fiddly.
- **Best suited when:** HMR is essential.

#### Option 2.C: Two ports during dev, single port in prod
- **Description:** During dev: Vite on `5173`, Fastify on `5174` exposing
  `/api/*`; Vite proxies `/api` to Fastify via its built-in `server.
  proxy` config. In prod: Fastify alone serves both static and `/api`.
- **Strengths:** True HMR; the well-known Vite-proxy pattern; clear
  separation.
- **Weaknesses:** Two processes during dev; two npm scripts (`npm run
  dev:server`, `npm run dev:ui`) plus a concurrent runner like
  `concurrently`.
- **Effort/Complexity:** Low–Medium.
- **Risk:** Low.
- **Best suited when:** HMR is desired without coupling Fastify to Vite's
  middleware API.

### Topic 3 — Backend-adapter / proxy abstraction

#### Option 3.A: Hand-rolled adapter (URL builder + headers builder + SSE parser)
- **Description:** A small `requestBuilder.ts` that takes
  `(profile, openAiRequestBody)` and returns `{ url, headers, body }`,
  one branch per `backendKind`. The body shape is the standard OpenAI
  Chat Completions JSON in all three branches (with `model` removed for
  Azure). An `sseRelay.ts` reads the upstream `text/event-stream` chunks
  and forwards them verbatim — the browser already understands the
  `chat.completion.chunk` deltas thanks to the wire format being
  identical.
- **Strengths:** Zero new SDK deps; total control over error envelope
  shape; mirrors the proven pattern in `src/openAiChatSseAdapter.ts`;
  trivially unit-testable (pure function returning a request descriptor).
- **Weaknesses:** Implementer must know the three URL/header conventions
  (already documented in FU-11 of the refined request).
- **Effort/Complexity:** Low.
- **Risk:** Low.
- **Best suited when:** the only operation is "forward Chat Completions
  with streaming" — which is exactly this v1 scope.

#### Option 3.B: Use the official `openai` npm package + `AzureOpenAI` class
- **Description:** Use `OpenAI` for both `agent-host-cc` (with custom
  `baseURL`) and `openai`; use `AzureOpenAI` for `azure-openai`.
- **Strengths:** Typed request/response shapes maintained by OpenAI;
  battle-tested streaming iteration via `for await`.
- **Weaknesses:** Adds a non-trivial dependency (~hundreds of KB
  installed) just to send one POST per profile kind; Microsoft documents
  that "the Azure API shape slightly differs from the core API shape
  which means that the static types for responses/params won't always be
  correct"; the relay must convert SDK `chunk` objects back into SSE
  `data:` lines because the browser still receives raw SSE — so the SDK
  buys little while costing dependency weight; using the SDK for
  `agent-host-cc` is awkward because it strips bearer-auth differently
  for custom base URLs in some versions.
- **Effort/Complexity:** Low.
- **Risk:** Low–Medium (occasional SDK breaking changes).
- **Best suited when:** the project also wants tool-calls, function-
  calling, structured outputs, or non-streaming aggregations — none of
  which are in v1 scope.

#### Option 3.C: LangChain.js / Vercel AI SDK
- **Description:** Use a higher-level abstraction.
- **Strengths:** Multi-provider out of the box.
- **Weaknesses:** Hides exactly the wire-level fidelity the project
  needs; large dep tree; opinionated message normalisation that conflicts
  with the agent-host-cc tool-call markdown shim
  (`*[<toolName> …]*`) flowing through unchanged (see codebase-scan §4).
- **Effort/Complexity:** Medium.
- **Risk:** Medium–High (wire-level surprises are likely).
- **Best suited when:** the UI is a true multi-modal agent harness — not
  this case.

### Topic 4 — SSE forwarding through Fastify

#### Option 4.A: `undici.request()` + `pipeline(upstream.body, reply.raw, { end: false })`
- **Description:** Use `undici.request(url, { method:'POST', headers,
  body, signal })` to issue the upstream call. Set the standard SSE
  headers on `reply.raw` (`Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering:
  no`). Use `pipeline()` from `node:stream/promises` so backpressure is
  preserved through the chain. Hook `request.socket.on('close', () =>
  abortController.abort())` to abort the upstream when the browser tab
  closes.
- **Strengths:** Native to Node ≥ 22; backpressure-correct (per Matteo
  Collina's stream-processing notes); identical to the existing project
  pattern (`reply.raw` is already used in `src/httpServer.ts:155–162`);
  no new dependency (undici ships with Node).
- **Weaknesses:** Requires manual abort plumbing — but that pattern is
  also already in `src/httpServer.ts` for the agent runner.
- **Effort/Complexity:** Low.
- **Risk:** Low.

#### Option 4.B: `@fastify/sse` plugin or `fastify-sse-v2`
- **Description:** A Fastify plugin abstracts the SSE response.
- **Strengths:** Built-in `Last-Event-ID` reconnect, async-iterator API.
- **Weaknesses:** Both plugins are designed for *originating* SSE
  streams, not *relaying* upstream SSE; using them as a relay forces an
  extra parse-and-re-emit step for no benefit because the upstream
  format is already exactly what the browser wants.
- **Effort/Complexity:** Low–Medium.
- **Risk:** Low.

#### Option 4.C: `@fastify/http-proxy` / `@fastify/fast-proxy`
- **Description:** A generic HTTP proxy plugin.
- **Strengths:** One-liner upstream forwarding.
- **Weaknesses:** Generic proxies are tuned for normal HTTP, not long-
  lived `text/event-stream`; they may buffer or insert response
  transforms incompatible with SSE; URL/header rewriting per-`backendKind`
  is awkward inside the plugin's hook model.
- **Effort/Complexity:** Low.
- **Risk:** Medium.

### Topic 5 — Profile schema validation library

#### Option 5.A: Zod 4 (already pinned)
- Already in use across `src/types.ts` and `src/config.ts`; supports
  discriminated unions on `backendKind`, `z.looseObject` (chosen project
  idiom), and `safeParse` for explicit error reporting. Confirmed.

#### Option 5.B: Valibot / ArkType
- Smaller bundle for browser code, but irrelevant here because the
  validation runs server-side before profiles are sent to the browser.
  Adds a second schema library to the repo. Rejected.

### Topic 6 — Client state management

#### Option 6.A: `@preact/signals` only
- **Description:** One signal per piece of UI state: `profiles` (array
  signal), `activeProfileName`, `messages` (array of `{role, content}`
  with the in-progress assistant message holding its own nested signal so
  token deltas mutate just that one signal), `streamingInProgress`,
  `lastError`.
- **Strengths:** Fine-grained updates; no Redux/Zustand boilerplate; tiny
  bundle add-on; signals work at vanilla-JS speeds for streaming text
  updates.
- **Weaknesses:** The well-documented "array reactivity" gotcha — array
  mutations don't notify; use `messages.value = [...messages.value,
  newMsg]` for inserts, but mutate `messages.value[i].content.value`
  directly for streaming token appends. This is precisely the structure
  that gives near-vanilla streaming performance.
- **Effort/Complexity:** Low.
- **Risk:** Low.

#### Option 6.B: Zustand / Redux Toolkit
- **Description:** Centralised store.
- **Weaknesses:** Overkill for ≤ 5 stateful pieces; extra dep; encourages
  whole-list re-render on each token chunk unless selectors are tuned.
- **Effort/Complexity:** Low–Medium.
- **Risk:** Low.

#### Option 6.C: Plain `useState`/Preact hooks
- **Description:** Component-local state.
- **Weaknesses:** Per-token re-renders of the entire transcript bubble
  hierarchy; works but wastes the framework choice's main perf
  advantage.
- **Effort/Complexity:** Low.
- **Risk:** Low.

### Topic 7 — Configuration file lifecycle

#### Option 7.A: Fail-fast load on each request (no hot-reload, no fallback)
- **Description:** On first start, if `~/.agent-host-cc/chat-ui/` does
  not exist, create it with `0700` and write `profiles.json` as an empty
  object/array with `0600`. On every read (profile list, profile fetch,
  send message), `JSON.parse` then run the full Zod discriminated-union
  parse. Any malformed/missing required field throws
  `ConfigurationError` with `{ profileName, fieldPath }` in the envelope.
  No defaults for required fields; only `openai.baseUrl` (defaults to
  `https://api.openai.com`) and the global `CHAT_UI_PORT` (defaults to
  `5173`) are permitted defaults — both already documented in FU-6.
- **Strengths:** Matches project NF-3; predictable; users editing the
  file by hand see errors immediately on next request.
- **Weaknesses:** A profile edit requires the user to re-issue a
  request; not "live" in a watcher sense.
- **Effort/Complexity:** Low.
- **Risk:** Low.

#### Option 7.B: `chokidar` / `fs.watch` hot-reload
- **Description:** Watch `profiles.json` and re-broadcast to the SPA.
- **Weaknesses:** Adds a watcher dep and a small SSE channel from server
  → SPA for profile changes; v1 doesn't need this; user can already
  reload the page.
- **Effort/Complexity:** Medium.
- **Risk:** Low–Medium.

### Topic 8 — Testing approach

#### Option 8.A: vitest, split unit + integration
- **Description:**
  - **Unit (pure functions, no Fastify):** profile Zod schemas (one
    `describe` per `backendKind`); URL+headers builder
    (`requestBuilder.ts`); SSE parser fragment reassembly; profile
    storage (mode bits, JSON shape) using a tmp dir via `node:fs`.
  - **Integration:** `buildApp()` with a fake upstream that yields a
    canned `text/event-stream` body (re-using the project's
    `test/fixtures/mockAnthropicProvider.ts` style — async generator
    wrapped in a `Response` with a manually-built `ReadableStream`).
    Cover: 200 streamed, mid-stream error chunk, 401 from upstream
    surfaced as the `{ error: { type, message } }` envelope, profile
    switch mid-conversation preserves history (via two consecutive
    requests with different `profileName` in the body but same
    `messages[]`).
  - No Playwright in v1 — the UI is small enough that a manual smoke
    pass during AC verification suffices.
- **Strengths:** Matches the project's vitest convention; no new test
  framework; reuses async-generator fakes already proven in
  `test/fixtures/`.
- **Effort/Complexity:** Low.
- **Risk:** Low.

#### Option 8.B: Add Playwright
- **Description:** Real browser end-to-end.
- **Weaknesses:** Heavy; CI cost; not justified for a localhost-only dev
  tool whose ACs (AC-CU-2, AC-CU-3, AC-CU-4) explicitly require a
  running upstream which is not reproducible in CI.
- **Effort/Complexity:** Medium.
- **Risk:** Low.

## Comparison Matrix

| Criterion | SPA tool — 1.A vanilla TS+esbuild | SPA tool — 1.B Vite+Preact+signals | SPA tool — 1.C Vite+React | SPA tool — 1.D Svelte |
|---|---|---|---|---|
| Bundle size | Smallest | ~5 KB gz | ~40 KB gz | ~5 KB gz |
| Dev server / HMR | None (custom) | Vite HMR | Vite HMR | Vite HMR |
| TypeScript ergonomics | Manual | First-class | First-class | Good |
| Streaming-token perf | Best | Near-vanilla | Re-renders unless tuned | Compiled — excellent |
| Dep count added | 1 (esbuild) | 3 (vite, preact, @preact/signals) | 3 | 2 (svelte, vite) |
| Single-language constraint | OK | OK | OK | Adds `.svelte` |
| Effort to first working chat | High | Low | Low | Low–Medium |
| Long-term viability | High | High | High | High |

| Criterion | Serve — 2.A static+notFound | Serve — 2.B Vite middleware | Serve — 2.C two-ports |
|---|---|---|---|
| Single port in dev | Yes | Yes | No |
| HMR | No | Yes | Yes |
| Dep count | 1 (`@fastify/static`) | 2 (`@fastify/static` + `@fastify/middie`) | 1 |
| Coupling to Vite internals | None | Tight | Loose |
| Effort | Low | Medium | Low–Medium |

| Criterion | Adapter — 3.A hand-rolled | Adapter — 3.B `openai` SDK | Adapter — 3.C LangChain |
|---|---|---|---|
| Deps added | 0 | 1 medium | 1 large |
| Wire-level control | Total | Partial | None |
| Tool-call markdown passthrough | Native | Native | Risk of normalisation |
| Streaming relay | Verbatim SSE | Re-emit SSE | Re-emit SSE |
| Long-term cost | Low | Medium | High |

| Criterion | SSE — 4.A undici+pipeline | SSE — 4.B `@fastify/sse` | SSE — 4.C generic proxy |
|---|---|---|---|
| Backpressure correctness | Correct | Correct (parse+re-emit) | Risk of buffering |
| Deps added | 0 | 1 | 1 |
| Matches existing project pattern | Yes (`reply.raw`) | No | No |
| Suitability for *relay* | Excellent | Designed for origination | Generic |

## Recommendation

| Topic | Recommended option |
|---|---|
| 1. SPA framework / build tool | **Vite + Preact + `@preact/signals`** (Option 1.B) |
| 2. Serving + proxy model | **`@fastify/static` + `setNotFoundHandler` fallback; sibling `/api/chat` POST + `/api/profiles*` REST routes on the same Fastify instance; Vite dev server runs separately on port 5173 with `server.proxy['/api'] = 'http://127.0.0.1:5174'`** (Option 2.C). In production-like `npm run start`, Fastify alone binds to `127.0.0.1:CHAT_UI_PORT` (default `5173`) and serves both static and `/api`. |
| 3. Backend-adapter layer | **Hand-rolled `requestBuilder.ts` + `sseRelay.ts`** (Option 3.A) |
| 4. SSE forwarding | **`undici.request()` → `pipeline(upstream.body, reply.raw, { end:false })` with `AbortController` driven by `request.socket.on('close')`** (Option 4.A) |
| 5. Profile schema validation | **Zod 4** (Option 5.A) |
| 6. Client state | **`@preact/signals`-only** (Option 6.A) — one signal per top-level state slice; nested signal per in-progress assistant message for streaming. |
| 7. Config lifecycle | **Fail-fast load + bootstrap; no hot-reload in v1; no fallback for required fields** (Option 7.A) |
| 8. Testing | **vitest split: pure-function unit tests + Fastify-route integration tests with mocked upstream** (Option 8.A) |

**Why this combination wins:**

- **Minimality is preserved.** Total new direct deps for the sub-app:
  `fastify`, `@fastify/static`, `undici` (already transitive in Node 22
  but explicit dep is fine), `zod` (~Zod 4), `vite`, `preact`,
  `@preact/signals`, `vitest`, `typescript`, `tsx`. Ten direct deps for
  a complete, typed, streaming chat surface — comparable to or smaller
  than any other realistic combination.
- **Wire-level fidelity.** Hand-rolled adapter + verbatim SSE relay
  guarantees that the existing tool-call markdown shim
  (`*[<toolName> …]*`) flows through unchanged and that the project's
  established error envelope `{ error: { type, message, …extras } }` is
  preserved end-to-end.
- **Perf where it matters.** Preact + signals updates the in-progress
  bubble in hundreds of nanoseconds per token chunk, avoiding transcript-
  wide re-renders that React's default reconciliation would cause.
- **Project-idiom continuity.** Fastify, Zod 4, vitest, ESM, Node ≥ 22,
  `reply.raw` SSE writes — all already in use in the host service.
- **No-fallback compliance.** Required-field validation runs at load and
  at every read; the only two documented defaults (`openai.baseUrl`,
  `CHAT_UI_PORT`) are already authorised in FU-6.

**Conditions under which the recommendation would change:**

- If the user requires AAD / Managed Identity for Azure (Q-4 changes),
  Option 3.B (the official `openai` SDK) becomes more attractive because
  it ships token-acquisition helpers via `@azure/identity`.
- If the SPA grows into a multi-screen app with client-side routing and
  forms, React + a router may eventually justify their bundle weight —
  not today.
- If the team starts running this in CI for E2E regressions, Option 8.B
  (Playwright) becomes worth revisiting.

**Caveats / prerequisites:**

- The `openai` profile's `baseUrl` default `https://api.openai.com` and
  the `CHAT_UI_PORT` default `5173` are the ONLY permitted fallbacks; any
  other default introduced during implementation must be added to the
  project's `CLAUDE.md` "Configuration Fallback Exceptions" section
  *before* it is merged.
- The `agent-host-cc` profile's `defaultModel` value MUST include the
  server's `MODEL_PREFIX` (default `cc.`) — call this out in the
  profile-creation form's hint text and in `chat-ui/README.md`.
- The Vite dev-server port and the Fastify api-port must be distinct
  during dev (5173 / 5174 by convention).

## Technical Research Guidance

**Research needed: No.**

All the topic decisions above are backed by stable, well-documented
patterns and by the existing project codebase:

- Fastify 5 + `@fastify/static` + `setNotFoundHandler` for SPA fallback
  is a single documented idiom in the `@fastify/static` README.
- `undici.request()` + `pipeline()` for SSE relay with backpressure is
  the standard Node ≥ 22 stream pattern — already used in
  `src/httpServer.ts`.
- Zod 4, vitest, async-generator test fakes, and `reply.raw` SSE writes
  are already exercised in the host service tests and source.
- Vite + Preact + `@preact/signals` is documented end-to-end on the
  Preact and Vite official sites.
- The OpenAI Chat Completions wire format and the Azure path
  (`/openai/deployments/{deployment}/chat/completions?api-version=…` with
  `api-key` header) are documented in the refined request itself
  (FU-11).

The implementer should be able to proceed straight to plan-004
(`docs/design/plan-004-chat-ui.md`) without an additional deep-research
pass. If during planning the user reverses Q-4 (i.e. requires AAD / MI
for Azure), a focused research pass on
`@azure/identity` token providers + the `openai` SDK's `AzureOpenAI`
client should be added at that point — but for the currently-confirmed
key-based scope, no gap exists.

## Implementation Considerations

Practical notes for whoever executes the recommendation:

1. **Suggested folder layout** under `chat-ui/`:
   ```
   chat-ui/
     package.json                  # own deps, no link to root
     tsconfig.json                 # ESM, strict, "module": "esnext"
     tsconfig.server.json          # server-only "outDir": "dist-server"
     vite.config.ts                # SPA build → dist-ui/
     index.html                    # Vite entry
     src/
       errors.ts                   # ConfigurationError, UpstreamError
       profiles/
         schemas.ts                # Zod 4 discriminated union
         storage.ts                # 0700 dir, 0600 file, JSON RW
         requestBuilder.ts         # (profile, body) → {url, headers, body}
       sse/
         relay.ts                  # undici.request + pipeline()
         parser.ts                 # if any client-side parsing needed
       server.ts                   # Fastify app factory + routes
       index.ts                    # entrypoint: loadConfig → buildApp → listen
       ui/
         main.tsx                  # Preact mount
         components/
           ChatPane.tsx
           ProfileList.tsx
           ProfileForm.tsx
         state/
           signals.ts              # profiles, activeProfileName, messages…
           api.ts                  # fetch /api/chat with EventSource-style read
     test_scripts/
       unit/
         schemas.test.ts
         requestBuilder.test.ts
         storage.test.ts
         sse.relay.test.ts
       integration/
         server.chat.test.ts
   ```
2. **Key decisions still to be made (open for plan-004):**
   - Exact REST shape for `/api/profiles*` (POST list, PUT/PATCH on name,
     DELETE).
   - Whether to mask `apiKey` field on the wire when listing profiles
     (recommended: yes — the SPA never needs the raw key, the proxy uses
     it server-side; the form's "reveal" toggle requested by the
     refined request needs a one-shot `GET /api/profiles/:name?reveal=
     true` endpoint).
   - Inline transcript banner format on profile switch (FU-10) — suggest
     a synthetic `system`-styled bubble inserted into the transcript
     signal.
3. **Dependencies / prerequisites:**
   - Node ≥ 22 (already a project floor).
   - A running `agent-host-cc` instance for AC-CU-2 verification.
   - Valid OpenAI and Azure OpenAI keys for AC-CU-3 / AC-CU-4 verification
     (developer-supplied).
4. **Pitfalls to watch for:**
   - **Buffering proxies:** ensure `Content-Type: text/event-stream`,
     `Cache-Control: no-cache`, `Connection: keep-alive`, AND
     `X-Accel-Buffering: no` headers are set on `reply.raw` before the
     first byte; without the last one, some intermediate proxies (e.g.
     nginx) buffer SSE. Localhost-only dev usually doesn't need it but
     it's free insurance.
   - **`pipeline()` end-handling:** call `pipeline(upstream.body,
     reply.raw, { end: false })` — letting `pipeline` end `reply.raw`
     would cause Fastify to think the response is finished before the
     `[DONE]` sentinel is emitted by the upstream; with `end: false`,
     the project's established `finally`-block that writes `data:
     [DONE]\n\n` keeps working.
   - **Abort propagation:** create one `AbortController` per request,
     pass `signal` to `undici.request`, and abort it from
     `request.socket.on('close', …)` so a closed browser tab tears down
     the upstream.
   - **Preact signal arrays:** to push a new message, write
     `messages.value = [...messages.value, msg]` — to append a token to
     the streaming bubble, mutate `msg.content.value += delta` (keep
     each message's `content` as its own nested signal).
   - **Azure body shape:** for `azure-openai`, omit `model` from the JSON
     body (deployment goes in the URL); the request builder must strip
     it, not just leave it.
   - **Model-prefix footgun:** when the user picks an `agent-host-cc`
     backend, the profile-creation form should call
     `GET /v1/models` against the configured `baseUrl` + `apiKey` and
     suggest the discovered IDs, so the user does not forget to include
     `cc.` (or whatever `MODEL_PREFIX` is configured upstream).
   - **Zod-4 discriminated unions:** the schema should be
     `z.discriminatedUnion('backendKind', [agentHostSchema, openaiSchema,
     azureSchema])` so missing-field errors point cleanly at the
     offending profile and field path.
5. **Suggested first steps for plan-004:**
   1. Scaffold `chat-ui/package.json`, `tsconfig.json`, `vite.config.
      ts`, `tsconfig.server.json`.
   2. Implement profile Zod schemas + storage + a vitest covering both.
   3. Implement `requestBuilder.ts` + a vitest covering all three
      branches.
   4. Implement Fastify `/api/chat` route with `undici` + `pipeline()` +
      mocked-upstream integration test.
   5. Wire up the SPA (Preact + signals) against the `/api` surface.
   6. Document run/install in `chat-ui/README.md`; add `plan-004-chat-
      ui.md` and the project-design / project-functions updates.

## References

| # | Source | URL | What was learned |
|---|--------|-----|-----------------|
| 1 | `@fastify/static` README | https://github.com/fastify/fastify-static | SPA fallback via `setNotFoundHandler` + `reply.sendFile('index.html')`; `wildcard: false` for encapsulated mounts; cache-control hint to mark `index.html` non-cacheable. |
| 2 | `@fastify/static` on npm | https://www.npmjs.com/package/@fastify/static | Confirms current `@fastify/static` API surface. |
| 3 | Vite Why Vite | https://vite.dev/guide/why | Vite uses esbuild for dev transpile and Rollup for production tree-shaking; HMR ~10–20 ms; native ESM dev server. |
| 4 | Better Stack — esbuild vs Vite | https://betterstack.com/community/guides/scaling-nodejs/esbuild-vs-vite/ | esbuild has no first-class dev server / HMR; Vite layers HMR + asset handling on top of esbuild's transpiler. |
| 5 | Strapi — Modern bundlers 2025 | https://strapi.io/blog/modern-javascript-bundlers-comparison-2025 | Bundle-size and dev-server tradeoffs across Vite / esbuild / Rollup / Webpack in 2025. |
| 6 | Preact Signals Guide | https://preactjs.com/guide/v10/signals/ | Signals' `.value` API, fine-grained reactivity, the array-mutation gotcha, and direct DOM-binding via `effect()`. |
| 7 | Preact vs React | https://www.alphabold.com/preact-vs-react/ | Bundle sizes: React ~40 KB gz vs Preact ~3 KB gz; same component model. |
| 8 | RedMonk — Signals vs React Compiler | https://redmonk.com/kholterhoff/2025/05/13/javascript-signals-react-compiler/ | Signals' near-vanilla streaming-update perf. |
| 9 | `@fastify/sse` README | https://github.com/fastify/sse | `pipeline()` + `reply.raw` with `{ end: false }` is the correct relay pattern; backpressure considerations. |
| 10 | `fastify-sse-v2` README | https://github.com/mpetrunic/fastify-sse-v2 | `request.socket.on('close', …)` cleanup pattern; `highWaterMark` tuning. |
| 11 | Adventures in Nodeland — stream processing | https://adventures.nodeland.dev/archive/3x-faster-stream-processing/ | Backpressure semantics: use `pipeline()`, not manual `.on('data')` + `.write()`, when relaying SSE chunks. |
| 12 | Fastify issue #1877 — SSE | https://github.com/fastify/fastify/issues/1877 | Fastify's stance on SSE: write to `reply.raw` directly. |
| 13 | OpenAI Node SDK | https://github.com/openai/openai-node | `OpenAI` and `AzureOpenAI` clients; streaming via `stream:true` + `for await`. |
| 14 | OpenAI streaming docs | https://developers.openai.com/api/docs/guides/streaming-responses | Confirms `stream: true` returns `data: {…}\n\n` SSE with terminal `data: [DONE]`. |
| 15 | Azure OpenAI v1 API lifecycle | https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle | Azure v1 API URL shape (`/openai/v1/`) and `api-key` header convention. |
| 16 | Azure OpenAI streaming Q&A | https://learn.microsoft.com/en-us/answers/questions/1409726/streaming-with-azure-openai-api | Confirms Azure deployments support `stream:true` over the same SSE format. |
| 17 | Project file `src/openAiChatSseAdapter.ts` | (local) | Established SSE wire format: only `data:` lines, terminal `data: [DONE]`, error chunk shape `{ …, error:{ type, message } }`. |
| 18 | Project file `src/httpServer.ts` | (local) | Established `reply.raw` SSE write pattern, `Content-Type: text/event-stream` headers, `finally`-block `[DONE]` emission. |
| 19 | Project file `src/types.ts` | (local) | Zod 4 `z.looseObject` + `z.infer` idiom — to be reused for profile schemas. |
| 20 | Project file `src/config.ts` | (local) | `required()` / `intOr()` no-fallback config idiom — to be mirrored in chat-ui's config loader. |

## Original Request

This investigation responds to the orchestrator's directive to evaluate
implementation approaches for the minimal multi-backend chat UI defined
in `docs/design/refined-request-chat-ui.md`. The user has confirmed:

- UI surface = browser SPA served by a tiny local Fastify server.
- Three backends (`agent-host-cc`, `openai`, `azure-openai`) over OpenAI
  Chat Completions wire format.
- Zod-validated, multi-named profiles persisted at
  `~/.agent-host-cc/chat-ui/profiles.json` with `0700`/`0600` perms.
- Mid-chat profile switch preserves history.
- SSE streaming on by default for all three backends.
- Sub-application under `chat-ui/`, NOT routed through
  `/tool-conventions`.

The full refined request, including FU-1 … FU-17 functional requirements
and AC-CU-1 … AC-CU-12 acceptance criteria, is preserved in
`docs/design/refined-request-chat-ui.md`.
