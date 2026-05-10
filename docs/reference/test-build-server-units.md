---
status: completed
mode: write-and-run
scope_slug: server-side-pure-module-unit-tests-chat-ui
language: typescript
framework: vitest
test_command_full: cd chat-ui && npx vitest run
test_command_scope: cd chat-ui && npx vitest run test/unit/profileSchema.test.ts test/unit/requestBuilder.test.ts test/unit/profileStore.test.ts test/unit/config.test.ts
test_dir: /Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit
target_path: /Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui
test_files_owned:
  - /Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit/profileSchema.test.ts
  - /Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit/requestBuilder.test.ts
  - /Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit/profileStore.test.ts
  - /Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit/config.test.ts
tests_added: 148
tests_updated: 0
tests_run: 148
tests_passed: 148
tests_failed: 0
implementation_gaps: 0
built_at: "2026-05-10T22:56:17Z"
last_built_commit: null
---

# Test Build — Server-side pure-module unit tests (chat-ui)

## 1. Summary

Status: **completed**. Framework: vitest 4.1.5, Node 22, ESM strict mode. All four test files were created from scratch (no prior unit tests existed under `chat-ui/test/unit/`). A minimal `vitest.config.ts` was also created since none existed and no vitest config block was present in `package.json`. 148 tests were added across the four modules; 148 pass, 0 fail, 0 implementation gaps.

One intermediate failure was encountered and self-corrected: the atomic-write test initially used `vi.spyOn` on an ESM `node:fs` named export, which is not re-definable in Node 22 ESM (frozen module namespace). The test was rewritten to use a read-only-directory approach that exercises the same observable guarantee without requiring any spy infrastructure or shared-config changes.

## 2. Scope Resolved

### chat-ui/server/profileSchema.ts
Public symbols tested: `ProfileSchema`, `CreateProfileInputSchema`, `UpdateProfileInputSchema`, `ProfileStoreShapeSchema`, `REDACTED_API_KEY`, `redactProfile`.
Types re-exported but not directly tested as functions: `Profile`, `AgentHostProfile`, `OpenAiProfile`, `AzureOpenAiProfile`, `CreateProfileInput`, `UpdateProfileInput`, `ProfileStoreShape`.

### chat-ui/server/requestBuilder.ts
Public symbols tested: `buildUpstreamRequest`, `applyProfileDefaults` (via `buildUpstreamRequest`).
Interfaces used as fixtures: `ChatMessage`, `UpstreamRequestInput`, `UpstreamRequest`.

### chat-ui/server/profileStore.ts
Public symbols tested: `createProfileStore` (all methods: `listProfiles`, `getProfile`, `createProfile`, `updateProfile`, `deleteProfile`, `getActiveProfileId`, `setActiveProfileId`, `readFile`), `isRedactedSentinel` (not directly tested — its correctness is implied by `REDACTED_API_KEY` sentinel tests in profileSchema).
Also tested: `bootstrapConfigDir` (imported from config.ts) as it is the canonical bootstrap step for the store.

### chat-ui/server/config.ts
Public symbols tested: `loadServerConfig`, `bootstrapConfigDir`.
Internal helpers `intOrUndefined`, `dirOf`, `resolveStaticDir`, `defaultServeStatic` are tested indirectly through `loadServerConfig` behaviour.

## 3. Existing Coverage

No existing test files were found under `chat-ui/test/unit/` before this run. The `chat-ui/test/` directory did not exist. Symbol-to-test-file map before this build:

| Symbol | Prior test coverage |
|---|---|
| `ProfileSchema` | none |
| `CreateProfileInputSchema` | none |
| `ProfileStoreShapeSchema` | none |
| `redactProfile` | none |
| `buildUpstreamRequest` | none |
| `createProfileStore` | none |
| `loadServerConfig` | none |
| `bootstrapConfigDir` | none |

## 4. Plan

All tests are in the `unit` category (pure function logic and deterministic I/O on temp filesystem). One `error_path` category and one `config_validation` category are folded into each module's unit describe blocks rather than separated.

