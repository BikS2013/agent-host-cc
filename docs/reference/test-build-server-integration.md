---
scope: Server-side Fastify HTTP integration tests for chat-ui — /api/profiles* endpoints and POST /api/chat SSE relay
status: completed
mode: write-and-run
scope_slug: server-integration-profiles-chat-relay
language: typescript
framework: vitest (fastify app.inject)
test_command_full: cd chat-ui && npx vitest run
test_command_scope: cd chat-ui && npx vitest run test/integration/profileRoutes.test.ts test/integration/chatRelay.test.ts
test_dir: chat-ui/test/integration
target_path: chat-ui
test_files_owned:
  - chat-ui/test/integration/profileRoutes.test.ts
  - chat-ui/test/integration/chatRelay.test.ts
  - chat-ui/test/integration/helpers/buildTestServer.ts
tests_added: 40
tests_updated: 0
tests_run: 40
tests_passed: 40
tests_failed: 0
implementation_gaps: 0
built_at: "2026-05-10T19:57:00Z"
last_built_commit: null
---

# Test Build — Server-side Fastify HTTP Integration Tests (chat-ui)

## 1. Summary

Status: **completed**. All 40 tests pass across both files (25 profile-route tests, 15 chat-relay tests). The tests use Fastify's `app.inject()` against the exported `buildServer()` function, with a per-test temporary `profiles.json` file for isolation. `undici.request` is intercepted via `vi.mock` in the relay tests so no real HTTP connections are made. No production source files were modified.

## 2. Scope Resolved

**Source files tested:**

- `chat-ui/server/index.ts` — `buildServer()` exported factory
- `chat-ui/server/profileRoutes.ts` — `registerProfileRoutes()`, `_internal.isLocalhostIp`
- `chat-ui/server/profileStore.ts` — `createProfileStore()`, `createProfile`, `updateProfile`, `deleteProfile`, `setActiveProfileId`, `readFile`
- `chat-ui/server/profileSchema.ts` — `ProfileSchema`, `CreateProfileInputSchema`, `REDACTED_API_KEY`, `redactProfile`
- `chat-ui/server/chatRelay.ts` — `handleChatRequest()`, `resolveProfileId`
- `chat-ui/server/requestBuilder.ts` — `buildUpstreamRequest()` (exercised via relay)
- `chat-ui/server/errors.ts` — `ProfileNotFoundError`, `ValidationError`, `UpstreamError`
- `chat-ui/server/config.ts` — `loadServerConfig()`, `bootstrapConfigDir()` (called inside buildServer)

**In-scope endpoints and symbols:**

| Endpoint | Symbols |
|---|---|
| GET /api/profiles | `registerProfileRoutes`, `store.readFile`, `redactProfile` |
| POST /api/profiles | `createProfile`, `CreateProfileInputSchema.safeParse`, `redactProfile` |
| PUT /api/profiles/:id | `updateProfile`, `ProfileSchema.safeParse`, REDACTED_API_KEY sentinel |
| DELETE /api/profiles/:id | `deleteProfile` |
| POST /api/profiles/:id/activate | `setActiveProfileId` |
| GET /api/profiles/:id?reveal=true | `isLocalhostIp`, `store.getProfile`, `redactProfile` |
| POST /api/chat | `handleChatRequest`, `resolveProfileId`, `buildUpstreamRequest`, `undici.request` |

## 3. Existing Coverage

No existing test files were found for the in-scope chat-ui server endpoints. The `chat-ui/test/` directory did not exist prior to this build. The host service's `test/integration/` directory (for `src/httpServer.ts`) was not in scope.

| Symbol | Prior test coverage |
|---|---|
| `buildServer` | None |
| `registerProfileRoutes` | None |
| `handleChatRequest` | None |
| All profile store operations via REST | None |

## 4. Plan

