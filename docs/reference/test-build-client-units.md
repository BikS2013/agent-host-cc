---
scope: "Client-side unit tests for chat-ui — sseClient, api, state"
status: completed
mode: write-and-run
scope_slug: client-units
language: typescript
framework: vitest
test_command_full: "cd chat-ui && npx vitest run"
test_command_scope: "cd chat-ui && npx vitest run test/client/sseClient.test.ts test/client/api.test.ts test/client/state.test.ts"
test_dir: chat-ui/test/client
target_path: chat-ui
test_files_owned:
  - chat-ui/test/client/sseClient.test.ts
  - chat-ui/test/client/api.test.ts
  - chat-ui/test/client/state.test.ts
tests_added: 54
tests_updated: 0
tests_run: 54
tests_passed: 54
tests_failed: 0
implementation_gaps: 0
built_at: "2026-05-10T21:00:00Z"
last_built_commit: null
---

# Test Build — Client-side unit tests (sseClient, api, state)

## 1. Summary

Status: **completed**. Framework: vitest 4.1.5, environment: jsdom (installed as a missing peer dependency — see Manual Review). All three test files were created from scratch with 54 tests total: 11 for `sseClient`, 14 for `api`, and 29 for `state`. All 54 tests pass with exit code 0 and no LSP diagnostics.

## 2. Scope Resolved

**`chat-ui/client/src/lib/sseClient.ts`**
- `streamChat(body, callbacks)` — SSE consumer over fetch/ReadableStream

**`chat-ui/client/src/lib/api.ts`**
- `getProfiles()` — GET /api/profiles
- `createProfile(input)` — POST /api/profiles
- `updateProfile(id, input)` — PUT /api/profiles/:id
- `deleteProfile(id)` — DELETE /api/profiles/:id
- `activateProfile(id)` — POST /api/profiles/:id/activate

**`chat-ui/client/src/state.ts`**
- Signals: `profiles`, `activeProfileId`, `messages`, `streamingMessageId`, `lastError`
- Actions: `loadProfiles`, `selectProfile`, `clearTranscript`, `sendMessage`, `appendDelta`, `createProfile`, `updateProfile`, `deleteProfile`
- Internal: `messagesForUpstream` (tested indirectly via `sendMessage`)

## 3. Existing Coverage

No prior test files existed for any of the in-scope symbols. `test/client/` directory was created by this agent.

## 4. Plan

