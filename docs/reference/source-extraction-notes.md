# Source Extraction Notes

> **Purpose:** Historical record of what was extracted from the source `agent-host` service into `agent-host-cc`, what was renamed, and what was dropped. This document is the audit trail for plan-001 (`/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/plan-001-extract-and-rebrand.md`) and the codebase scan (`/Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/codebase-scan-source-agent-host.md`).
>
> **Read-only source repository:** `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host/`
> **Last extracted:** 2026-05-10.

This is reference material only. Nothing in this document is consumed by the build, the runtime, or any test. It exists so a future maintainer can answer "where did file X come from, and why does it look the way it does?" without re-reading the source repository.

---

## 1. Files copied verbatim then minimally rebranded

The following files were copied by plan-001 Phase A from the source `src/` and `test/` trees. Each file was then subjected to a Phase B/C/D/E sanitization pass that touched comments, error strings, env-var names, and the unused `@fastify/multipart` reference, but left the structural shape and line-by-line behaviour intact.

### Source files (TypeScript, under `/Users/giorgosmarinos/aiwork/agent-host-cc/src/`)

| File | Origin | Rebrand notes |
|---|---|---|
| `index.ts` | `…/agent-host/src/index.ts` | Updated expiry-warning labels for renamed env vars (`OPENWEBUI_API_KEY_EXPIRES_AT` → `FILES_API_KEY_EXPIRES_AT`); added the call site for the discriminated `Provider` (plan-002). |
| `httpServer.ts` | `…/agent-host/src/httpServer.ts` | `stripCcPrefix` made configurable via `cfg.modelPrefix` (plan-001 Phase C); comments referencing "Open WebUI" neutralised; added the `POST /v1/responses` route mount (plan-003 Phase 5). |
| `config.ts` | `…/agent-host/src/config.ts` | Added the `Provider` discriminated union (plan-002 Phase A); env-var renames (`OPENWEBUI_*` → `FILES_API_*`); added `MODEL_PREFIX`, `FILES_API_PATH_TEMPLATE`, `RESPONSES_TOOL_USE_RENDERING`. |
| `errors.ts` | `…/agent-host/src/errors.ts` | Single string rewrite at line 69 ("Open WebUI files API returned…" → "Files API returned…"). |
| `types.ts` | `…/agent-host/src/types.ts` | Added `ResponsesRequestSchema`, `InputMessageSchema`, `InputContentPartSchema`, and the `normalizeInput` helper (plan-003 Phase 4). |
| `agentRunner.ts` | `…/agent-host/src/agentRunner.ts` | None — interface preserved verbatim. |
| `claudeCodeRunner.ts` | `…/agent-host/src/claudeCodeRunner.ts` | Provider env injection refactored to a two-branch switch over `Provider.kind` (plan-002 Phase B); explicit `{ ...process.env, ...providerEnv }` spread (ADR-5). |
| `workspaceManager.ts` | `…/agent-host/src/workspaceManager.ts` | None — copied verbatim. |
| `attachmentProcessor.ts` | `…/agent-host/src/attachmentProcessor.ts` | Import rename (`fetchFromOpenWebUiFiles` → `fetchFromFilesApi`); call-site updated to pass `pathTemplate`. |
| `attachmentProcessor/dataUrlDecoder.ts` | `…/agent-host/src/attachmentProcessor/dataUrlDecoder.ts` | None — copied verbatim. |
| `attachmentProcessor/ssrfGuard.ts` | `…/agent-host/src/attachmentProcessor/ssrfGuard.ts` | None — copied verbatim. |
| `attachmentProcessor/remoteUrlFetcher.ts` | `…/agent-host/src/attachmentProcessor/remoteUrlFetcher.ts` | None — copied verbatim. |
| `attachmentProcessor/urlDetector.ts` | `…/agent-host/src/attachmentProcessor/urlDetector.ts` | None — copied verbatim. |

### Test files (under `/Users/giorgosmarinos/aiwork/agent-host-cc/test/`)

