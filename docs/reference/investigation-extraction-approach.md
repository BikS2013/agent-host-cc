# Investigation: Extraction Approach for `agent-host-cc`

## Executive Summary

The recommended path is a **flat copy-and-adapt extraction** of the source `agent-host/` tree from `/Users/giorgosmarinos/aiwork/open-webui-phase1/agent-host/` into the new standalone project, combined with a **targeted refactor pass** that (a) decouples the runner from Foundry via env-driven provider selection, (b) reclaims the misnamed `openAiResponseAdapter.ts` filename for the actual OpenAI Responses API, and (c) introduces a fresh `openAiChatSseAdapter.ts` for the existing Chat Completions logic. For the new `/v1/responses` surface, the recommendation is to emit the **canonical Responses event sequence with full `output_item` / `content_part` envelope events** (not just `output_text.delta`), because the official `openai-node` SDK's `responses.stream()` consumer relies on `response.output_item.added` arriving before any text delta — a constraint already proven to break clients like Codex when omitted (see References row 3). Tool-use blocks should still surface as italic markdown inside `output_text.delta` (low-risk compatibility shim), with a documented upgrade path to native `function_call` items. The Claude Agent SDK still respects `CLAUDE_CODE_USE_FOUNDRY=1` + `ANTHROPIC_FOUNDRY_RESOURCE` + optional `ANTHROPIC_FOUNDRY_API_KEY`; the only behavioural risk in the v0.2.x line is the v0.2.113 revert that made `options.env` *replace* (not overlay) `process.env` — meaning the new runner must spread `process.env` explicitly when injecting provider env. Vitest stays. Apple `container` is treated as a Docker drop-in for v1, with a `pathToClaudeCodeExecutable` override retained as defensive insurance against virtiofs path-resolution flakiness.

## Context

- Source: existing `agent-host/` service inside `open-webui-phase1` (TypeScript, Node ≥ 22, Fastify 5, Zod 4, Pino, Undici, `@anthropic-ai/claude-agent-sdk@^0.2.138`).
- Target: greenfield standalone project at `/Users/giorgosmarinos/aiwork/agent-host-cc/`, must have **zero runtime/build/path linkage** back to `open-webui-phase1` (NF-1).
- Authoritative requirements: `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/refined-request.md`, with the "User Confirmation (2026-05-10)" block at the top overriding earlier draft language. The user has confirmed: standalone, both `/v1/chat/completions` AND `/v1/responses` in v1, Anthropic public API as default with Foundry opt-in, local Docker + Apple `container` only, cc-monitor out of scope.
- Codebase scan: `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/codebase-scan-source-agent-host.md` enumerates every file, dependency, env var, and sanitization target.

## Options Identified

### Focus Area 1 — Extraction Strategy

#### Option 1A: Copy-and-adapt (flat, no history) — RECOMMENDED
- **Description**: `cp -R` the source tree into the new project root, drop `node_modules/` and `dist/`, drop `package-lock.json` (regenerate after rename), then run a sanitization pass (rename files, rename env vars, neutralize strings). No git operation against the source repo.
- **Strengths**: Hard NF-1 self-containment guarantee from day one; simplest mental model; no transitive linkage; aligns with Assumption A-8 (history not preserved); identical to the migration-plan step 1 already documented in the refined request.
- **Weaknesses**: Loses commit history — but A-8 explicitly accepts this.
- **Effort/Complexity**: Low.
- **Risk**: Low.
- **Best suited when**: Target must be auditable as standalone (NF-1) and history is not required.

#### Option 1B: `git subtree split` + new repo
- **Description**: Use `git subtree split --prefix=agent-host` on the source repo to produce a history-bearing branch, then import that branch into the new project.
- **Strengths**: Preserves authorship/history.
- **Weaknesses**: Couples the new repo's history to the source repo (`open-webui-phase1` paths show up in old commits); operator pressure to run `git filter-repo` to scrub references; user explicitly waived history (A-8); still requires the same sanitization pass on top.
- **Effort/Complexity**: Medium.
- **Risk**: Medium (history can leak `open-webui-phase1` strings that fail the NF-1 grep audit unless filter-repo is run carefully).