| target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|
| GET /api/profiles | unit | profileRoutes.test.ts | returns 200 with empty profiles list | Verifies baseline list endpoint works with empty store |
| GET /api/profiles | unit | profileRoutes.test.ts | redacts apiKey with '<redacted>' sentinel | Verifies §14.6.1 apiKey redaction on list |
| GET /api/profiles | unit | profileRoutes.test.ts | returns activeProfileId for first profile | Verifies auto-activation of first-created profile |
| POST /api/profiles (agent-host-cc) | unit | profileRoutes.test.ts | creates agent-host-cc profile → 201 | All three backendKind variants create successfully |
| POST /api/profiles (openai) | unit | profileRoutes.test.ts | creates openai profile → 201 | OpenAI variant |
| POST /api/profiles (azure-openai) | unit | profileRoutes.test.ts | creates azure-openai profile → 201 | Azure variant |
| POST /api/profiles | unit | profileRoutes.test.ts | appears in subsequent GET list | Profile is persisted and retrievable |
| POST /api/profiles | error_path | profileRoutes.test.ts | returns 422 on missing apiKey | Zod validation rejects missing required field |
| POST /api/profiles | error_path | profileRoutes.test.ts | returns 422 on missing backendKind | Discriminated union fails without discriminator |
| POST /api/profiles | error_path | profileRoutes.test.ts | returns 422 on invalid apiVersion | Azure apiVersion regex validation |
| POST /api/profiles | error_path | profileRoutes.test.ts | returns 422 when id is in body | Server rejects client-supplied id |
| PUT /api/profiles/:id | unit | profileRoutes.test.ts | preserves key when sent '<redacted>' | §14.6.3 sentinel semantics |
| PUT /api/profiles/:id | unit | profileRoutes.test.ts | overwrites key when new key sent | Key rotation path |
| PUT /api/profiles/:id | error_path | profileRoutes.test.ts | returns 404 for non-existent id | Store lookup failure |
| DELETE /api/profiles/:id | unit | profileRoutes.test.ts | deletes non-active profile → 204 | Normal delete |
| DELETE /api/profiles/:id | unit | profileRoutes.test.ts | auto-activates another on active delete | §14.6.4 auto-activate |
| DELETE /api/profiles/:id | error_path | profileRoutes.test.ts | returns 422 when deleting only active | §14.6.4 guard |
| DELETE /api/profiles/:id | error_path | profileRoutes.test.ts | returns 404 for non-existent id | Store lookup failure |
| POST /api/profiles/:id/activate | unit | profileRoutes.test.ts | sets active and GET reflects change | Activation persisted |
| POST /api/profiles/:id/activate | error_path | profileRoutes.test.ts | returns 404 for non-existent id | Unknown id guard |
| GET /api/profiles/:id?reveal=true | unit | profileRoutes.test.ts | raw key from 127.0.0.1 | §14.6.2 localhost gate — IPv4 |
| GET /api/profiles/:id?reveal=true | unit | profileRoutes.test.ts | raw key from ::1 | §14.6.2 localhost gate — IPv6 |
| GET /api/profiles/:id?reveal=true | error_path | profileRoutes.test.ts | 422 from non-loopback | Non-loopback blocked |
| GET /api/profiles/:id?reveal=true | unit | profileRoutes.test.ts | redacted when reveal absent | Default redaction |
| GET /api/profiles/:id?reveal=true | error_path | profileRoutes.test.ts | 404 for non-existent id | Unknown id guard |
| handleChatRequest (SSE passthrough) | integration | chatRelay.test.ts | 200 text/event-stream all chunks in order | Full SSE relay pipeline |
| handleChatRequest (chunk ordering) | integration | chatRelay.test.ts | SSE chunks in original order | Order preservation |
| buildUpstreamRequest (agent-host-cc) | integration | chatRelay.test.ts | calls {baseUrl}/v1/chat/completions, Bearer header | Correct upstream URL + auth |
| buildUpstreamRequest (agent-host-cc) | integration | chatRelay.test.ts | body includes defaultModel | Model field forwarded |
| buildUpstreamRequest (openai) | integration | chatRelay.test.ts | https://api.openai.com, Authorization: Bearer | OpenAI URL + auth |
| buildUpstreamRequest (azure-openai) | integration | chatRelay.test.ts | Azure URL with deployment + api-key header | Azure URL construction + api-key |
| buildUpstreamRequest (azure-openai) | integration | chatRelay.test.ts | no model field in body | Azure model-strip requirement |
| handleChatRequest (upstream 401) | error_path | chatRelay.test.ts | upstream 401 → 502 upstream_error | Upstream error translation |
| handleChatRequest (upstream 500) | error_path | chatRelay.test.ts | upstream 500 → 502 | Upstream error translation |
| resolveProfileId (no active) | error_path | chatRelay.test.ts | 404 profile_not_found before upstream | No active profile guard |
| ChatRequestSchema (empty messages) | error_path | chatRelay.test.ts | 422 on empty messages | Zod body validation |
| ChatRequestSchema (absent messages) | error_path | chatRelay.test.ts | 422 on absent messages | Zod body validation |
| resolveProfileId (explicit profileId) | integration | chatRelay.test.ts | uses specified profileId over active | Explicit profileId wins |
| resolveProfileId (ghost profileId) | error_path | chatRelay.test.ts | 404 when profileId not found | Non-existent profile guard |
| AbortController wiring | integration | chatRelay.test.ts | signal is defined and not pre-aborted | AbortController lifecycle |