| # | target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|---|
| 1 | `streamChat` | unit | sseClient.test.ts | happy path: role+deltas+DONE | Proves onDelta fires for each content chunk, onDone fires once, onError never fires |
| 2 | `streamChat` | unit | sseClient.test.ts | multi-line data: concatenation | Proves `data: line1\ndata: line2\n\n` is joined into one payload |
| 3 | `streamChat` | unit | sseClient.test.ts | actual multi-line frame parse error | Proves raw non-JSON multi-line payload surfaces as parse_error |
| 4 | `streamChat` | unit | sseClient.test.ts | no data: frame ignored | Proves keep-alive comment-only frames are silently skipped |
| 5 | `streamChat` | error_path | sseClient.test.ts | malformed JSON → parse_error | Proves invalid JSON calls onError without crashing |
| 6 | `streamChat` | error_path | sseClient.test.ts | event:error line → onError | Proves named SSE error event routes to onError |
| 7 | `streamChat` | error_path | sseClient.test.ts | in-band error chunk → onError | Proves `{error:{…}}` chunk calls onError with status |
| 8 | `streamChat` | error_path | sseClient.test.ts | AbortSignal before fetch → clean exit | Proves AbortError at fetch() resolves quietly without onDone |
| 9 | `streamChat` | error_path | sseClient.test.ts | AbortError mid-stream | Proves stream error from aborted stream is handled without crash |
| 10 | `streamChat` | error_path | sseClient.test.ts | non-2xx → onError with status | Proves HTTP 401 calls onError with status and message |
| 11 | `streamChat` | error_path | sseClient.test.ts | non-2xx non-JSON → fallback message | Proves plain-text 500 body produces a status-based message |
| 12 | `getProfiles` | unit | api.test.ts | GET /api/profiles returns parsed JSON | Proves correct HTTP method and parsed response shape |
| 13 | `getProfiles` | error_path | api.test.ts | non-2xx → ApiError | Proves error envelope fields (status, type, message) are captured |
| 14 | `createProfile` | unit | api.test.ts | POST with JSON body and content-type | Proves method, content-type, and body serialization |
| 15 | `createProfile` | error_path | api.test.ts | 422 → ApiError with issues | Proves Zod validation issues array is forwarded |
| 16 | `updateProfile` | unit | api.test.ts | PUT /api/profiles/:id | Proves correct URL, method, body |
| 17 | `updateProfile` | error_path | api.test.ts | body.id mismatch → client-side ApiError | Proves fast-fail client guard without network round-trip |
| 18 | `updateProfile` | error_path | api.test.ts | non-2xx → ApiError with message | Proves error message from server envelope is preserved |
| 19 | `deleteProfile` | unit | api.test.ts | DELETE /api/profiles/:id resolves void | Proves 204 returns undefined |
| 20 | `deleteProfile` | unit | api.test.ts | URL encoding of id | Proves spaces in id are percent-encoded |
| 21 | `deleteProfile` | error_path | api.test.ts | non-2xx → ApiError | Proves error message includes server string |
| 22 | `activateProfile` | unit | api.test.ts | POST /api/profiles/:id/activate | Proves method, URL, and returned activeProfileId |
| 23 | `activateProfile` | unit | api.test.ts | URL encoding of id | Proves slashes in id are percent-encoded |
| 24 | `activateProfile` | error_path | api.test.ts | non-2xx → ApiError with useful message | Proves type and message from envelope |
| 25 | `activateProfile` | error_path | api.test.ts | non-JSON 504 → fallback message | Proves status is in message when body is not JSON |
| 26 | `loadProfiles` | unit | state.test.ts | populates profiles.value | Proves array is set from API response |
| 27 | `loadProfiles` | unit | state.test.ts | sets activeProfileId.value | Proves active id is propagated |
| 28 | `loadProfiles` | unit | state.test.ts | clears lastError on success | Proves error signal is nulled |
| 29 | `loadProfiles` | error_path | state.test.ts | sets lastError on failure | Proves error string is set when API throws |
| 30 | `selectProfile` | unit | state.test.ts | updates activeProfileId | Proves signal is updated to newly activated id |
| 31 | `selectProfile` | unit | state.test.ts | inserts system banner | Proves system message is appended |
| 32 | `selectProfile` | unit | state.test.ts | banner prefix matches filter | Proves banner starts with "— switched to profile" (FU-10) |
| 33 | `selectProfile` | unit | state.test.ts | preserves prior messages | Proves existing messages are not cleared (FU-10 / A-7) |
| 34 | `selectProfile` | error_path | state.test.ts | sets lastError on failure | Proves error propagated to signal |
| 35 | `clearTranscript` | unit | state.test.ts | resets messages to [] | Proves array is emptied |
| 36 | `clearTranscript` | unit | state.test.ts | clears streamingMessageId | Proves streaming id is nulled |
| 37 | `clearTranscript` | unit | state.test.ts | clears lastError | Proves error signal is nulled |
| 38 | `appendDelta` | unit | state.test.ts | mutates content signal | Proves nested signal value is extended |
| 39 | `appendDelta` | unit | state.test.ts | does NOT replace messages array | Proves reference identity of messages array is preserved |
| 40 | `appendDelta` | error_path | state.test.ts | unknown id silently dropped | Proves no throw on missing message id |
| 41 | `sendMessage` | unit | state.test.ts | appends user+assistant messages | Proves two messages created immediately |
| 42 | `sendMessage` | unit | state.test.ts | sets/clears streamingMessageId | Proves streaming id lifecycle |
| 43 | `sendMessage` | unit | state.test.ts | applies deltas via appendDelta | Proves delta content accumulates in assistant signal |
| 44 | `sendMessage` | unit | state.test.ts | clears streamingMessageId on done | Proves signal nulled after onDone |
| 45 | `sendMessage` | error_path | state.test.ts | sets lastError on onError | Proves error routed to signal |
| 46 | `sendMessage` | unit | state.test.ts | filters switch-banner from wire messages | Proves messagesForUpstream removes system banners (AC-CU-11) |
| 47 | `sendMessage` | error_path | state.test.ts | no active profile → lastError | Proves guard condition |
| 48 | `sendMessage` | unit | state.test.ts | empty text → no-op | Proves blank input is ignored |
| 49 | `createProfile` (state) | unit | state.test.ts | calls api.createProfile and refreshes | Proves CRUD + reload pattern |
| 50 | `createProfile` (state) | error_path | state.test.ts | sets lastError on failure | Proves null returned and error surfaced |
| 51 | `updateProfile` (state) | unit | state.test.ts | calls api.updateProfile and refreshes | Proves CRUD + reload pattern |
| 52 | `updateProfile` (state) | error_path | state.test.ts | sets lastError on failure | Proves null returned and error surfaced |
| 53 | `deleteProfile` (state) | unit | state.test.ts | calls api.deleteProfile and refreshes | Proves CRUD + reload pattern |
| 54 | `deleteProfile` (state) | error_path | state.test.ts | sets lastError on failure | Proves false returned and error surfaced |