#### Option 1C: Symlink / npm `link` then fork later
- **Description**: Symlink `src/` from source into target during early dev, defer the copy.
- **Strengths**: Zero duplication during exploration.
- **Weaknesses**: Directly violates NF-1; the target becomes uncompilable the moment the source is moved or renamed; AC-1 ("project tree must build successfully even after the source repo is renamed or removed") is unsatisfiable.
- **Effort/Complexity**: Low (initially).
- **Risk**: High — breaks the primary acceptance criterion.

**Files that need rename / re-author during the copy** (extracted from codebase scan §7 and refined-request "User Confirmation"):

| Item | Source name / location | New name / treatment |
|---|---|---|
| Adapter file (misnamed) | `src/openAiResponseAdapter.ts` (emits Chat Completions chunks) | Move content to `src/openAiChatSseAdapter.ts`; **reclaim** `openAiResponseAdapter.ts` for the new Responses API impl |
| Foundry mock fixture | `test/fixtures/mockFoundry.ts` | `test/fixtures/mockAnthropicProvider.ts` (generic SSE-emitting upstream) |
| Open WebUI mock fixture | `test/fixtures/mockOpenWebUI.ts` | `test/fixtures/mockFilesApi.ts` |
| Files API fetcher fn | `fetchFromOpenWebUiFiles` in `filesApiFetcher.ts` | `fetchFromFilesApi` |
| Env var | `OPENWEBUI_BASE_URL` | `FILES_API_BASE_URL` |
| Env var | `OPENWEBUI_API_KEY` | `FILES_API_KEY` |
| Env var | `OPENWEBUI_API_KEY_EXPIRES_AT` | `FILES_API_KEY_EXPIRES_AT` |
| Config field | `openWebuiBaseUrl`, `openWebuiApiKey`, `openWebuiApiKeyExpiresAt` | `filesApiBaseUrl`, `filesApiKey`, `filesApiKeyExpiresAt` |
| Hard-coded path template | `/api/v1/files/${id}/content` in `filesApiFetcher.ts` | Read from new `FILES_API_PATH_TEMPLATE` (default `/api/v1/files/{id}/content`) |
| Hard-coded prefix | `cc.` in `httpServer.ts:20` | Read from `MODEL_PREFIX` (default `cc.`) |
| Error string | `"Open WebUI files API returned…"` in `errors.ts:69` | `"Files API returned…"` |
| `package.json` | description mentions Open WebUI / plan-002 | Neutralize description; rename package to `agent-host-cc` |
| Dead dep | `@fastify/multipart` (declared, unused) | Drop |

### Focus Area 2 — OpenAI Responses API Implementation

The Responses API uses **typed semantic events**, not opaque chunks like Chat Completions. The full canonical "happy path" sequence for a single text response is:

```
event: response.created           data: { type, response: {id, object:"response", status:"in_progress", model, ...} }
event: response.in_progress       data: { type, response: {…} }
event: response.output_item.added data: { type, output_index, item: {id:"msg_…", type:"message", role:"assistant", content:[]} }
event: response.content_part.added data: { type, item_id, output_index, content_index, part:{type:"output_text", text:""} }
event: response.output_text.delta data: { type, item_id, output_index, content_index, delta, sequence_number }
…repeat delta…
event: response.output_text.done  data: { type, item_id, output_index, content_index, text }
event: response.content_part.done data: { type, item_id, output_index, content_index, part:{type:"output_text", text} }
event: response.output_item.done  data: { type, output_index, item: {…full message…} }
event: response.completed         data: { type, response: {…full Response with output[], usage…} }
```