## 5. Files Owned

| File | Reason |
|---|---|
| `chat-ui/test/integration/profileRoutes.test.ts` | New — profile REST endpoint integration tests |
| `chat-ui/test/integration/chatRelay.test.ts` | New — chat relay SSE integration tests with mocked undici |
| `chat-ui/test/integration/helpers/buildTestServer.ts` | New — shared bootstrap helper (fresh temp HOME + server per test) |

## 6. Test Run Results

### profileRoutes.test.ts (25 tests)

```
npx vitest run test/integration/profileRoutes.test.ts
exit code: 0
Tests: 25 passed
```

| Test | Result |
|---|---|
| GET /api/profiles > returns 200 with empty profiles list | PASS |
| GET /api/profiles > redacts apiKey with '<redacted>' sentinel | PASS |
| GET /api/profiles > returns activeProfileId (auto-activated) | PASS |
| POST /api/profiles > creates agent-host-cc profile → 201 | PASS |
| POST /api/profiles > creates openai profile → 201 | PASS |
| POST /api/profiles > creates azure-openai profile → 201 | PASS |
| POST /api/profiles > appears in subsequent GET list | PASS |
| POST /api/profiles > returns 422 on missing apiKey | PASS |
| POST /api/profiles > returns 422 on missing backendKind | PASS |
| POST /api/profiles > returns 422 on invalid apiVersion | PASS |
| POST /api/profiles > returns 422 when id in body | PASS |
| PUT /api/profiles/:id > preserves key when sent '<redacted>' | PASS |
| PUT /api/profiles/:id > overwrites key when new key sent | PASS |
| PUT /api/profiles/:id > returns 404 for non-existent id | PASS |
| DELETE /api/profiles/:id > deletes non-active profile → 204 | PASS |
| DELETE /api/profiles/:id > auto-activates another on active delete | PASS |
| DELETE /api/profiles/:id > returns 422 deleting only active | PASS |
| DELETE /api/profiles/:id > returns 404 for non-existent id | PASS |
| POST /api/profiles/:id/activate > sets active, GET reflects | PASS |
| POST /api/profiles/:id/activate > returns 404 for non-existent | PASS |
| GET /api/profiles/:id?reveal=true > raw key from 127.0.0.1 | PASS |
| GET /api/profiles/:id?reveal=true > raw key from ::1 | PASS |
| GET /api/profiles/:id?reveal=true > 422 from non-loopback | PASS |
| GET /api/profiles/:id?reveal=true > redacted when reveal absent | PASS |
| GET /api/profiles/:id?reveal=true > 404 for non-existent id | PASS |

### chatRelay.test.ts (15 tests)

```
npx vitest run test/integration/chatRelay.test.ts
exit code: 0
Tests: 15 passed
```

| Test | Result |
|---|---|
| POST /api/chat — happy path > 200 text/event-stream all chunks | PASS |
| POST /api/chat — happy path > SSE chunks in original order | PASS |
| POST /api/chat — agent-host-cc > correct URL + Authorization | PASS |
| POST /api/chat — agent-host-cc > body includes defaultModel | PASS |
| POST /api/chat — openai > https://api.openai.com + Bearer | PASS |
| POST /api/chat — azure-openai > correct Azure URL + api-key | PASS |
| POST /api/chat — azure-openai > no model field in body | PASS |
| POST /api/chat — upstream 401 > relay returns 502 upstream_error | PASS |
| POST /api/chat — upstream 500 > relay returns 502 | PASS |
| POST /api/chat — no active profile > 404 profile_not_found | PASS |
| POST /api/chat — validation > 422 on empty messages | PASS |
| POST /api/chat — validation > 422 on absent messages | PASS |
| POST /api/chat — explicit profileId > uses specified id | PASS |
| POST /api/chat — explicit profileId > 404 when ghost id | PASS |
| POST /api/chat — abort signal > signal defined, not pre-aborted | PASS |

