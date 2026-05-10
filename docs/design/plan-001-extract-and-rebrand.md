# Plan 001 — Extract and Rebrand `agent-host` → `agent-host-cc`

> **Status:** Planned
> **Owner:** Implementation phase
> **Depends on:** none (this plan must complete BEFORE plan-002 and plan-003)
> **Blocks:** plan-002-decouple-from-foundry.md, plan-003-add-responses-api.md
> **Source of truth:**
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/refined-request.md` (User Confirmation 2026-05-10 overrides everything below it)
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/investigation-extraction-approach.md` (Focus Areas 1, 5, 6, 7)
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/codebase-scan-source-agent-host.md`
> **Source path (read-only):** `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host/`
> **Target path:** `/Users/giorgosmarinos/aiwork/agent-host-cc/`

## Objective

Produce a clean, self-contained TypeScript project at `/Users/giorgosmarinos/aiwork/agent-host-cc/` by performing a flat copy-and-adapt extraction (Option 1A from the investigation), then sanitizing every reference to the source repo, Open WebUI, Foundry-locking, and the misnamed adapter file. After this plan completes, `npm ci && npm run build && npm test` must succeed locally and a grep audit for `open-webui-phase1`, `phase1`, `OPENWEBUI_*`, `claude-bridge`, `claude-skills`, `claude-artifact-server`, `cc-monitor`, `pipelines` in `src/`, `test/`, `package.json`, and `Dockerfile` must yield zero hits.

## Acceptance criteria covered

- **AC-1** Self-contained build (no path linkage to source repo).
- **AC-2** Test parity (every source unit test ported, mocks renamed).
- **AC-3** Container builds with uid=1000.
- **AC-4** `/healthz` returns `{ok:true}` (route preserved).
- **AC-5** `/v1/models` works behind bearer auth.
- **AC-13** Configuration error path (preserved by copy).
- **AC-14** Expiry warning (preserved by copy; new variable names wired).
- **AC-15** Documentation completeness — partial (this plan creates `project-functions.md`; full design docs are produced in Phase 5 by the Designer).
- **NF-1** Self-containment (grep audit).
- **NF-2** Conformance to project conventions.
- **NF-3** Exception list registered in `CLAUDE.md` BEFORE silent-default code is introduced.
- **NF-4** Test coverage parity.

Carried over to plan-002: AC-6, AC-7, AC-13 provider-specific cases.
Carried over to plan-003: AC-17, AC-18, AC-19, AC-20.

## Phase A — Bulk copy of the source tree

- [ ] A.1 From `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host/`, copy into `/Users/giorgosmarinos/aiwork/agent-host-cc/`:
  - `src/` (whole tree) → `/Users/giorgosmarinos/aiwork/agent-host-cc/src/`
  - `test/` (whole tree) → `/Users/giorgosmarinos/aiwork/agent-host-cc/test/`
  - `package.json` → `/Users/giorgosmarinos/aiwork/agent-host-cc/package.json`
  - `tsconfig.json` → `/Users/giorgosmarinos/aiwork/agent-host-cc/tsconfig.json`
  - `vitest.config.ts` → `/Users/giorgosmarinos/aiwork/agent-host-cc/vitest.config.ts`
  - `Dockerfile` → `/Users/giorgosmarinos/aiwork/agent-host-cc/Dockerfile`
  - `.dockerignore` (if present in source) → `/Users/giorgosmarinos/aiwork/agent-host-cc/.dockerignore`
- [ ] A.2 Do **NOT** copy `node_modules/`, `dist/`, `package-lock.json`. The lockfile will be regenerated after rename.
- [ ] A.3 Verify the copy with `find /Users/giorgosmarinos/aiwork/agent-host-cc -type f -name '*.ts' | wc -l` and compare against the source count from the codebase scan (sources: 13 src files + 14 test files + 2 fixtures ≈ 29).
- [ ] A.4 Run `grep -RIn "open-webui-phase1" /Users/giorgosmarinos/aiwork/agent-host-cc/src /Users/giorgosmarinos/aiwork/agent-host-cc/test /Users/giorgosmarinos/aiwork/agent-host-cc/package.json /Users/giorgosmarinos/aiwork/agent-host-cc/Dockerfile` — must produce zero hits. (If the source tree references its own sibling paths, those references should be removed in Phase F.)

### Files created in Phase A
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/**` (all TypeScript sources from source `src/`)
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/**` (all unit + integration tests + fixtures)
- `/Users/giorgosmarinos/aiwork/agent-host-cc/package.json`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/tsconfig.json`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/vitest.config.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/Dockerfile`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/.dockerignore` (if present in source)

## Phase B — Mock and Files-API rename

> **Reference:** investigation §"Files that need rename / re-author during the copy" + codebase scan §7a.

- [ ] B.1 Rename test fixture files:
  - `/Users/giorgosmarinos/aiwork/agent-host-cc/test/fixtures/mockFoundry.ts` → `/Users/giorgosmarinos/aiwork/agent-host-cc/test/fixtures/mockAnthropicProvider.ts` and rename the exported function `startMockFoundry` → `startMockAnthropicProvider`.
  - `/Users/giorgosmarinos/aiwork/agent-host-cc/test/fixtures/mockOpenWebUI.ts` → `/Users/giorgosmarinos/aiwork/agent-host-cc/test/fixtures/mockFilesApi.ts` and rename the exported function `startMockOpenWebUI` → `startMockFilesApi`.
- [ ] B.2 Update every importer of those fixtures:
  - `/Users/giorgosmarinos/aiwork/agent-host-cc/test/integration/agentHost.integration.test.ts` (lines ~23, ~33 in source).
  - Any unit test that imported them (search with `grep -RIn "mockFoundry\|mockOpenWebUI\|startMockFoundry\|startMockOpenWebUI" test/`).
- [ ] B.3 Rename env vars and config fields (codebase scan §7a):
  - `OPENWEBUI_BASE_URL` → `FILES_API_BASE_URL` in `src/config.ts`, `test/unit/config.test.ts`, anywhere else.
  - `OPENWEBUI_API_KEY` → `FILES_API_KEY`
  - `OPENWEBUI_API_KEY_EXPIRES_AT` → `FILES_API_KEY_EXPIRES_AT`
  - `Config` interface fields `openWebuiBaseUrl`, `openWebuiApiKey`, `openWebuiApiKeyExpiresAt` → `filesApiBaseUrl`, `filesApiKey`, `filesApiKeyExpiresAt`.
  - Function `fetchFromOpenWebUiFiles` in `src/attachmentProcessor/filesApiFetcher.ts` → `fetchFromFilesApi`. Update the import in `src/attachmentProcessor.ts` and the describe block in `test/unit/filesApiFetcher.test.ts`.
- [ ] B.4 Add **new** required env var and Config field `FILES_API_PATH_TEMPLATE` (default `/api/v1/files/{id}/content`):
  - Add to `src/config.ts` as an optional variable with the default literal.
  - Replace the hard-coded path template at `src/attachmentProcessor/filesApiFetcher.ts:12` with `cfg.filesApiPathTemplate.replace("{id}", encodeURIComponent(id))`.
  - Add a unit test in `test/unit/filesApiFetcher.test.ts` covering an alternate template (e.g. `/files/{id}`).
- [ ] B.5 Replace the error string `"Open WebUI files API returned…"` at `src/errors.ts:69` with `"Files API returned…"`.

### Files created / modified / renamed / deleted in Phase B

Renamed:
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/fixtures/mockFoundry.ts` → `mockAnthropicProvider.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/fixtures/mockOpenWebUI.ts` → `mockFilesApi.ts`

Modified:
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/config.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/index.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/attachmentProcessor.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/attachmentProcessor/filesApiFetcher.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/errors.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/unit/config.test.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/unit/filesApiFetcher.test.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/integration/agentHost.integration.test.ts`

## Phase C — `MODEL_PREFIX` configurability (drop hard-coded `cc.`)

- [ ] C.1 Add `modelPrefix` (default `"cc."`) to the `Config` type and `loadConfig` in `src/config.ts`.
- [ ] C.2 In `src/httpServer.ts:20` replace `const stripCcPrefix = (m: string) => m.startsWith("cc.") ? m.slice(3) : m;` with a closure that reads `cfg.modelPrefix`. If `modelPrefix === ""`, the function is a no-op identity.
- [ ] C.3 Wire `cfg.modelPrefix` into `buildApp`'s options (`HttpServerOptions`) so the closure sees it.
- [ ] C.4 Update `test/unit/httpServer.test.ts` to cover three cases: default `cc.`, custom prefix `claude.`, empty string disables stripping.
- [ ] C.5 Document `MODEL_PREFIX` in the configuration guide (created in Phase 5 by the Designer; for now, just ensure the Config field is in place and tested).

### Files created / modified in Phase C
Modified:
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/config.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/httpServer.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/unit/httpServer.test.ts`

## Phase D — Drop `@fastify/multipart`; pin uid=1000 in Dockerfile

- [ ] D.1 In `/Users/giorgosmarinos/aiwork/agent-host-cc/package.json`, remove `@fastify/multipart` from `dependencies` (codebase scan §10 confirms it is unused).
- [ ] D.2 In `/Users/giorgosmarinos/aiwork/agent-host-cc/Dockerfile`, change the runtime stage's user-creation block to:
  ```
  RUN addgroup -S -g 1000 agent && adduser -S -u 1000 -G agent agent && \
      mkdir -p /workspace && chown agent:agent /workspace
  ```
  (replacing `addgroup -S agent && adduser -S agent -G agent && …`).
- [ ] D.3 Drop the `|| npm install --omit=dev` fallback on the `deps` stage `RUN npm ci --omit=dev` line. The lockfile will exist in the new project after `npm ci` regenerates it.
- [ ] D.4 Verify the Dockerfile still builds locally with `docker build -t agent-host-cc:dev .` (operator-side smoke; not blocking until Phase G).

### Files modified in Phase D
- `/Users/giorgosmarinos/aiwork/agent-host-cc/package.json`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/Dockerfile`

## Phase E — `package.json` neutralization

- [ ] E.1 Update fields in `/Users/giorgosmarinos/aiwork/agent-host-cc/package.json`:
  - `"name": "agent-host-cc"`
  - `"description"`: replace any wording mentioning "Open WebUI" or `plan-002-typescript-agent-host.md` with: `"OpenAI-compatible HTTP host for the Anthropic Claude Code agent, packaged for container deployment."`
  - `"keywords"` (if present): drop `open-webui`, `phase1`, `pipelines`; keep `claude`, `anthropic`, `openai`, `agent-sdk`, `fastify`.
  - Keep `"private": true` (per Decision D-6 we do not push to a registry in v1).
- [ ] E.2 Run `npm install --package-lock-only` to regenerate `package-lock.json` against the cleaned dependency list. (Note: do **not** run `npm install` until grep sweeps in Phase F are complete to avoid noise; lockfile-only is safe.)

### Files modified / created in Phase E
- `/Users/giorgosmarinos/aiwork/agent-host-cc/package.json` (modified)
- `/Users/giorgosmarinos/aiwork/agent-host-cc/package-lock.json` (created)

## Phase F — File-by-file grep sweep (NF-1 enforcement)

- [ ] F.1 Run, from `/Users/giorgosmarinos/aiwork/agent-host-cc/`:
  ```
  grep -RIn -E 'open-webui-phase1|phase1|claude-bridge|pipelines|cc-monitor|claude-skills|claude-artifact-server|OPENWEBUI_' \
    src test package.json Dockerfile .dockerignore tsconfig.json vitest.config.ts
  ```
  Expected: zero hits. Each remaining hit must be classified as one of:
  1. **Removable** — delete the line / change the wording.
  2. **Historical** — relocate the explanation into `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/historical-context-cc-monitor.md` (created in Phase 5 by the Designer; for now, just leave a `TODO(plan-001-F):` comment if absolutely needed).
- [ ] F.2 Inspect comments and docstrings inside `src/httpServer.ts` (lines ~25, ~46 per scan §7a) and remove or neutralize the "from Open WebUI" / "and Open WebUI" comments.
- [ ] F.3 Inspect every README/markdown copied in (none expected from the source `agent-host/` tree; if any are present, evaluate per F.1 rule).
- [ ] F.4 Audit Open WebUI brand wording: `grep -RIni 'open[ -]?webui' src test package.json Dockerfile .dockerignore` must produce zero hits.

### Files modified in Phase F
- Any source/test/comment found by the grep sweep (case by case).

## Phase G — Register CLAUDE.md exception list (NF-3 PRE-CONDITION)

> **CRITICAL:** This phase MUST run before any code that introduces a silent default is committed. It satisfies NF-3 and OQ-8 from the refined request.

- [ ] G.1 In `/Users/giorgosmarinos/aiwork/agent-host-cc/CLAUDE.md`, add a section **"Configuration Fallback Exceptions"** under (or alongside) the `<structure-and-conventions>` block. The section must enumerate the two intentional silent-default fallbacks the design relies on:

  ```
  ## Configuration Fallback Exceptions

  Per the project rule "no silent fallbacks for configuration", the following fallbacks
  are explicitly approved exceptions, recorded here per NF-3 of the refined request and
  OQ-8 of the open questions:

  1. WORKSPACE_DIR defaulting to "/workspace" when unset.
     Rationale: This is the documented container mount point and matches the Dockerfile
     `chown 1000:1000 /workspace` step. The default only applies in container deployments;
     local-host runs should set WORKSPACE_DIR explicitly.

  2. Deterministic chatId derivation when metadata.chat_id is absent.
     Rationale: OpenAI-compatible clients commonly omit metadata.chat_id. The service
     derives a stable hash from the request body content so per-chat workspace state
     remains coherent within a single conversation. This is a derivation, not a config
     default; it is documented in docs/design/project-design.md.
  ```
- [ ] G.2 No code change in this phase. The exception is approved before plan-002 / plan-003 implement either fallback.
- [ ] G.3 Verification: `grep -A 12 'Configuration Fallback Exceptions' /Users/giorgosmarinos/aiwork/agent-host-cc/CLAUDE.md` must show both bullets.

### Files modified in Phase G
- `/Users/giorgosmarinos/aiwork/agent-host-cc/CLAUDE.md`

## Phase H — Initial verification

- [ ] H.1 `cd /Users/giorgosmarinos/aiwork/agent-host-cc && npm ci`
- [ ] H.2 `npm run build` — must succeed (TypeScript compile, no errors).
- [ ] H.3 `npm test` — must run the full ported test suite green. **Note:** at this stage Foundry-coupling tests still pass because plan-002 has not yet refactored the runner; the runner still hard-requires Foundry env. That's expected; provider decoupling is plan-002's job.
- [ ] H.4 Re-run grep audit from Phase F.1 — confirm zero hits.
- [ ] H.5 `docker build -t agent-host-cc:dev .` — image builds cleanly. `docker run --rm agent-host-cc:dev id agent` reports `uid=1000`.

## Verification checklist (Claude-executable)

```bash
cd /Users/giorgosmarinos/aiwork/agent-host-cc
test -f package.json && test -f tsconfig.json && test -f vitest.config.ts && test -f Dockerfile
test -d src && test -d test && test -d test/fixtures
test -f test/fixtures/mockAnthropicProvider.ts
test -f test/fixtures/mockFilesApi.ts
! test -f test/fixtures/mockFoundry.ts
! test -f test/fixtures/mockOpenWebUI.ts
grep -q '"name": "agent-host-cc"' package.json
! grep -q '@fastify/multipart' package.json
grep -q 'adduser -S -u 1000' Dockerfile
grep -RIn -E 'OPENWEBUI_|open-webui-phase1|phase1|cc-monitor' src test package.json Dockerfile && exit 1 || true
npm ci
npm run build
npm test
```

## Risks and mitigations

| # | Risk | Mitigation |
|---|------|------------|
| R1 | The bulk copy pulls in transitive imports that still reference `open-webui-phase1` paths (e.g., a TS path alias). | The source tree uses `"moduleResolution":"bundler"` with relative imports only — no path aliases pointing outside `src/`. Confirmed in scan §4. The grep sweep in Phase F.1 is the safety net. |
| R2 | Renaming `OPENWEBUI_*` env vars without an alias breaks any operator who sets the old names. | The new project is a clean tenant — no operator depends on the old names. The investigation also rejects back-compat aliases (refined-request "Migration Plan" §2 allows them only with explicit approval). Document the rename in the migration notes. |
| R3 | `@fastify/multipart` removal breaks an unimported but indirectly-used surface. | Codebase scan §10 confirms zero imports. Verified independently by `grep -RIn '@fastify/multipart' src test`. |
| R4 | `adduser -S -u 1000` collides with an existing uid=1000 in `node:22-alpine`. | The base image's default `node` user already has uid=1000. Mitigation: use `node` user (already present) and skip the custom user creation. **Decision:** keep the custom `agent` user but use `-u 1001` if the build fails on uid collision. Document in plan-001-G if encountered. |
| R5 | Tests that hit Foundry env in `claudeCodeRunner.test.ts` fail after `OPENWEBUI_*` rename because `loadConfig` now requires the new vars. | Phase H.3 is expected to pass at this point because plan-001 only renames vars; the *requirement* set is unchanged (Foundry-only). Provider decoupling is plan-002. |
| R6 | The lockfile-only regenerate in Phase E.2 produces drift from source. | Acceptable — the new project owns its lockfile. Run `npm ci` in H.1 to confirm reproducibility. |
| R7 | `package-lock.json` regeneration introduces `@fastify/multipart` removal incorrectly. | `npm install --package-lock-only` reflects whatever `package.json` says. Phase D.1 removes the dep before E.2 regenerates. |
| R8 | NF-3 violation — silent defaults committed before exception list registered. | Phase G is gated *before* plan-002 and plan-003 write any new fallback. CLAUDE.md update is the prerequisite. |

## Dependencies

- This plan stands alone. It MUST complete before plan-002 (provider decoupling) and plan-003 (Responses API) start.
- After this plan, the runner is still Foundry-locked and the Responses API is still missing. Both gaps are intentional — they are the next two plans' scope.
- Phase G (CLAUDE.md exception list) gates both downstream plans.

## Out of scope for this plan

- Provider abstraction (deferred to plan-002).
- OpenAI Responses API (deferred to plan-003).
- Fresh design docs `project-design.md`, `configuration-guide.md`, runbooks (deferred to Phase 5 / Designer). This plan only creates `project-functions.md` (the requirements register) at the planner stage as scaffolding.
- `docker-compose.yml` and `.env.example` (deferred to Designer / runbook author).
- Removing the historical context pointer in `docs/reference/historical-context-cc-monitor.md` (Designer adds it).
