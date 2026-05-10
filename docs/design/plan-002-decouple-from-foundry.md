# Plan 002 — Decouple `agent-host-cc` from Azure AI Foundry

> **Status:** Planned
> **Owner:** Implementation phase
> **Depends on:** plan-001-extract-and-rebrand.md (must be complete)
> **Parallelizable with:** plan-003-add-responses-api.md (independent)
> **Source of truth:**
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/refined-request.md` § F-13, AC-6, AC-7, CONFIRMED-1
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/investigation-extraction-approach.md` § Focus Area 3
> - `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/codebase-scan-source-agent-host.md` § 7b

## Objective

Refactor the configuration loader and `claudeCodeRunner` so the service can route to either the Anthropic public API (default) or an Azure AI Foundry deployment (opt-in via `CLAUDE_CODE_USE_FOUNDRY=1`), with exactly one provider resolving at startup. Apply the SDK v0.2.113 mitigation by spreading `process.env` when constructing `options.env` for the spawned `claude` child process.

## Acceptance criteria covered

- **F-13** Provider abstraction.
- **AC-6** Text-only chat completion against Anthropic public API.
- **AC-7** Text-only chat completion against mocked Foundry endpoint.
- **AC-13** Configuration error path: ambiguous/partial provider config → `ConfigurationError` + exit 78.

## Phase A — Discriminated `Provider` union in `config.ts`

> **Investigation reference:** Focus Area 3, Option 3A (recommended).

- [ ] A.1 In `/Users/giorgosmarinos/aiwork/agent-host-cc/src/config.ts`, define:
  ```ts
  export type Provider =
    | { kind: "anthropic-public"; apiKey: string }
    | { kind: "anthropic-foundry"; apiKey: string; resource: string };
  ```
  Replace the existing `foundryApiKey`, `foundryResource` and the implicit-Foundry assumption on the `Config` type with a single field `provider: Provider`.
- [ ] A.2 Implement provider selection in `loadConfig(env)`:
  - If `env.CLAUDE_CODE_USE_FOUNDRY === "1"`:
    - Require `env.ANTHROPIC_FOUNDRY_API_KEY` AND `env.ANTHROPIC_FOUNDRY_RESOURCE`. If either is missing, throw `ConfigurationError` naming the missing variable.
    - `provider = { kind: "anthropic-foundry", apiKey, resource }`.
  - Else (unset, empty, or any value other than `"1"`):
    - Require `env.ANTHROPIC_API_KEY`. If missing, throw `ConfigurationError("ANTHROPIC_API_KEY")`.
    - `provider = { kind: "anthropic-public", apiKey }`.
  - **Reject ambiguity:** If both `ANTHROPIC_API_KEY` AND the Foundry trio are set but `CLAUDE_CODE_USE_FOUNDRY` is not `"1"`, log a startup INFO line stating "Foundry credentials present but CLAUDE_CODE_USE_FOUNDRY != '1' — using Anthropic public API". This is informational, not fatal.
- [ ] A.3 Add expiry-warning support for `ANTHROPIC_API_KEY_EXPIRES_AT` alongside the existing `ANTHROPIC_FOUNDRY_API_KEY_EXPIRES_AT` and the renamed `FILES_API_KEY_EXPIRES_AT`.
- [ ] A.4 Add a startup log line in `src/index.ts` reporting the resolved provider kind, with the API key and resource redacted:
  ```
  log.info({ provider: cfg.provider.kind, foundryResource: cfg.provider.kind === "anthropic-foundry" ? "<set>" : null }, "Provider resolved")
  ```
  (key value never logged; resource value never logged — only existence).

### Files modified in Phase A
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/config.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/index.ts`

## Phase B — Refactor `claudeCodeRunner.ts` to consume the discriminated union

> **Investigation reference:** Focus Area 3 + Implementation Considerations on `process.env` spreading (mitigates SDK v0.2.113 replace-semantics revert).

- [ ] B.1 In `/Users/giorgosmarinos/aiwork/agent-host-cc/src/claudeCodeRunner.ts`, change `ClaudeCodeRunnerOptions` from `{ foundryApiKey, foundryResource, … }` to `{ provider: Provider, … }` (importing the type from `./config.js`). Drop the legacy fields entirely; do not keep aliases.
- [ ] B.2 Rewrite the env injection block to branch per `provider.kind`:
  ```ts
  const providerEnv: Record<string, string> =
    opts.provider.kind === "anthropic-foundry"
      ? {
          CLAUDE_CODE_USE_FOUNDRY: "1",
          ANTHROPIC_FOUNDRY_API_KEY: opts.provider.apiKey,
          ANTHROPIC_FOUNDRY_RESOURCE: opts.provider.resource,
        }
      : {
          ANTHROPIC_API_KEY: opts.provider.apiKey,
        };
  const env = { ...process.env, ...providerEnv };
  ```
  **Mitigation:** the explicit `{ ...process.env, ...providerEnv }` spread is required to survive the v0.2.113 SDK behavior where `options.env` *replaces* (not overlays) the inherited env. Without the spread, `PATH`, `HOME`, etc. are dropped and the spawned `claude` binary fails to resolve its dependencies.
- [ ] B.3 Update the call site in `/Users/giorgosmarinos/aiwork/agent-host-cc/src/index.ts` (around line 36-40 in source) to pass `provider: cfg.provider` instead of the legacy field set.
- [ ] B.4 Keep the existing `resolveClaudeExecutable()` and `pathToClaudeCodeExecutable` override (per investigation Focus Area 5, Option 5A). No change here.
- [ ] B.5 Ensure no other code path imports the removed legacy options. Grep:
  ```
  grep -RIn 'foundryApiKey\|foundryResource' src test
  ```
  Should produce zero hits after this phase (except inside the discriminated union shape, where they are renamed to `apiKey` / `resource`).

### Files modified in Phase B
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/claudeCodeRunner.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/index.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/src/agentRunner.ts` (only if the interface leaks the legacy fields — likely no change)

