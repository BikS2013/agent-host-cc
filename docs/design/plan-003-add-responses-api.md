# Plan 003 — Add OpenAI Responses API surface to `agent-host-cc`

> **Status:** Planned
> **Owner:** Implementation phase
> **Depends on:** plan-001-extract-and-rebrand.md (must be complete)
> **Parallelizable with:** plan-002-decouple-from-foundry.md (independent)
> **Source of truth:**
> - `docs/design/refined-request.md` § F-20, F-21, AC-17, AC-18, AC-19, AC-20, CONFIRMED-2
> - `docs/reference/investigation-extraction-approach.md` § Focus Area 2 (Option 2A) and Focus Area 4 (Option 4A)
> - `docs/reference/codebase-scan-source-agent-host.md` § 6, § 9 (F-20 / F-21 rows)

## Objective

Implement a working `POST /v1/responses` endpoint emitting the canonical OpenAI Responses event sequence (with full `output_item` / `content_part` envelope events, per Investigation Option 2A), validated by Zod, sharing the runner and attachment processor with `/v1/chat/completions`. Reclaim the file name `openAiResponseAdapter.ts` for what it should always have been: a Responses API adapter. Move the existing Chat Completions SSE adapter contents to a correctly-named `openAiChatSseAdapter.ts`.

## Acceptance criteria covered

- **F-20** OpenAI Responses API surface (streaming + non-streaming).
- **F-21** Adapter selection (route-based, shared runner / attachments / workspace).
- **AC-17** Responses API streaming smoke (canonical event sequence + `[DONE]`).
- **AC-18** Responses API non-streaming aggregate JSON.
- **AC-19** Responses API attachment parity (`input_image` data URLs handled).
- **AC-20** OpenAI SDK Responses smoke (`client.responses.create`).

## Phase 1 — Rename existing adapter (Chat Completions SSE)

> **Investigation reference:** Focus Area 1 + refined-request "Source file rename revised" §3.

- [ ] 1.1 Rename `src/openAiResponseAdapter.ts` → `src/openAiChatSseAdapter.ts`. Keep the file's contents identical (it actually emits Chat Completions SSE chunks).
- [ ] 1.2 Update imports:
  - `src/httpServer.ts` — change `from "./openAiResponseAdapter.js"` to `from "./openAiChatSseAdapter.js"`.
  - Any test that imports the adapter — likely `test/unit/openAiResponseAdapter.test.ts`. Rename that file as well → `openAiChatSseAdapter.test.ts` and update the import path inside it.
- [ ] 1.3 Verification: `grep -RIn 'openAiResponseAdapter' src test` should produce zero hits at this point. The name is now free for Phase 2.

### Files modified / renamed in Phase 1
Renamed:
- `src/openAiResponseAdapter.ts` → `openAiChatSseAdapter.ts`
- `test/unit/openAiResponseAdapter.test.ts` → `openAiChatSseAdapter.test.ts`

Modified:
- `src/httpServer.ts`
- `test/unit/openAiChatSseAdapter.test.ts`

## Phase 2 — New `openAiResponseAdapter.ts` emitting Responses events

> **Investigation reference:** Focus Area 2, Option 2A. Full canonical envelope with `output_item.added` → `content_part.added` → `output_text.delta…` → `output_text.done` → `content_part.done` → `output_item.done` → `completed`.

- [ ] 2.1 Create `src/openAiResponseAdapter.ts` exporting:
  ```ts
  export type ResponsesHeader = { id: string; model: string; created: number };
  export async function* adaptToOpenAiResponses(
    events: AsyncIterable<unknown>,
    header: ResponsesHeader,
  ): AsyncIterable<string>;
  export async function aggregateResponses(
    events: AsyncIterable<unknown>,
    header: ResponsesHeader,
  ): Promise<unknown>; // Response JSON object for non-streaming case
  ```
- [ ] 2.2 Streaming event sequence (per Investigation Focus Area 2 table):
  - [ ] 2.2.a `response.created` with `response: { id, object:"response", status:"in_progress", model, created_at:created, output:[] }`.
  - [ ] 2.2.b `response.in_progress` with the same response object.
  - [ ] 2.2.c On the first SDK assistant `text` block, emit `response.output_item.added` (item type=`message`, role=`assistant`, content=[]) with `output_index=0` and a fresh `item_id = "msg_" + cryptoRandomId()`.
  - [ ] 2.2.d Followed by `response.content_part.added` with `content_index=0` and `part:{ type:"output_text", text:"" }`.
  - [ ] 2.2.e For every text delta, emit `response.output_text.delta` carrying `item_id`, `output_index`, `content_index`, `delta=<chunk>`, `sequence_number=<monotonic>`.
  - [ ] 2.2.f On stream end (or first non-text block boundary), emit `response.output_text.done` with full `text=<accumulated>`, then `response.content_part.done` with the completed `part`, then `response.output_item.done` with the assembled message item.
  - [ ] 2.2.g Emit `response.completed` carrying the full `Response` object (status `"completed"`, populated `output[]` and `usage`).
  - [ ] 2.2.h Always finalize with `data: [DONE]\n\n` (matches Chat adapter symmetry; harmless for clients).