| target_symbol | category | test_file | test_count | notes |
|---|---|---|---|---|
| `ProfileSchema` (agent-host-cc variant) | unit + error_path | profileSchema.test.ts | 15 | Required fields, optional fields, constraints |
| `ProfileSchema` (openai variant) | unit + error_path | profileSchema.test.ts | 8 | baseUrl default, constraints |
| `ProfileSchema` (azure-openai variant) | unit + error_path | profileSchema.test.ts | 9 | apiVersion regex, no defaultModel policy |
| `ProfileSchema` (discriminator) | error_path | profileSchema.test.ts | 2 | Unknown / absent backendKind |
| `CreateProfileInputSchema` | unit | profileSchema.test.ts | 4 | No-id variants for all three backends |
| `ProfileStoreShapeSchema` | unit + error_path | profileSchema.test.ts | 4 | Uniqueness constraint |
| `redactProfile` | unit | profileSchema.test.ts | 4 | Sentinel value, immutability |
| `buildUpstreamRequest` (agent-host-cc) | unit | requestBuilder.test.ts | 18 | URL, headers, body, profile defaults |
| `buildUpstreamRequest` (openai) | unit | requestBuilder.test.ts | 11 | URL fallback, headers, body |
| `buildUpstreamRequest` (azure-openai) | unit | requestBuilder.test.ts | 13 | URL format, api-key header, no model in body |
| `buildUpstreamRequest` (stream flag) | unit | requestBuilder.test.ts | 2 | Explicit true/false passthrough |
| `bootstrapConfigDir` (permissions) | unit | profileStore.test.ts | 4 | dir 0700, file 0600, idempotency |
| `createProfileStore` CRUD | unit + error_path | profileStore.test.ts | 14 | create/read/update/delete, errors |
| `createProfileStore` active profile | unit + error_path | profileStore.test.ts | 8 | Auto-activate, set, delete guard |
| `createProfileStore` malformed input | error_path | profileStore.test.ts | 4 | Invalid JSON, ENOENT, schema failure |
| `createProfileStore` atomic write | unit | profileStore.test.ts | 1 | Read-only dir proves original survives |
| `createProfileStore` file permissions | unit | profileStore.test.ts | 1 | 0600 after write |
| `loadServerConfig` CHAT_UI_PORT | unit + error_path + config_validation | config.test.ts | 10 | Default, parse, out-of-range, bad varName |
| `loadServerConfig` host | unit | config.test.ts | 1 | Always 127.0.0.1 |
| `loadServerConfig` CHAT_UI_PROFILES_PATH | unit | config.test.ts | 4 | Default, override, dirOf derivation |
| `loadServerConfig` CHAT_UI_SERVE_STATIC | unit | config.test.ts | 2 | true/false parsing |
| `bootstrapConfigDir` (filesystem) | unit | config.test.ts | 6 | Dir/file creation, permissions, idempotency, warn callback |
| No-fallback regression guard | config_validation | config.test.ts | 1 | Structural sanity on empty env |

## 5. Files Owned

| File | Reason |
|---|---|
| `/Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit/profileSchema.test.ts` | new |
| `/Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit/requestBuilder.test.ts` | new |
| `/Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit/profileStore.test.ts` | new |
| `/Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit/config.test.ts` | new |

Additionally created (not a test file, but required for test execution):
- `/Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/vitest.config.ts` — minimal config (`environment: "node"`, `include: ["test/**/*.test.ts"]`). Created only because no vitest config existed anywhere (neither as a standalone file nor as a block inside `package.json`).

## 6. Test Run Results

Final combined run: `cd chat-ui && npx vitest run test/unit/profileSchema.test.ts test/unit/requestBuilder.test.ts test/unit/profileStore.test.ts test/unit/config.test.ts --reporter=verbose` — exit code 0.