## Phase C — Test refactor

> **Investigation reference:** Focus Area 6; codebase scan §7b.

- [ ] C.1 Update `/Users/giorgosmarinos/aiwork/agent-host-cc/test/unit/claudeCodeRunner.test.ts`:
  - [ ] C.1.a Add a new test case: **public-API path**.
    - Construct runner with `provider: { kind: "anthropic-public", apiKey: "sk-test" }`.
    - Assert the spawned env contains `ANTHROPIC_API_KEY=sk-test`.
    - Assert the spawned env does **NOT** contain `CLAUDE_CODE_USE_FOUNDRY` or `ANTHROPIC_FOUNDRY_*`.
    - Assert the spawned env contains a propagated `process.env` value (e.g., set `process.env.PLAN_002_TEST_MARKER=hello` before the call, assert it survives).
  - [ ] C.1.b Update the existing **Foundry path** test to use `provider: { kind: "anthropic-foundry", apiKey, resource }` and assert all three Foundry vars are set in the spawned env.
- [ ] C.2 Update `/Users/giorgosmarinos/aiwork/agent-host-cc/test/unit/config.test.ts`:
  - [ ] C.2.a Add: **public path happy** — `loadConfig({ ANTHROPIC_API_KEY: "sk-x", … })` with no Foundry vars produces `provider.kind === "anthropic-public"`.
  - [ ] C.2.b Add: **Foundry path happy** — `loadConfig({ CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_FOUNDRY_API_KEY, ANTHROPIC_FOUNDRY_RESOURCE, … })` produces `provider.kind === "anthropic-foundry"`.
  - [ ] C.2.c Add: **Foundry partial fail** — `CLAUDE_CODE_USE_FOUNDRY=1` set but `ANTHROPIC_FOUNDRY_RESOURCE` missing → `ConfigurationError` thrown, message includes `"ANTHROPIC_FOUNDRY_RESOURCE"`.
  - [ ] C.2.d Add: **public missing fail** — Foundry not enabled, `ANTHROPIC_API_KEY` unset → `ConfigurationError` thrown, message includes `"ANTHROPIC_API_KEY"`.
  - [ ] C.2.e Drop the legacy "all-Foundry-vars-required-always" test (replaced by C.2.b).
- [ ] C.3 Update `/Users/giorgosmarinos/aiwork/agent-host-cc/test/fixtures/mockAnthropicProvider.ts` to expose two factory helpers if not already generic:
  - `startMockAnthropicProvider({ mode: "public" })` — accepts requests at `/v1/messages` (stable Anthropic shape).
  - `startMockAnthropicProvider({ mode: "foundry" })` — accepts requests at the Foundry path shape (the SDK derives this from `ANTHROPIC_FOUNDRY_RESOURCE`).
  Both modes return the same SSE-like response stream so a single response builder is reusable.
- [ ] C.4 Update `/Users/giorgosmarinos/aiwork/agent-host-cc/test/integration/agentHost.integration.test.ts` to cover both provider paths:
  - [ ] C.4.a Existing test (which today uses Foundry) becomes the **Foundry integration test** with `mockAnthropicProvider({ mode: "foundry" })`.
  - [ ] C.4.b New mirror test uses `mockAnthropicProvider({ mode: "public" })` and `provider.kind === "anthropic-public"`. Verifies AC-6.
  Optional split: move shared scaffolding into `test/integration/_helpers.ts` per investigation Focus Area 6.