- [ ] 2.3 Maintain a per-request **monotonic `sequence_number`** counter (reset per request); attach it to every event payload.
- [ ] 2.4 Mid-stream errors: emit a synthetic `response.failed` (or fall back to `response.error` per the OpenAI schema; pick one and document) with `error: { code, message }`, then `data: [DONE]\n\n`. **Never** silently truncate.
- [ ] 2.5 SSE framing: each event is two lines:
  ```
  event: <event-type>\n
  data: <JSON>\n\n
  ```
  Plus the terminating `data: [DONE]\n\n`.

## Phase 3 — Tool-use rendering shim

> **Investigation reference:** Focus Area 4, Option 4A (italic-markdown shim, default `text` mode).

- [ ] 3.1 In the new adapter, when the SDK emits a `tool_use` block, render it as a `response.output_text.delta` carrying the same italic-markdown wording as the Chat adapter:
  ```
  \n\n*[<tool_name>: <truncated_input>]*\n
  ```
  Stay on the same `(item_id, content_index)` as the surrounding text so reading order is linear.
- [ ] 3.2 Reserve env flag **`RESPONSES_TOOL_USE_RENDERING`** (values `text` | `item`) in `src/config.ts`:
  - Default: `"text"`.
  - When `"item"` (future upgrade), the adapter must emit a `response.output_item.added` of `type:"function_call"` with `name`, `arguments`, plus matching `…done` events. Implementation deferred — for v1, throw `ConfigurationError` if `"item"` is selected, with message "RESPONSES_TOOL_USE_RENDERING=item is reserved for a future plan; default 'text' is supported in v1".
- [ ] 3.3 Add the new env var to `Config`, `loadConfig`, and `test/unit/config.test.ts` (default + future-reserved error case).

### Files modified in Phase 3
- `src/config.ts`
- `src/openAiResponseAdapter.ts`
- `test/unit/config.test.ts`

## Phase 4 — Zod request schema for `/v1/responses`

- [ ] 4.1 In `src/types.ts`, add `ResponsesRequestSchema` accepting:
  - `model: string` (required)
  - `input: string | InputMessage[]` where `InputMessage` is a discriminated union of:
    - `{ role: "user" | "assistant" | "system", content: InputContentPart[] }`
    - `InputContentPart = { type: "input_text", text: string } | { type: "input_image", image_url: string | { url: string } }`
  - `stream?: boolean` (default `false` for non-streaming AC-18; default `true` for streaming smoke if absent — match OpenAI defaults)
  - `temperature?: number`
  - `top_p?: number`
  - `max_output_tokens?: number`
  - `metadata?: { chat_id?: string }`
  - `files?: FileRef[]` (reuse the same `FileRef` from the Chat schema)
- [ ] 4.2 Export both the schema and the inferred TS type `ResponsesRequest`.
- [ ] 4.3 Validate that the `input_image.image_url` shape (string OR `{url: string}`) is normalized inside the route handler before passing to the attachment processor — translate to the same internal shape the Chat adapter uses (`{ type: "image_url", image_url: { url } }`) so the existing `attachmentProcessor.ts` requires zero changes.
- [ ] 4.4 Add unit tests in `test/unit/types.test.ts` for: minimal-string-input, message-array-input, mixed text+input_image, missing-model rejected, invalid-image-url-shape rejected.

### Files modified in Phase 4
- `src/types.ts`
- `test/unit/types.test.ts`

## Phase 5 — Mount `POST /v1/responses` in `httpServer.ts`

> **Investigation reference:** Focus Area 2 ("Runner reuse") + F-21.