## 5. Files Owned

| File | Reason |
|---|---|
| `chat-ui/test/client/sseClient.test.ts` | new |
| `chat-ui/test/client/api.test.ts` | new |
| `chat-ui/test/client/state.test.ts` | new |

## 6. Test Run Results

All 54 tests passed. Run log summary:

```
 RUN  v4.1.5 chat-ui

 Test Files  3 passed (3)
      Tests  54 passed (54)
   Start at  22:57:40
   Duration  373ms
```

No failures. No implementation gaps detected.

## 7. Implementation Gaps

None.

## 8. Manual Review Needed

### jsdom not installed — package.json was modified

The task instructions specified `// @vitest-environment jsdom` and stated "jsdom is bundled with vitest 4." In practice, `jsdom` is a **peer dependency** of vitest 4 marked optional — it is NOT bundled and was not present in `node_modules`. Without it, every `@vitest-environment jsdom` file fails with `Cannot find package 'jsdom'` before any test file is processed.

**Action taken:** `npm install --save-dev jsdom` was executed inside `chat-ui/`, which modified `chat-ui/package.json` and `chat-ui/package-lock.json`. This was necessary to make any of the assigned tests runnable.

**Human action required:** Confirm that `"jsdom"` entry in `devDependencies` of `chat-ui/package.json` is acceptable and commit `package.json` + `package-lock.json` along with the test files.

### `vi.mock` hoisting and `@preact/signals` import ordering

The state test file mocks both `api` and `sseClient` modules via `vi.mock(...)` at the top of the file, then imports the real `signal` factory from `@preact/signals` as a regular static import. This works because `@preact/signals` is not mocked. If a future change moves signals out of the `@preact/signals` package, the import path in `state.test.ts` will need updating.

### No shared fixture for `resetState`

The `resetState()` helper defined inside `state.test.ts` directly mutates module-level signals. If other test files (e.g., integration tests for the Fastify server) also import from `state.ts`, running all tests in the same process could leave signal state dirty. The current `beforeEach(resetState)` calls guard within this file, but if vitest pools workers (default), this is not an issue — each test file runs in its own worker. No action needed unless the project switches to a `threads: false` pool.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `cd chat-ui && npx vitest run test/client/sseClient.test.ts` | 1 (jsdom missing) |
| 2 | `cd chat-ui && npm install --save-dev jsdom` | 0 |
| 3 | `cd chat-ui && npx vitest run test/client/sseClient.test.ts` | 0 (11 passed) |
| 4 | `cd chat-ui && npx vitest run test/client/api.test.ts` | 1 (5 test-bug failures — double Response.body consumption) |
| 5 | `cd chat-ui && npx vitest run test/client/api.test.ts` | 0 (14 passed, after fixing mockImplementation) |
| 6 | `cd chat-ui && npx vitest run test/client/state.test.ts` | 1 (parse error — await inside non-async it body) |
| 7 | `cd chat-ui && npx vitest run test/client/state.test.ts` | 0 (29 passed, after removing dynamic imports) |
| 8 | `cd chat-ui && npx vitest run test/client/sseClient.test.ts test/client/api.test.ts test/client/state.test.ts` | 0 (54 passed) |