| File | Origin | Rebrand notes |
|---|---|---|
| `unit/attachmentProcessor.test.ts` | `…/agent-host/test/unit/attachmentProcessor.test.ts` | Mock import rename only. |
| `unit/claudeCodeRunner.test.ts` | `…/agent-host/test/unit/claudeCodeRunner.test.ts` | Added cases for the public-API path, the Foundry path, and the `process.env`-survival assertion (plan-002 Phase E). |
| `unit/config.test.ts` | `…/agent-host/test/unit/config.test.ts` | Env-var renames; added the four provider cases (public happy, Foundry happy, Foundry partial fail, public missing fail). |
| `unit/dataUrlDecoder.test.ts` | `…/agent-host/test/unit/dataUrlDecoder.test.ts` | None. |
| `unit/errors.test.ts` | `…/agent-host/test/unit/errors.test.ts` | None. |
| `unit/httpServer.test.ts` | `…/agent-host/test/unit/httpServer.test.ts` | Added `MODEL_PREFIX` cases; added `/v1/responses` route auth + 404 cases. |
| `unit/remoteUrlFetcher.test.ts` | `…/agent-host/test/unit/remoteUrlFetcher.test.ts` | None. |
| `unit/ssrfGuard.test.ts` | `…/agent-host/test/unit/ssrfGuard.test.ts` | None. |
| `unit/types.test.ts` | `…/agent-host/test/unit/types.test.ts` | Added `ResponsesRequestSchema` cases (plan-003 Phase 6). |
| `unit/urlDetector.test.ts` | `…/agent-host/test/unit/urlDetector.test.ts` | None. |
| `unit/workspaceManager.test.ts` | `…/agent-host/test/unit/workspaceManager.test.ts` | None. |
| `integration/agentHost.integration.test.ts` | `…/agent-host/test/integration/agentHost.integration.test.ts` | Fixture imports renamed; provider mode parameterised (plan-002 Phase E). |

### Top-level project files

| File | Origin | Rebrand notes |
|---|---|---|
| `package.json` | `…/agent-host/package.json` | `name` set to `agent-host-cc`; `description` rewritten to drop "Open WebUI" wording; `@fastify/multipart` removed; `keywords` neutralised. |
| `tsconfig.json` | `…/agent-host/tsconfig.json` | None — copied verbatim. |
| `vitest.config.ts` | `…/agent-host/vitest.config.ts` | None — copied verbatim. |
| `Dockerfile` | `…/agent-host/Dockerfile` | non-root uid=1000 retained by reusing the base image's existing `node` user (`USER node`) — the planned `addgroup -S -g 1000 agent && adduser -S -u 1000` clashed with the base image's pre-existing `node` user/group at uid/gid 1000 and was rejected (BUILD-1, ADR-6 update). `npm install --omit=dev` fallback dropped; comments neutralised. |
| `.dockerignore` | `…/agent-host/.dockerignore` (if present in source) | None. |

---

## 2. Files renamed (old name → new name + reason)

### Source-tree renames

| Old path | New path | Reason |
|---|---|---|
| `src/openAiResponseAdapter.ts` | `src/openAiChatSseAdapter.ts` | The original filename was misleading: the implementation emits Chat Completions SSE chunks, not the Responses API envelope. Plan-003 Phase 1 reclaimed the original filename for a freshly-authored Responses adapter (see §1 below) and gave the original code a name that matches what it does. |
| `src/attachmentProcessor/filesApiFetcher.ts` (function rename only) | (file path unchanged) | The exported function `fetchFromOpenWebUiFiles` was renamed to `fetchFromFilesApi` to reflect that the Files API backend is now generic, not Open-WebUI-specific. The file name was already neutral. |

### Test-fixture renames