- [ ] 5.1 In `src/httpServer.ts`, register a new route `POST /v1/responses`:
  - Apply the same `requireAuth(req, reply)` guard used by `/v1/chat/completions`.
  - Parse with `ResponsesRequestSchema.safeParse(req.body)`. On failure → `InvalidRequestError` (422).
  - Strip `cfg.modelPrefix` from `model`. On unknown model → `ModelNotFoundError` (404).
  - Normalize `input` (string → single user message; array → as-is). Translate `input_image` parts to `image_url` parts that the existing `attachmentProcessor` accepts.
  - Run `attachmentProcessor.process({ chatId, messages, files })`.
  - Call `runner.run({ messages, model, chatId, … })` — **same call** as the Chat path.
  - Branch on `req.body.stream`:
    - **Streaming:** set `Content-Type: text/event-stream`; consume `runner.events` through `adaptToOpenAiResponses(events, header)`; pipe yielded SSE strings to the reply.
    - **Non-streaming:** consume the same iterator through `aggregateResponses(events, header)` and return the assembled `Response` JSON.
- [ ] 5.2 Share the runner, attachment processor, workspace manager, and config across both routes — no duplication. The HTTP-server factory already accepts these as injected dependencies; no signature change needed.
- [ ] 5.3 Add `header.id` generation as `"resp_" + cryptoRandomId()` to mirror Chat's `chatcmpl_…` shape.
- [ ] 5.4 Update the integration test scaffolding (`test/integration/_helpers.ts` from plan-002 if present; otherwise inline) so the same Fastify-inject helper covers both routes.

### Files modified in Phase 5
- `src/httpServer.ts`

## Phase 6 — Tests

- [ ] 6.1 Create `test/unit/openAiResponseAdapter.test.ts` (NEW file — distinct from the renamed Chat adapter test). Cover:
  - [ ] 6.1.a **Sequence ordering** — feed a synthetic SDK iterator yielding two text deltas and assert events arrive in this order: `response.created`, `response.in_progress`, `response.output_item.added`, `response.content_part.added`, `response.output_text.delta` ×2, `response.output_text.done`, `response.content_part.done`, `response.output_item.done`, `response.completed`, `[DONE]`.
  - [ ] 6.1.b **Sequence numbers monotonic** — extract `sequence_number` from each event, assert strictly increasing.
  - [ ] 6.1.c **Tool-use shim** — feed an SDK iterator with one text + one tool_use + one text; assert all three render as `output_text.delta` events on the same `(item_id, content_index)` and the tool_use delta contains `*[<tool>: …]*`.
  - [ ] 6.1.d **Error path** — feed an iterator that throws mid-stream; assert a `response.failed` (or chosen error event) precedes `[DONE]`.
  - [ ] 6.1.e **Aggregator** — `aggregateResponses` returns a `Response` JSON object with `id`, `object:"response"`, `status:"completed"`, `model`, `output[0].content[0].text` equal to concatenated deltas.
- [ ] 6.2 Create `test/integration/agentHost.responses.integration.test.ts` mirroring the existing Chat integration test:
  - [ ] 6.2.a **AC-17** streaming smoke — `POST /v1/responses` with `input: "say hi"` and `stream:true`; assert `Content-Type: text/event-stream`, ends with `data: [DONE]\n\n`, aggregated output_text non-empty.
  - [ ] 6.2.b **AC-18** non-streaming — same body with `stream:false`; assert JSON shape `{id, object:"response", model, output, usage}`.
  - [ ] 6.2.c **AC-19** attachment parity — `input_image` with a `data:image/png;base64,…` URL; assert the file lands in `<workspace>/<chatId>/`, the SDK was called with an inline image block (verified via mock), and the manifest line is appended.
  - [ ] 6.2.d Reuse the renamed Chat integration test as the original Chat path; the helper module bridges both.
- [ ] 6.3 Create `test_scripts/smoke-responses-sdk.ts`:
  - Uses the official `openai` Node SDK (already in devDependencies; otherwise add `openai` as a `devDependency`).
  - Calls `const stream = await client.responses.create({ model, input:"hello", stream:true })` and `for await (const event of stream)` to consume.
  - This is **AC-20** evidence.

### Files created in Phase 6
- `test/unit/openAiResponseAdapter.test.ts`
- `test/integration/agentHost.responses.integration.test.ts`
- `test_scripts/smoke-responses-sdk.ts`

## Phase 7 — Documentation

- [ ] 7.1 The Designer (Phase 5) will populate `docs/design/project-design.md`. This plan reserves the slots:
  - Section "Adapters" gets two subsections: `Chat Completions SSE` (the renamed adapter) and `Responses API` (the new adapter), with the canonical event-sequence diagram cribbed from Investigation Focus Area 2.
- [ ] 7.2 The Designer will populate `docs/how-to/connect-openai-client.md`. This plan reserves a section:
  - "Using the OpenAI Node SDK Responses API" — example code for both streaming (`responses.create({ stream:true })`) and non-streaming.