### Files created / modified in Phase C
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/unit/claudeCodeRunner.test.ts` (modified)
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/unit/config.test.ts` (modified)
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/fixtures/mockAnthropicProvider.ts` (modified)
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/integration/agentHost.integration.test.ts` (modified or split)
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test/integration/_helpers.ts` (created, optional)

## Phase D — Smoke test scripts

- [ ] D.1 Create `/Users/giorgosmarinos/aiwork/agent-host-cc/test_scripts/smoke-anthropic-public.ts` that:
  - Reads `ANTHROPIC_API_KEY` from process env.
  - Hits `POST http://localhost:8000/v1/chat/completions` with a single user message and `stream: true`.
  - Asserts the SSE stream terminates with `data: [DONE]\n\n` and aggregated content is non-empty.
  - This is **AC-6** evidence.
- [ ] D.2 Create `/Users/giorgosmarinos/aiwork/agent-host-cc/test_scripts/smoke-foundry.ts` that:
  - Reads `ANTHROPIC_FOUNDRY_API_KEY` and `ANTHROPIC_FOUNDRY_RESOURCE`.
  - Same HTTP shape as D.1, against a container started with `CLAUDE_CODE_USE_FOUNDRY=1`.
  - This is **AC-7** evidence.
- [ ] D.3 Both scripts use the project's TypeScript runner (`tsx`) and live under `test_scripts/` per project conventions.

### Files created in Phase D
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test_scripts/smoke-anthropic-public.ts`
- `/Users/giorgosmarinos/aiwork/agent-host-cc/test_scripts/smoke-foundry.ts`

## Verification checklist (Claude-executable)

```bash
cd /Users/giorgosmarinos/aiwork/agent-host-cc

# Type-check still passes
npm run build

# Unit + integration tests cover both provider paths
npm test -- claudeCodeRunner
npm test -- config
npm test -- agentHost.integration

# Static checks
grep -RIn 'foundryApiKey\|foundryResource' src && exit 1 || true   # legacy fields gone
grep -q 'process.env, ...providerEnv' src/claudeCodeRunner.ts       # spread mitigation present
grep -q 'kind: "anthropic-public"' src/config.ts
grep -q 'kind: "anthropic-foundry"' src/config.ts
grep -q 'CLAUDE_CODE_USE_FOUNDRY' src/claudeCodeRunner.ts

# Smoke (operator-run, not CI)
# AC-6: with ANTHROPIC_API_KEY set, no CLAUDE_CODE_USE_FOUNDRY
# AC-7: with CLAUDE_CODE_USE_FOUNDRY=1 + Foundry creds
```

## Risks and mitigations

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Foundry env-var name collision/rename in a future SDK version. | Investigation References row 5 confirms `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_RESOURCE` are stable across the v0.2.x line. Pin SDK version in `package.json` to a known-good minor; document the pin in `docs/design/configuration-guide.md` (Phase 5). If the SDK renames, this is a one-line patch in `claudeCodeRunner.ts`. |
| R2 | SDK v0.2.113 `options.env` regression — passes `replace`, not `overlay`. | Mitigated by **always spreading `process.env`** in Phase B.2. A vitest case in C.1.a asserts a marker var from `process.env` survives in the spawned env. |
| R3 | Both `ANTHROPIC_API_KEY` and Foundry trio set, operator confused which is in use. | Phase A.4 logs the resolved provider at startup with a clear "Foundry credentials present but CLAUDE_CODE_USE_FOUNDRY != '1'" info line. Documented in the configuration guide (Phase 5). |
| R4 | Public-API path test in C.1.a may run unintended outbound HTTP. | The unit test uses the SDK mock (already injected in the existing claudeCodeRunner.test.ts). No real network calls. The integration test in C.4 uses `mockAnthropicProvider({ mode: "public" })` running on localhost. |
| R5 | Discriminated union exhaustiveness gap (a `kind` value not handled). | TypeScript's `never` check in a `switch (provider.kind)` exhaustive default catches this at compile time. Add `const _exhaustive: never = provider;` in any switch that consumes the union. |
| R6 | The mocked Foundry endpoint diverges from the real Foundry contract. | Out of scope for this plan — covered by AC-7 smoke against a real Foundry deployment, which is operator-run. The mock only needs to satisfy the SDK's HTTP request shape enough that `query()` completes; that shape is already met by the existing `mockFoundry.ts` at the time of plan-001 copy. |
| R7 | The public-API path discovers a different model-id namespace than Foundry. | Operator concern. `MODEL_IDS` is configured per deployment. Documented in `docs/design/configuration-guide.md` (Phase 5). |

## Dependencies

- **Requires:** plan-001 complete (renames done, MODEL_PREFIX in place, exception list registered, multipart dropped, uid pinned).
- **Independent of:** plan-003. Both can be implemented in parallel after plan-001.

## Out of scope for this plan

- Bedrock and Vertex provider support (the discriminated union leaves room for a third arm; not implemented here).
- Multi-runner support beyond `ClaudeCodeRunner` (carried as Future in `Issues - Pending Items.md`).
- Configuration guide content (Designer / Phase 5).