After `response.completed`, OpenAI's official server emits `data: [DONE]\n\n` as a stream terminator. The official `openai-node` SDK's `responses.stream()` parser reads typed events via SSE; it does **not** require the `[DONE]` sentinel for correctness on Responses (unlike Chat Completions), but emitting it is harmless and matches OpenAI's own stream — so emit it for symmetry with the Chat Completions adapter and to keep the F-20 acceptance criterion's "ending with `data: [DONE]\n\n`" requirement intact.

**Translation contract from Claude SDK `SDKAssistantMessage` blocks → Responses events**:

| SDK block | Responses surface | Notes |
|---|---|---|
| `text` block delta | `response.output_text.delta` with `delta` = chunk | Track `(item_id, output_index, content_index)` triple per assistant message |
| `tool_use` block | (preferred low-risk) `response.output_text.delta` italic markdown shim, identical wording to Chat Completions adapter (`\n\n*[<tool>: <truncated-input>]*\n`) | Documented upgrade path: emit a separate `output_item` of `type:"function_call"` once consuming clients are known to support it |
| End of message | `response.output_text.done` → `response.content_part.done` → `response.output_item.done` | Field `text` carries the assembled message text |
| Stream end | `response.completed` then `data: [DONE]\n\n` | Build the aggregated `response.output[]` and `response.usage` from accumulated state |
| Mid-stream error | `response.failed` (or a synthetic error event), then `[DONE]` | Mirror the error-chunk-then-[DONE] pattern of the Chat adapter |

**Runner reuse**: The same `claudeCodeRunner` `query()` async iterable feeds both adapters. Only the **surface mapping** differs. Architectural pattern: implement an `adaptToOpenAiResponses(events, header)` async generator next to `adaptToOpenAiSse(events, header)`; both consume `AsyncIterable<SDKEvent>` and yield `string` SSE frames. `httpServer.ts` selects the adapter by route.

#### Option 2A: Full canonical envelope (`output_item.added` → `content_part.added` → deltas → `…done` → `completed`) — RECOMMENDED
- **Strengths**: Compatible with the official `openai-node` `responses.stream()` parser and downstream tools (e.g., Codex) that crash on "OutputTextDelta without active item" when envelope events are skipped (see References row 3). Future-proof for tool_use upgrade.
- **Weaknesses**: ~30 LoC more than the bare-minimum path.
- **Effort**: Medium (low if we follow the table above mechanically).
- **Risk**: Low.