- [ ] 7.3 No documentation changes happen in this plan's implementation. Both files are produced in Phase 5 / Designer.

## Verification checklist (Claude-executable)

```bash
cd <repo-root>

# Type-check + tests
npm run build
npm test

# Adapter rename complete
test -f src/openAiChatSseAdapter.ts
test -f src/openAiResponseAdapter.ts
diff <(grep -c 'chat.completion.chunk' src/openAiChatSseAdapter.ts) <(echo "5") || true   # rough sanity
grep -q 'response.output_text.delta' src/openAiResponseAdapter.ts
grep -q 'response.output_item.added' src/openAiResponseAdapter.ts
grep -q 'response.completed' src/openAiResponseAdapter.ts
grep -q "data: \[DONE\]" src/openAiResponseAdapter.ts

# Route mounted
grep -q "POST.*'/v1/responses'\\|post.*\"/v1/responses\"" src/httpServer.ts

# Schema present
grep -q 'ResponsesRequestSchema' src/types.ts

# Tests present
test -f test/unit/openAiResponseAdapter.test.ts
test -f test/integration/agentHost.responses.integration.test.ts
test -f test_scripts/smoke-responses-sdk.ts

# Config flag reserved
grep -q 'RESPONSES_TOOL_USE_RENDERING' src/config.ts
```

## Risks and mitigations

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Filename collision during the rename — for a moment, both `openAiResponseAdapter.ts` and the new file want to exist. | Phase 1 (rename existing) and Phase 2 (create new) are **separate, sequential** edit batches. Between them, `grep -RIn 'openAiResponseAdapter' src test` returns zero. Then Phase 2 creates the new file with a clean import graph. |
| R2 | Strict consumers (e.g., Codex, openai-node `responses.stream()`) error with "OutputTextDelta without active item" if envelope events are skipped (LiteLLM bug #22102). | Investigation Option 2A is mandatory: emit the full envelope (`output_item.added`, `content_part.added`, `…done` for both, `output_item.done`). Phase 2.2 enforces this; Phase 6.1.a verifies ordering. |
| R3 | `output_text.done.text` mismatches the concatenation of deltas — clients warn or reconcile. | Phase 2.2.f computes `text` from the same accumulator that produced the deltas. Phase 6.1 verifies equality. |
| R4 | Tool-use deltas land on a different `(item_id, content_index)` than the surrounding text — clients render out of order. | Phase 3.1 explicitly stays on the active text part. Phase 6.1.c asserts the invariant. |
| R5 | Sequence number gaps or duplicates. | Single shared monotonic counter per request, advanced exactly once per emitted event. Phase 6.1.b asserts strictly increasing. |
| R6 | Future-reserved `RESPONSES_TOOL_USE_RENDERING=item` accidentally enabled in production. | Phase 3.2 raises `ConfigurationError` at startup if `"item"` is set in v1. Forces an explicit later upgrade. |
| R7 | Non-streaming aggregator (`aggregateResponses`) re-implements logic from the streaming generator and drifts. | Implement the aggregator by **internally consuming** the same async generator and accumulating events into the final `Response` shape. One source of truth. |
| R8 | `input_image.image_url` shape variance (string vs object). | Phase 4.3 normalizes both forms to the internal Chat-style shape before handing to `attachmentProcessor`. Existing attachment code is unchanged. |
| R9 | OpenAI SDK update changes the expected event-type strings or shapes. | Cross-check against `node_modules/openai/src/lib/responses/ResponseStream.ts` during implementation per Investigation Technical Research Guidance §1. Re-dispatch a researcher only if a mismatch is found. |
| R10 | Adapter shares state across requests (counters, header, etc.). | The adapter is a **per-call async generator**; no module-level state. Phase 2.1's signature enforces this. |

## Dependencies

- **Requires:** plan-001 complete (file structure, MODEL_PREFIX, exception list).
- **Independent of:** plan-002. The runner is consumed through its async-iterator interface; whether the underlying provider is public or Foundry is irrelevant to the adapter. Plans 002 and 003 can run in parallel.

## Out of scope for this plan

- Native `function_call` items (deferred behind `RESPONSES_TOOL_USE_RENDERING=item`).
- Native `reasoning` items (rejected by Investigation Focus Area 4 Option 4C).
- Tool-call output streaming (`response.function_call_arguments.delta`) — only relevant once 4B/Option `item` mode lands.
- `response.audio.*`, `response.refusal.*`, `response.image.*` event families — not produced by Claude through the SDK in v0.2.x.
- Multi-turn server-side state (`previous_response_id`) — out of scope per the source's stateless stance (refined-request Out-of-scope #5).