### Diagnosis notes

One test per file initially failed due to a test-bug (not an implementation gap):

- **profileRoutes**: `PUT /api/profiles/:id > returns 404 for non-existent id` — the test used `"00000000-0000-0000-0000-000000000099"` as the fake UUID. Zod 4 validates UUIDs strictly (requires version bit 1–8 in the third group), so the body failed `ProfileSchema.safeParse` before the store was queried, returning 422 instead of 404. Fixed by using a properly-formatted v4 UUID (`a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`) that does not exist in the store.
- **chatRelay**: Same UUID issue in `explicit profileId > returns 404 when ghost id`. The `profileId` field is `z.string().uuid()` in `ChatRequestSchema`; the invalid UUID triggered 422 at validation, not 404. Fixed with the same valid v4 UUID.

Both were test-bugs (overly strict Zod 4 UUID format check); the implementation correctly returns 404 for properly-formatted but non-existent UUIDs.

## 7. Implementation Gaps

None. All 40 tests pass against the production implementation. No acceptance criteria are unmet by the code under test.

## 8. Manual Review Needed

### Vitest config does not cover test/integration/ by default

The `chat-ui/` project has no explicit `vitest.config.ts`. Vitest uses `vite.config.ts` for its config, which is a client-side Vite config for the SPA. The `tsconfig.server.json` excludes `test/` from compilation (`"exclude": ["node_modules", "dist", "client", "test"]`), which is correct for production builds. The tests run fine because vitest resolves imports via its own transform pipeline (tsx under the hood). However, **if the team adds a `vitest.config.ts` in the future**, they should ensure:

1. `environment: 'node'` is set for the `test/integration/**` pattern (server code requires Node built-ins).
2. The `include` pattern covers `test/**/*.test.ts`.

This note is informational; no action required to make the current tests pass.

### AbortController mid-stream browser-disconnect test is partial

The test verifies that the `AbortSignal` passed to `undici.request` is initially not aborted. A full test that confirms the signal becomes aborted when the client disconnects mid-stream would require piping the response through an actual TCP socket (or a custom stream wrapper) rather than using `app.inject()`. Simulating mid-stream disconnect via `inject()` is not straightforward in Fastify's test infrastructure. The wiring (`request.raw.on("close", () => ac.abort())`) is visible in the source at `chatRelay.ts:116` and is correct by inspection. A manual E2E test (curl pipe with Ctrl-C) or a more complex stream-intercept approach would be needed to fully exercise this branch automatically.

This is filed for manual review — not edited into shared infra.

## 9. Commands Run

| # | Command | Exit Code |
|---|---|---|
| 1 | `find chat-ui -type f \| sort` | 0 |
| 2 | `ls chat-ui/` | 0 |
| 3 | `cd chat-ui && npx vitest run test/integration/profileRoutes.test.ts --reporter=verbose` | 1 (1 test-bug found) |
| 4 | Fixed UUID in profileRoutes.test.ts (test-bug correction) | — |
| 5 | `cd chat-ui && npx vitest run test/integration/profileRoutes.test.ts --reporter=verbose` | 0 (25/25) |
| 6 | `cd chat-ui && npx vitest run test/integration/chatRelay.test.ts --reporter=verbose` | 1 (1 test-bug found) |
| 7 | Fixed UUID in chatRelay.test.ts (test-bug correction) | — |
| 8 | `cd chat-ui && npx vitest run test/integration/chatRelay.test.ts --reporter=verbose` | 0 (15/15) |
| 9 | `cd chat-ui && npx vitest run test/integration/profileRoutes.test.ts test/integration/chatRelay.test.ts --reporter=verbose` | 0 (40/40) |