```
Test Files  4 passed (4)
Tests       148 passed (148)
Duration    164ms (transform 118ms, setup 0ms, import 180ms, tests 38ms)
```

No failures in the final run. One intermediate failure was self-corrected:

| Test | Intermediate error | Diagnosis | Fix |
|---|---|---|---|
| `atomic write > leaves the original file intact when renameSync throws` | `TypeError: Cannot spy on export "renameSync". Module namespace is not configurable in ESM.` | Test bug — `vi.spyOn` on ESM `node:fs` named exports is prohibited in Node 22 ESM; module namespace is frozen. | Rewrote test to make the temp directory read-only via `fs.chmodSync(tmpDir, 0o555)` before the failing write attempt. The observable guarantee (original file survives a failed write) is fully covered without any spy. |

## 7. Implementation Gaps

None. All tested behaviours are implemented exactly as the schema, design, and source code specify.

Minor policy observation (not a gap, documented for awareness): The `azure-openai` schema uses `z.object()` (Zod 4 default strict mode strips unknown fields). When `defaultModel` is added to an azure-openai input, Zod strips it silently rather than rejecting it. The test documents this as the actual policy — stripping is acceptable and the field is absent from the output. If the team wants strict rejection, `z.object(...).strict()` would be needed in `profileSchema.ts`, but this is a design choice, not a defect.

## 8. Manual Review Needed

### Atomic-write spy via ESM module namespace

The original plan called for `vi.spyOn(fs, "renameSync")` to simulate a mid-flight write failure. Node 22 ESM's frozen module namespace prevents this without `--experimental-vm-modules` or a module-mock setup (vitest's `vi.mock("node:fs", ...)` at module load time). To do this properly without the filesystem trick, a vitest setup file would need to configure `__mocks__/node/fs.ts`. That shared mock file would be owned by no single parallel agent. The current read-only-directory approach is equivalent and deterministic, so no shared infra change is needed in practice — this item is moot as implemented.

### `CHAT_UI_SERVE_STATIC` default-heuristic path

`defaultServeStatic()` always returns `true` (the implementation comment says it defaults to true and relies on Fastify to warn if `dist/client` is missing). There is no filesystem check inside the pure config function. The test therefore cannot verify "defaults to false in dev mode when `dist/client` is absent" without either (a) injecting the filesystem check into `loadServerConfig`, or (b) mocking `existsSync` at ESM module level. Neither is possible without touching production source or shared mock infrastructure. The current tests cover the explicit env-var override paths (`"true"` / `"false"`), which are the operationally important ones.

## 9. Commands Run

| Step | Command | Exit code |
|---|---|---|
| 1 | `cd /Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui && npx vitest --version` | 0 |
| 2 | `mkdir -p /Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui/test/unit` | 0 |
| 3 (write) | Created `vitest.config.ts` | — |
| 4 (write) | Created `test/unit/profileSchema.test.ts` | — |
| 5 (write) | Created `test/unit/requestBuilder.test.ts` | — |
| 6 (write) | Created `test/unit/profileStore.test.ts` | — |
| 7 (write) | Created `test/unit/config.test.ts` | — |
| 8 | `cd ... && npx vitest run test/unit/profileSchema.test.ts --reporter=verbose` | 0 (46/46) |
| 9 | `cd ... && npx vitest run test/unit/requestBuilder.test.ts --reporter=verbose` | 0 (46/46) |
| 10 | `cd ... && npx vitest run test/unit/profileStore.test.ts --reporter=verbose` | 1 (1 failure: ESM spy) |
| 11 (fix) | Rewrote atomic-write test; removed `vi` import | — |
| 12 | `cd ... && npx vitest run test/unit/profileStore.test.ts --reporter=verbose` | 0 (32/32) |
| 13 | `cd ... && npx vitest run test/unit/config.test.ts --reporter=verbose` | 0 (24/24) |
| 14 (final) | `cd ... && npx vitest run profileSchema requestBuilder profileStore config --reporter=verbose` | 0 (148/148) |