#### Option 2B: Minimal subset (`response.created`, `response.output_text.delta`, `response.completed`, `[DONE]`)
- **Strengths**: Smallest patch.
- **Weaknesses**: Demonstrably breaks strict consumers (LiteLLM bug #22102 — "delta before item" — proves OpenAI's own gpt-5.3-codex stream omitting `output_item.added` causes downstream errors). High risk of AC-20 ("OpenAI SDK Responses smoke") regression on real client versions.
- **Risk**: Medium-High.

### Focus Area 3 — Provider Decoupling

The Claude Agent SDK respects the following env vars at the **CLI subprocess level** (the SDK spawns the bundled `claude` binary):
- `CLAUDE_CODE_USE_FOUNDRY=1` — opt into Azure AI Foundry routing.
- `ANTHROPIC_FOUNDRY_RESOURCE` — required when Foundry is enabled.
- `ANTHROPIC_FOUNDRY_API_KEY` — optional (Entra ID via `az login` is the alternative).
- `ANTHROPIC_API_KEY` — used by default when `CLAUDE_CODE_USE_FOUNDRY` is unset/!=`"1"`.

These names are stable across the v0.2.x line; no rename has been documented (References rows 5, 6). However, **v0.2.113 reverted `options.env` semantics from "overlay" back to "replace"** — meaning if `claudeCodeRunner` passes `options.env = { CLAUDE_CODE_USE_FOUNDRY: "1", … }` to `query()`, it will *replace* the inherited env in the child CLI process. Mitigation: always spread `process.env` first.

#### Option 3A: Two-branch env injection inside the existing runner — RECOMMENDED
- **Description**: Single `createClaudeCodeRunner` factory; `ClaudeCodeRunnerOptions` becomes `{ useFoundry: boolean; anthropicApiKey?: string; foundryApiKey?: string; foundryResource?: string }`. Inside the runner, branch:
  ```
  const providerEnv = opts.useFoundry
    ? { CLAUDE_CODE_USE_FOUNDRY: "1", ANTHROPIC_FOUNDRY_API_KEY: opts.foundryApiKey!, ANTHROPIC_FOUNDRY_RESOURCE: opts.foundryResource! }
    : { ANTHROPIC_API_KEY: opts.anthropicApiKey! };
  const env = { ...process.env, ...providerEnv };
  ```
  `config.ts` validates the union: exactly one provider must resolve; otherwise `ConfigurationError` + exit 78.
- **Strengths**: Minimal change; one runner; clean test path; matches F-13 acceptance.
- **Weaknesses**: Conditional types in options are slightly awkward — mitigated by a discriminated union `Provider = { kind:"public"; … } | { kind:"foundry"; … }`.
- **Effort**: Low.

#### Option 3B: Two runner factories (`createPublicRunner`, `createFoundryRunner`)
- **Strengths**: Stricter typing; no conditionals in env injection.
- **Weaknesses**: Doubles the file count; couples the AgentRunner factory choice into `index.ts` instead of `config.ts`; harder to add a third provider (Bedrock, Vertex) later — F-12 leaves room.
- **Risk**: Low but worse maintainability.

#### Option 3C: Pass through *all* env vars unfiltered
- **Strengths**: Zero code in runner.
- **Weaknesses**: Breaks no-fallback rule; impossible to audit at startup; impossible to redact in logs cleanly. Rejected.

### Focus Area 4 — Tool-Use Rendering on the Responses Surface

#### Option 4A: Italic-markdown shim inside `response.output_text.delta` (mirror Chat adapter) — RECOMMENDED
- **Description**: When the SDK emits a `tool_use` block, the Responses adapter emits a `response.output_text.delta` carrying `\n\n*[<tool>: <truncated-input>]*\n` — identical wording to the Chat Completions adapter.
- **Strengths**: Bit-for-bit feature parity between the two surfaces (a single golden-snapshot test can compare); zero ambiguity for any client that just renders `output_text`; matches the F-20 wording ("Tool-use blocks … MUST be surfaced as `response.output_text.delta` italic markdown the same way the Chat Completions adapter does").
- **Weaknesses**: Loses semantic fidelity — a Responses-aware client cannot distinguish reasoning/tool-use from prose.
- **Risk**: Low.
- **Upgrade path**: Add a config flag `RESPONSES_TOOL_USE_RENDERING=text|item` (default `text`); when `item`, emit a real `response.output_item.added` of `type:"function_call"` with `name` and `arguments` fields, plus matching `…done` events. Defer to a future plan once a real consumer is identified.

#### Option 4B: Native `output_item` of `type:"function_call"` immediately
- **Strengths**: Semantically correct; future-proof.
- **Weaknesses**: Many clients (including any that just concatenate `output_text`) will display nothing for tool calls, regressing UX. Higher chance of mis-implementing the `function_call` arguments-streaming protocol (`response.function_call_arguments.delta`).
- **Risk**: Medium.

#### Option 4C: Emit a `reasoning` item
- **Strengths**: Visually similar to current italic markdown.
- **Weaknesses**: Semantically incorrect — `reasoning` is for chain-of-thought summaries, not tool dispatch. Confuses observability.
- **Risk**: Medium-High (incorrect typing).

### Focus Area 5 — Containerization (Docker + Apple `container`)

The source `Dockerfile` is portable today: `node:22-alpine`, multi-stage `deps`/`build`/`runtime`, non-root user, `EXPOSE 8000`, `CMD ["node","dist/index.js"]`. The codebase scan flagged two real concerns:

1. **uid pinning** — source uses `adduser -S agent` which does **not** pin uid=1000. AC-3 expects uid=1000. Fix: `adduser -S -u 1000 agent`.
2. **Bundled `claude` native executable** — the SDK ships per-platform packages (`@anthropic-ai/claude-agent-sdk-linux-x64-musl` etc.); on Alpine + Docker Desktop virtiofs, `createRequire`-based path resolution has historically failed. The source already mitigates with explicit `resolveClaudeExecutable()` and `pathToClaudeCodeExecutable`.

#### Option 5A: Keep explicit `pathToClaudeCodeExecutable` override — RECOMMENDED
- **Strengths**: Defensive against the documented virtiofs flake; zero downside if SDK auto-detection works (the explicit path simply matches what auto-detection would have found); already implemented in source.
- **Weaknesses**: ~20 LoC of resolver logic to carry forward.
- **Risk**: Low.

#### Option 5B: Drop the override; rely on SDK auto-detection
- **Strengths**: Fewer lines.
- **Weaknesses**: Re-introduces a class of bug already solved. The SDK has not (per the v0.2.x changelog) announced a fix to the resolver. Risk grows on Apple `container` because that runtime's filesystem layer is newer and less battle-tested than virtiofs.
- **Risk**: Medium.

**Apple `container` compatibility**: Apple's `container` CLI accepts the standard OCI Dockerfile; volume mounts and `USER` directives behave Docker-compatibly for v1 purposes (operator-side build/run only, no registry, no orchestration). The deploy runbook should document the `container build -t agent-host-cc:dev .` and `container run -v ./workspace:/workspace …` invocations and call out that file ownership of the bind-mounted workspace directory is the operator's responsibility (`chown 1000:1000 ./workspace` before first run on Linux hosts; macOS Apple `container` handles UID translation similarly to Docker Desktop). No platform-specific Dockerfile fork is needed in v1.

### Focus Area 6 — Test Framework

#### Option 6A: Keep vitest, port tests largely as-is — RECOMMENDED
- **Strengths**: Source already uses vitest@^2; project conventions name it explicitly; NF-4 demands per-test parity; zero migration cost.
- **Weaknesses**: None material.
- **Risk**: None.

**Integration test split recommendation**: Keep the existing `test/integration/agentHost.integration.test.ts` as the **Chat Completions integration test** (rename to `test/integration/agentHost.chat.integration.test.ts`). Add a sibling `test/integration/agentHost.responses.integration.test.ts` that covers AC-17, AC-18, AC-19, AC-20. Both should share helpers from a `test/integration/_helpers.ts` to avoid duplication of Fastify-inject scaffolding.

### Focus Area 7 — Documentation Set

#### Recommended document set (target paths under `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/`)

| New doc | Source doc(s) to mine | Treatment |
|---|---|---|
| `docs/design/project-design.md` | `…/open-webui-phase1/docs/design/project-design.md` | **Write fresh.** Source is whole-platform-scoped (Open WebUI + Pipelines + agent-host); transcribe only the agent-host architecture section, sanitized. |
| `docs/design/project-functions.md` | `…/docs/design/project-functions.md` | **Write fresh** by registering F-1…F-21 from the refined request directly. Source's project-functions catalogues the wider phase-1 system. |
| `docs/design/configuration-guide.md` | `…/docs/design/configuration-guide.md` | **Transcribe + extend.** Source's configuration-guide already covers env-var conventions. Update var names per §7a/§7b sanitization, add `ANTHROPIC_API_KEY`, `MODEL_PREFIX`, `FILES_API_PATH_TEMPLATE`, and the new `_EXPIRES_AT` pair. Apply the project's configuration-guide template (variable purpose, source priority, storage recommendation, default, expiry handling). |
| `docs/design/plan-001-extract-and-rebrand.md` | refined-request "Migration Plan" §1, §2, §4, §5, §6 | **Write fresh.** This is the extraction execution plan. |
| `docs/design/plan-002-add-responses-api.md` | none in source (Responses was out of scope there) | **Write fresh.** Driven by F-20, F-21, AC-17…AC-20. Cross-references this investigation's Focus Area 2 + 4. |
| `docs/design/plan-003-decouple-from-foundry.md` | refined-request "Migration Plan" §3 | **Write fresh.** Provider-abstraction plan; cross-references Focus Area 3. |
| `docs/how-to/deploy-locally.md` | refined-request F-19; source has no equivalent runbook | **Write fresh.** Covers Docker + Apple `container` build, `.env` provisioning, smoke checks (AC-4, AC-5). |
| `docs/how-to/connect-openai-client.md` | source `…/docs/how-to/connect-claude-skills-to-open-webui.md` | **Write fresh** (the source doc is Open-WebUI-centric and out of scope per NF-1). Cover OpenAI Node SDK, Python SDK, curl, Open WebUI as one of many possible clients — not the only one. |
| `docs/reference/source-extraction-notes.md` | the codebase-scan-source-agent-host.md already in the new project | **Distil.** Becomes the audit trail of what was copied / renamed / dropped (per NF-1 and Migration Plan §7). |
| `docs/reference/historical-context-cc-monitor.md` | `…/cc-monitor/` directory listing | **Pointer only**, ≤ 1 page. Per D-3 / CONFIRMED-3. |
| `docs/reference/codebase-scan-source-agent-host.md` | already exists in the new project | Keep verbatim as scan record. |

Source docs **not** worth transcribing: `…/docs/design/plan-002-typescript-agent-host.md` and `…/docs/design/plan-003-agent-host-implementation.md` are historical implementation logs of the source build — useful for cross-reference during the rename pass but they should not be copied into the new project (they describe phase-1-coupled decisions). Cite them only inside `source-extraction-notes.md` if a decision needs context.

## Comparison Matrix (top-level recommendations only)

| Focus Area | Recommended Option | Effort | Risk | Why |
|---|---|---|---|---|
| 1. Extraction strategy | 1A copy-and-adapt | Low | Low | Hard NF-1 guarantee; A-8 waives history |
| 2. Responses event sequence | 2A canonical envelope | Med | Low | openai-node parser + Codex-class clients require `output_item.added` before deltas |
| 3. Provider decoupling | 3A two-branch in single runner | Low | Low | Discriminated union; spread `process.env` to survive v0.2.113 semantics |
| 4. Tool-use rendering | 4A italic-markdown shim | Low | Low | Bit-for-bit parity with Chat adapter; documented upgrade flag |
| 5. Containerization | 5A keep `pathToClaudeCodeExecutable` | Low | Low | Defensive against virtiofs/Alpine quirk; already implemented |
| 6. Test framework | 6A vitest, split integration | Low | None | NF-4 parity; minimal cost |
| 7. Documentation | Fresh authorship of all design docs; transcribe configuration-guide only | Med | Low | Source docs are phase-1-scoped |

## Recommendation

Adopt the seven recommendations above in lockstep. The core deliverables of Phase 4 (planning) should therefore be three plans:

1. **`plan-001-extract-and-rebrand.md`** — implements Focus Areas 1, 5, 6, 7. Deliverables: copied source tree, renamed env vars, renamed mock fixtures, sanitized strings, neutralized `package.json`, dropped `@fastify/multipart`, uid=1000 pin in Dockerfile, vitest green on parity-ported unit tests, documentation set scaffolded.
2. **`plan-002-add-responses-api.md`** — implements Focus Areas 2 and 4. Deliverables: new `openAiResponseAdapter.ts` emitting the canonical envelope; `ResponsesRequestSchema` in `types.ts`; new `httpServer.ts` route `/v1/responses`; integration test covering AC-17…AC-20; tool-use shim; config flag `RESPONSES_TOOL_USE_RENDERING` reserved (default `text`).
3. **`plan-003-decouple-from-foundry.md`** — implements Focus Area 3. Deliverables: discriminated provider union in `config.ts`; two-branch env injection in `claudeCodeRunner.ts`; AC-6 (public API) and AC-7 (Foundry mock) integration coverage; mock rename `mockFoundry.ts` → `mockAnthropicProvider.ts`; CLAUDE.md exception list updated for the existing `WORKSPACE_DIR` and `chatId` derivation fallbacks (per NF-3 and OQ-8).

Conditions under which the recommendation would change:
- If the operator explicitly disowns Responses-API client compatibility (i.e., commits to only ever using `output_text` consumers), Option 2B becomes acceptable and saves a small amount of code.
- If a future Claude Agent SDK release renames the Foundry env vars, Focus Area 3 would need a one-line patch — but the variable names have been stable since Foundry support was introduced and there is no signal of an imminent rename (References row 5).

## Technical Research Guidance

**Research needed**: No.

Justification per topic:

1. *OpenAI Responses event sequence and field shapes* — The investigation already pinned the canonical envelope, the field shape of every relevant event, and the consumer-side constraint (openai-node `responses.stream()` reads typed events; Codex-class clients fail without `output_item.added`). The implementation plan can proceed by following the table in Focus Area 2, with a final cross-check against `node_modules/openai/src/lib/responses/ResponseStream.ts` *during implementation* — that is a normal coding task, not a research task.
2. *Claude Agent SDK Foundry env-var breaking changes between 0.2.138 and current* — Settled: no rename; the only behavioural change is the v0.2.113 `options.env` revert (replace, not overlay), and the mitigation is documented (always spread `process.env`). Phase 4 planning can absorb this without a deeper dive.
3. *Apple `container` CLI specifics for non-root user / volume mounts* — Settled at the v1 level: Apple `container` accepts the existing Dockerfile, behaves Docker-compatibly for `USER`, `EXPOSE`, and bind mounts; remaining concerns (host UID translation, named-volume ownership) are operator-side and belong in the deploy runbook, not in the runtime code.

If, during implementation of plan-002, the openai-node SDK's `responses.stream()` parser is found to require an event the table above does not list (e.g., a new `response.reasoning_text.delta` for newer Anthropic models surfaced as reasoning), revisit this section and dispatch a focused researcher at that point.

## Implementation Considerations

- **Discriminated provider union**: Define `type Provider = { kind:"public"; anthropicApiKey:string } | { kind:"foundry"; foundryApiKey:string; foundryResource:string }` in `config.ts`. `loadConfig` constructs exactly one. The runner accepts `Provider` and switches on `provider.kind`.
- **CLAUDE.md exception list (NF-3)**: Before implementing, add two intentional fallbacks to the project CLAUDE.md exception list — (a) `WORKSPACE_DIR` defaulting to `/workspace`, (b) deterministic `chatId` derivation when `metadata.chat_id` absent (OQ-8).
- **`process.env` spreading**: Every place that builds an env object for the SDK CLI subprocess must do `{ ...process.env, ...providerEnv }` to survive the v0.2.113 replace-semantics revert. Add a vitest case asserting `PATH` (or any unrelated env var) survives in the spawned env.
- **Sequence numbering on Responses events**: Maintain a monotonic counter `sequence_number` across the entire response (reset per request). All event payloads carry it.
- **`item_id` generation**: Use `msg_${cryptoRandomId()}` — consumers do not parse the value but it must be stable across the lifetime of the message.
- **Aggregation for non-streaming Responses**: When `stream:false`, the adapter still consumes the SDK async iterator internally and returns the assembled `Response` JSON object (`{id, object:"response", status:"completed", model, output:[message_item], usage}`). Reuse the same per-event aggregator as the streaming path.
- **Dockerfile uid pin**: Change to `RUN addgroup -S -g 1000 agent && adduser -S -u 1000 -G agent agent`.
- **`.env.example`**: Must list every variable the new `loadConfig` reads, with Anthropic public API as the default uncommented path and the Foundry block commented out.
- **Bearer token rotation**: Recommend `AGENT_HOST_API_KEY_EXPIRES_AT` be added on the same model as the other `_EXPIRES_AT` pairs (consistency, even though the operator generates the token themselves with `openssl rand -hex 32`).
- **Pitfalls to watch**:
  - Forgetting to emit `response.output_item.done` before `response.completed` (consumers will leak open items in their state machines).
  - Emitting `response.output_text.done` with mismatched `text` vs the concatenated deltas (clients reconcile and warn).
  - Letting tool_use deltas land on a different `(item_id, content_index)` than the surrounding text — keep them on the same content part to preserve linear reading order.
  - Filename collision risk during the rename: keep the Chat adapter rename and the new Responses adapter creation in **separate commits** (or sequential edit batches) so import paths stay consistent at every step.

Suggested first steps for Phase 4 planning: produce the three plan files in the order plan-001 → plan-003 → plan-002 (extract first, decouple provider second, add Responses third) — Responses depends on the runner abstraction settled by plan-003.

## References

| # | Source | URL | What was learned |
|---|---|---|---|
| 1 | OpenAI Developer Community: "Responses API streaming - the simple guide to events" | https://community.openai.com/t/responses-api-streaming-the-simple-guide-to-events/1363122 | Canonical event sequence (`response.created` → `in_progress` → `output_item.added` → `content_part.added` → `output_text.delta` → `output_text.done` → `content_part.done` → `output_item.done` → `completed`); field shapes |
| 2 | OpenAI API Reference: streaming responses | https://platform.openai.com/docs/api-reference/responses-streaming | Authoritative event-type list and field schemas (e.g., `output_text.delta` carries `item_id`, `output_index`, `content_index`, `delta`, `sequence_number`) |
| 3 | LiteLLM bug #22102 (gpt-5.3-codex SSE missing `output_item.added`) | https://github.com/BerriAI/litellm/issues/22102 | Concrete proof that strict consumers (Codex) error with "OutputTextDelta without active item" when the envelope events are skipped — drives the recommendation for Option 2A |
| 4 | OpenAI Node SDK README — `responses.create` streaming example | https://github.com/openai/openai-node | Shows `for await (const event of stream)` consumer pattern — confirms typed-event consumption, not opaque chunks |
| 5 | Microsoft DevBlogs: Claude Code + Microsoft Foundry setup | https://devblogs.microsoft.com/all-things-azure/claude-code-microsoft-foundry-enterprise-ai-coding-agent-setup/ | Confirms `CLAUDE_CODE_USE_FOUNDRY=1`, `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_FOUNDRY_API_KEY` env-var names are stable |
| 6 | Anthropic Agent SDK overview | https://platform.claude.com/docs/en/agent-sdk/overview | Lists Foundry/Bedrock/Vertex provider env vars; documents `ANTHROPIC_API_KEY` as the default-public-API selector |
| 7 | claude-agent-sdk-typescript CHANGELOG | https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md | v0.2.113 reverted `options.env` to **replace** semantics — drives the "spread `process.env`" mitigation in Focus Area 3 |
| 8 | Refined request | /Users/giorgosmarinos/aiwork/agent-host-cc/docs/design/refined-request.md | Authoritative requirements + User Confirmation 2026-05-10 |
| 9 | Codebase scan | /Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/codebase-scan-source-agent-host.md | Module map, env vars, sanitization targets, Dockerfile analysis |

## Original Request

The user requested an investigation of the best approach to deliver `agent-host-cc` covering: extraction strategy, OpenAI Responses API implementation, provider decoupling (Anthropic public default, Foundry opt-in), tool_use rendering on the Responses surface, containerization on Apple `container` and Docker, test framework continuity, and documentation strategy. Authoritative input: refined-request.md (with the 2026-05-10 user-confirmation block overriding earlier draft language) and the codebase scan. Investigation saved at `/Users/giorgosmarinos/aiwork/agent-host-cc/docs/reference/investigation-extraction-approach.md`.