| Old path | New path | Reason |
|---|---|---|
| `test/fixtures/mockFoundry.ts` | `test/fixtures/mockAnthropicProvider.ts` | The mock now serves both the Anthropic public path and the Foundry path; renamed to drop the Foundry-only framing. The exported function `startMockFoundry` was renamed to `startMockAnthropicProvider`. |
| `test/fixtures/mockOpenWebUI.ts` | `test/fixtures/mockFilesApi.ts` | The Files API backend is generic; the fixture is no longer Open-WebUI-specific. The exported function `startMockOpenWebUI` was renamed to `startMockFilesApi`. |
| `test/unit/openAiResponseAdapter.test.ts` | `test/unit/openAiChatSseAdapter.test.ts` | Mirrors the source-file rename. A brand-new `test/unit/openAiResponseAdapter.test.ts` was authored against the freshly-created Responses adapter. |

### Newly-authored files (no source counterpart)

| New path | Reason |
|---|---|
| `src/openAiResponseAdapter.ts` (Responses-correct implementation) | Created by plan-003 Phase 2 to satisfy F-20 / AC-17 / AC-18 / AC-19 / AC-20. The file name was made available by the Phase 1 rename above. |
| `test/unit/openAiResponseAdapter.test.ts` (NEW) | Created by plan-003 Phase 6, distinct from the renamed Chat-adapter test. Asserts the canonical envelope sequence, monotonic `sequence_number`, and `data: [DONE]` terminator. |
| `test/integration/agentHost.responses.integration.test.ts` | Created by plan-003 Phase 6 to cover AC-19 (Responses attachment parity). |
| `test_scripts/smoke-anthropic-public.ts` | Created by plan-002 / plan-003 to cover AC-6 + AC-16. |
| `test_scripts/smoke-foundry.ts` | Created by plan-002 to cover AC-7. |
| `test_scripts/smoke-responses-sdk.ts` | Created by plan-003 to cover AC-20 against the official OpenAI Node SDK. |

---

## 3. Files / dependencies dropped

### Dependencies removed from `package.json`

| Dropped | Reason |
|---|---|
| `@fastify/multipart` | Confirmed unused by the codebase scan (zero imports under `src/` or `test/`). Surface-area reduction; if a future plan adds multipart upload support, the dep can be re-added. (ADR-7.) |

### Hard-coded behaviours that were softened (not dropped, but no longer hard-coded)

| Old behaviour | New behaviour | Reason |
|---|---|---|
| `httpServer.ts` hard-coded `cc.` prefix stripping | Configurable via `MODEL_PREFIX` (default `cc.`, empty string disables stripping). | Decouple the service from Open WebUI's prefix conventions (F-6). |
| `config.ts` required `CLAUDE_CODE_USE_FOUNDRY=1` at startup | Optional; absence selects the Anthropic public path. Foundry is opt-in via `CLAUDE_CODE_USE_FOUNDRY=1` plus the trio of Foundry credentials. | Provider abstraction (F-13, plan-002, CONFIRMED-1). |
| `attachmentProcessor/filesApiFetcher.ts` hard-coded path `/api/v1/files/<id>/content` | Configurable via `FILES_API_PATH_TEMPLATE` (default `/api/v1/files/{id}/content`). | Generalise the Files API backend (F-8). |

### Source-tree concepts not migrated

| Concept | Reason for omission |
|---|---|
| `cc-monitor/` sibling service from the source repo | Out of scope for v1 (D-3, CONFIRMED-3). A historical pointer lives in `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/historical-context-cc-monitor.md`. No code, no dependency, no Docker target. |
| The Open WebUI container | Not a component of this project — Open WebUI (or any other OpenAI-compatible client) is deployed separately by the operator. |
| The Pipelines container | Same as Open WebUI. The source repo's plan-002 retired the Pipelines inlet filter; the new project does not carry it forward. |
| Python `claude-skills` and `claude-artifact-server` containers | Already retired by the source's plan-002. Not migrated. |
| DB-stored Open WebUI configuration (`OPENAI_API_CONFIGS`, etc.) | Consumer-side concern. Operators of Open WebUI (or any other consumer) configure it in their own admin panel; the new project has no opinion on it. |
| Pipelines inlet filter | Already retired in the source; nothing to carry forward. |

---

## 4. Source self-reference

Source repo (read-only reference): `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host/` — last extracted 2026-05-10.
