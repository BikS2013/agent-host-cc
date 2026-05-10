# Refined Request: Minimal Multi-Backend Chat UI for agent-host-cc

## Category
Development

## Objective
Add a minimal, self-contained chat UI under a dedicated subfolder of the `agent-host-cc` repository that lets a developer hold an interactive chat conversation against any of three OpenAI-compatible backends — (1) the local `agent-host-cc` service, (2) the official OpenAI API, and (3) Azure AI Foundry / Azure OpenAI deployments — switching between named, user-defined configurations at any time during a chat session. The UI must respect the project's TypeScript-only and no-config-fallback conventions.

## Scope

### In scope
- A new subfolder `chat-ui/` at the repository root containing a TypeScript application that implements the chat UI.
- Support for three backend kinds, each addressable via a named configuration profile:
  1. `agent-host-cc` (local or remote instance of this very project).
  2. `openai` (official OpenAI public API).
  3. `azure-openai` (Azure AI Foundry / Azure OpenAI deployments, key-based auth).
- A configuration model that stores **multiple named profiles**, each with a unique user-chosen name and a backend kind plus the fields appropriate for that kind.
- A UI affordance to **select the active configuration during a chat session** (i.e. switch profiles without restarting the app).
- Streaming token rendering for backends that support SSE streaming (which all three do over the OpenAI Chat Completions wire format).
- Multi-turn conversation memory within a single session (in-memory).
- Documentation update: register the chat-ui as a sub-package in `docs/design/project-design.md`, register its functional requirements in `docs/design/project-functions.md`, and add a plan file `docs/design/plan-004-chat-ui.md` (numbering continues from existing plans 001–003).

### Out of scope
- Authentication / multi-user support for the chat UI itself (single-user, localhost-only).
- Persistence of chat history across UI restarts.
- Tool-call rendering beyond what the agent-host-cc service already does (the italic-markdown `*[tool: …]*` lines flow through unchanged).
- File / image upload from the UI (text-only chat in v1).
- Embedding the chat UI inside the agent-host-cc container image; it ships as a separate dev-time app.
- Production-grade hardening (TLS termination, CSP, rate-limiting, observability dashboards).
- Provider/account management beyond the named-profile concept (no OAuth flows, no AAD interactive sign-in).
- Replacing or duplicating Open WebUI; this is a deliberately minimal tester UI.

## User stories

1. **As a developer**, I can launch the chat UI with a single command and open it in my browser to chat with a configured backend.
2. **As a developer**, I can define multiple named configurations (e.g. `local-agent-host`, `openai-prod`, `azure-foundry-eastus`) and persist them between runs.
3. **As a developer**, I can pick which named configuration is the *active* one before sending a message, including mid-conversation, without restarting the app.
4. **As a developer**, I can see assistant tokens stream into the UI in real time.
5. **As a developer**, I get a clear, non-silent error when a configuration is missing required fields, rather than a defaulted-to-empty request that fails opaquely upstream.
6. **As a developer**, I can edit a system prompt and a model name per configuration so each profile behaves predictably.

## Functional requirements

> Each requirement is numbered `FU-N` (Functional UI). Acceptance is verified by the matching AC item in the next section.

- **FU-1 — Subfolder layout.** A new top-level folder `chat-ui/` MUST be added at `chat-ui/`. It MUST contain its own `package.json`, `tsconfig.json`, `src/`, and `README.md`. It MUST NOT import from `../src/` of the host service.

- **FU-2 — TypeScript only.** All source files MUST be `.ts` / `.tsx`. No JavaScript source files. Node ≥ 22, ESM, strict TS.

- **FU-3 — Browser UI delivered via a local HTTP server.** The chat UI MUST be a browser-based single-page app served by a tiny local HTTP server (Fastify, to match the rest of the project). Running `npm run start` (inside `chat-ui/`) MUST bind to `127.0.0.1:<port>` and print the URL to open. No external network exposure by default.

- **FU-4 — Three backend kinds.** The application MUST support exactly these three `backendKind` values in its profile schema:
  - `agent-host-cc`
  - `openai`
  - `azure-openai`

- **FU-5 — Profile schema per backend.** Each named profile MUST validate against a Zod schema. Required fields per kind:

  | Field | `agent-host-cc` | `openai` | `azure-openai` |
  |---|---|---|---|
  | `name` (unique, non-empty) | required | required | required |
  | `backendKind` | required (`agent-host-cc`) | required (`openai`) | required (`azure-openai`) |
  | `baseUrl` | required (e.g. `http://localhost:8000`) | optional (default `https://api.openai.com`) | n/a |
  | `apiKey` (bearer) | required | required | required (Azure key) |
  | `defaultModel` | required (must match the host's `MODEL_IDS` after prefix stripping) | required | n/a (deployment used instead) |
  | `endpoint` | n/a | n/a | required (e.g. `https://<resource>.openai.azure.com` or `https://<resource>.services.ai.azure.com`) |
  | `deployment` | n/a | n/a | required |
  | `apiVersion` | n/a | n/a | required (e.g. `2024-10-21`) |
  | `systemPrompt` | optional | optional | optional |
  | `temperature`, `maxTokens` | optional | optional | optional |

  Missing required fields MUST cause profile validation to fail loudly at load time (Zod parse throw, surfaced as an explicit UI/console error). No silent defaults for required fields.

- **FU-6 — No-fallback rule for configuration.** Consistent with project convention NF-3, the chat UI MUST NOT supply a fallback value for any *required* profile field. If a required field is absent, a typed `ConfigurationError` MUST be raised, naming the offending profile and field. The two clearly optional fields with documented defaults are `openai.baseUrl` (default `https://api.openai.com`) and the global UI listen port (`CHAT_UI_PORT`, default `5173`). Any additional default introduced during implementation MUST be recorded in the project's `CLAUDE.md` "Configuration Fallback Exceptions" section before being merged.

- **FU-7 — Profile storage.** Profiles MUST be persisted on disk in a single JSON file at:
  `~/.agent-host-cc/chat-ui/profiles.json`
  The directory MUST be created on first run with mode `0700`; the file MUST be written with mode `0600`. The path MAY be overridden by the `CHAT_UI_PROFILES_PATH` env var. Profiles MUST be re-validated on every read.

- **FU-8 — Profile management UI.** The UI MUST provide:
  - A list view of existing profiles.
  - A "create profile" form whose visible fields adapt to the selected `backendKind`.
  - An "edit profile" action.
  - A "delete profile" action with a confirmation step.

- **FU-9 — Active-profile selector.** The UI MUST expose a profile selector (dropdown or equivalent) at the top of the chat surface. Changing the selection MUST take effect on the *next* user message. Switching MUST NOT silently clear the conversation; see FU-10.

- **FU-10 — Conversation continuity on profile switch.** When the user switches active profile mid-conversation, the existing in-memory message history (system + alternating user/assistant turns) MUST be preserved and forwarded to the newly selected backend. The UI MUST display a non-blocking inline notice in the transcript indicating the switch (e.g. `— switched to profile "openai-prod" —`) so the user can correlate later replies. If the new profile is `azure-openai` and the previous model name is incompatible, the new profile's `deployment` is used; no client-side translation of model identifiers is performed beyond per-profile `defaultModel` / `deployment`.

- **FU-11 — Chat semantics use OpenAI Chat Completions wire format for all three backends.**
  - `agent-host-cc`: `POST {baseUrl}/v1/chat/completions` with `Authorization: Bearer {apiKey}`.
  - `openai`: `POST {baseUrl}/v1/chat/completions` with `Authorization: Bearer {apiKey}`.
  - `azure-openai`: `POST {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}` with header `api-key: {apiKey}`.
  The request body MUST use the standard OpenAI Chat Completions shape: `{ model, messages, stream, temperature?, max_tokens? }`. For `azure-openai`, `model` is omitted from the body (deployment is in the URL).

- **FU-12 — Streaming.** The UI MUST request `stream: true` and render incremental `chat.completion.chunk` deltas as they arrive (SSE). When the upstream emits `data: [DONE]`, the UI MUST finalize the assistant message. On mid-stream error chunks, the UI MUST surface the error text inline rather than silently truncating.

- **FU-13 — Error surfacing.** All HTTP / SSE / validation errors MUST be displayed in the UI with: HTTP status, upstream error envelope (if any), and a short hint identifying which profile field is likely at fault. Errors MUST NOT be swallowed.

- **FU-14 — Minimal controls per chat.** The chat surface MUST expose, at minimum: message input + send, transcript with role-tagged messages, profile selector, and a "new conversation" (clear-transcript) button. `system prompt`, `temperature`, and `max_tokens` are taken from the active profile; per-turn overrides are out of scope for v1.

- **FU-15 — Independent dependency tree.** `chat-ui/package.json` MUST declare its own dependencies. It MUST NOT modify the root `package.json` of `agent-host-cc`. Convenience root scripts to delegate (`npm run chat-ui:dev`, `npm run chat-ui:start`) MAY be added in a follow-up plan but are NOT required for this request.

- **FU-16 — Test scripts.** Test scripts MUST live under `chat-ui/test_scripts/` (creating the folder if absent) per project convention. At minimum, vitest unit tests MUST cover: profile schema validation per backend kind, the URL/headers builder per backend kind, and the SSE parser.

- **FU-17 — Documentation updates.**
  - A new plan file `docs/design/plan-004-chat-ui.md` MUST be added describing the build steps.
  - `docs/design/project-design.md` MUST gain a new section describing the `chat-ui/` sub-package (purpose, scope, non-goals, where it lives, how it relates to the host service).
  - `docs/design/project-functions.md` MUST register FU-1 … FU-17 in its functional-requirements table.
  - A `chat-ui/README.md` MUST document install, run, and profile management.

## Configuration model (summary)

| Variable / field | Scope | Required | Default | Storage |
|---|---|---|---|---|
| `CHAT_UI_PORT` | env (process) | optional | `5173` | shell / `.env` for `chat-ui` |
| `CHAT_UI_PROFILES_PATH` | env (process) | optional | `~/.agent-host-cc/chat-ui/profiles.json` | shell / `.env` |
| Profile: `name`, `backendKind` | profile file | required | — | `profiles.json` |
| Profile: backend-specific fields | profile file | required per FU-5 table | — | `profiles.json` |
| Profile: `systemPrompt`, `temperature`, `maxTokens` | profile file | optional | — (omitted from request if absent) | `profiles.json` |

`apiKey` fields are secrets and MUST be stored only in `profiles.json` under the user's home directory with `0600` permissions. They MUST NOT be logged. The UI MUST mask key fields by default and offer a "reveal" toggle.

## UI/UX requirements (minimal)

- Single-page layout, two panes:
  1. Left (narrow): profiles list, active-profile selector, "new conversation" button.
  2. Right (wide): transcript + input box.
- Light-on-dark or system-default styling acceptable; no design system mandated.
- Streaming tokens append in place to the in-progress assistant message bubble.
- Profile-switch banner rendered inline as a system-style transcript entry.
- Keyboard: Enter sends, Shift+Enter inserts a newline.
- No client-side routing beyond profile-edit modal toggling.

## Constraints

- **Language / runtime:** TypeScript only, Node ≥ 22, ESM. Browser bundle built with whichever pragmatic tool the implementer chooses (e.g. `vite` or `esbuild`); the choice does NOT need to match the host service's `tsx` setup.
- **Framework on the server side:** Fastify, to align with the rest of the project.
- **Validation:** Zod for profile and request schemas, to align with the rest of the project.
- **HTTP client:** `undici` or the platform `fetch`; no axios.
- **No fallbacks for required config (NF-3 parity).**
- **No version-control operations** are performed as part of this work.
- **No modification of the host service's source** under `src/` is permitted by this request; the chat UI is purely a client.
- **Tool-creation convention.** This UI is a stand-alone sub-application, NOT a project "tool" in the `/tool-conventions` sense. It therefore does NOT go through the `tool-doc-config-architect` subagent. (Confirm with user — see Open Questions.)

## Acceptance criteria

- **AC-CU-1.** `cd chat-ui && npm install && npm run start` exits 0 and prints a `http://127.0.0.1:<port>` URL. Opening that URL in a browser renders the chat layout.
- **AC-CU-2.** Creating a profile with `backendKind=agent-host-cc`, valid `baseUrl`, `apiKey`, and `defaultModel`, then sending the message "ping" against a running local `agent-host-cc` instance, produces a streamed assistant reply rendered token-by-token.
- **AC-CU-3.** Creating a profile with `backendKind=openai`, a valid `apiKey`, and `defaultModel=gpt-4o-mini` (or any currently-valid OpenAI model), then sending a message, produces a streamed assistant reply.
- **AC-CU-4.** Creating a profile with `backendKind=azure-openai`, a valid `endpoint`, `deployment`, `apiVersion`, and `apiKey`, then sending a message, produces a streamed assistant reply.
- **AC-CU-5.** Defining three profiles named `local`, `openai-prod`, `azure-foundry`; switching between them via the selector during a single conversation; all three replies appear in the transcript and each is annotated with the active profile name at the time it was generated.
- **AC-CU-6.** Attempting to save a profile that omits a required field per FU-5 produces an explicit error in the UI naming the missing field; no profile is written; the file on disk is unchanged.
- **AC-CU-7.** `~/.agent-host-cc/chat-ui/` exists with mode `0700` and `profiles.json` has mode `0600` after first profile is saved (verified by `stat`).
- **AC-CU-8.** `npm test` inside `chat-ui/` passes vitest unit tests covering: profile schema per backend kind, request URL + header builder per backend kind, SSE parser fragment reassembly.
- **AC-CU-9.** `docs/design/plan-004-chat-ui.md`, the new section in `docs/design/project-design.md`, the new FU-1…FU-17 rows in `docs/design/project-functions.md`, and `chat-ui/README.md` all exist and are internally consistent (cross-references resolve).
- **AC-CU-10.** A grep of `chat-ui/src/` for hard-coded API keys or hard-coded model names yields zero matches (everything comes from profile data).
- **AC-CU-11.** Switching the active profile mid-conversation preserves the prior `messages` array and forwards it on the next request (verified by network inspector or by a vitest covering the request-builder against the in-memory history).
- **AC-CU-12.** The chat UI server, when started without `CHAT_UI_PORT`, binds to `127.0.0.1:5173`. When started with `CHAT_UI_PORT=0`, it binds to an OS-assigned port and prints it.

## Assumptions

Each assumption below was made because the corresponding clarification could not be obtained via interactive questioning in this refinement step. The user should confirm or amend any of these before implementation starts.

- **A-1 — UI surface = browser.** A browser-based SPA served by a tiny local Fastify server was chosen over TUI/Electron because it is the most portable minimal option, matches the project's existing Fastify/TypeScript stack, and lets the user open multiple tabs trivially.
- **A-2 — Folder placement = subfolder.** The user's wording "in a separate folder" was interpreted as a subfolder of the existing repo (`chat-ui/`), not a separate sibling repository.
- **A-3 — Profile storage location.** `~/.agent-host-cc/chat-ui/profiles.json` was chosen so profiles survive across builds and are not committed to the repo. An alternative under the `chat-ui/` folder was rejected to prevent accidental commits of secrets.
- **A-4 — Per-backend required fields** are exactly those listed in the FU-5 table. In particular, Azure AI Foundry is treated as Azure OpenAI key-based; AAD / Managed Identity is deliberately out of scope for v1.
- **A-5 — Streaming = on by default.** SSE streaming is enabled for all three backends since each supports `stream: true` on Chat Completions.
- **A-6 — Conversation state = in-memory only.** No disk persistence of chat transcripts in v1; "new conversation" simply clears the in-memory array.
- **A-7 — Switching profile mid-conversation preserves history** (FU-10) rather than resetting it. This is the more useful default for comparing backends on the same context.
- **A-8 — UI authentication = none, localhost-only.** No shared secret on the chat UI itself; security relies on binding to `127.0.0.1`.
- **A-9 — Minimal feature set = text-only, per-profile system prompt and sampling controls; no per-turn overrides; no file/image upload.**
- **A-10 — Build/run integration = self-contained.** The root `agent-host-cc` `package.json` is NOT modified. Users `cd chat-ui` and run scripts there.
- **A-11 — Tooling convention exemption.** This chat UI is treated as a sub-application, not a project tool, so it does NOT pass through `/tool-conventions scaffold`. Its documentation lives under `docs/design/` and `chat-ui/README.md`, not under `docs/tools/`.
- **A-12 — OpenAI Responses API is not used by the UI in v1.** The UI calls Chat Completions on all three backends for uniformity. The host service's `/v1/responses` endpoint is therefore not exercised by this UI; it remains available for other clients.

## Open questions

> **2026-05-10 — Orchestrator confirmation:** The user has explicitly confirmed Q-1 (browser SPA), Q-4 (API key only), Q-5 (preserve history on profile switch), and Q-8 (sub-application packaging, NOT routed through `/tool-conventions scaffold`). Q-2, Q-3, Q-6, Q-7 are accepted as assumed defaults (subfolder `/chat-ui/`, profile storage at `~/.agent-host-cc/chat-ui/profiles.json`, no per-turn knobs in v1, no root-level npm scripts).

> These remain unresolved after refinement and should be confirmed (or overridden) before plan-004 is approved for execution.

- **Q-1.** Confirm UI surface choice — **browser SPA** (assumed) vs terminal TUI vs Electron desktop. If the user prefers a TUI, the entire FU-3 / FU-8 / FU-14 sections will need to be reworked around a TTY library (e.g. Ink or blessed).
- **Q-2.** Confirm subfolder name and placement — proposed: `chat-ui/`. Alternatives: `apps/chat-ui/`, `clients/chat-ui/`.
- **Q-3.** Confirm profile storage location — proposed: `~/.agent-host-cc/chat-ui/profiles.json`. Alternative: a path under the `chat-ui/` folder ignored by git, or per-OS standard config dirs (`$XDG_CONFIG_HOME` on Linux, etc.).
- **Q-4.** Confirm Azure auth model — proposed: **key-based only** (`api-key` header, `apiVersion` query). If AAD / Managed Identity is required, the profile schema gains optional `tenantId`, `clientId`, and a token-acquisition step.
- **Q-5.** Confirm that **mid-conversation profile switches preserve history** (FU-10 / A-7). If the user prefers a reset on switch, FU-10 inverts.
- **Q-6.** Confirm that per-turn knobs (model picker, temperature, max_tokens overriding the profile) are NOT needed in v1.
- **Q-7.** Confirm that no root-level npm scripts will be added in v1; the chat UI is fully self-contained under `chat-ui/`.
- **Q-8.** Confirm exemption from the `/tool-conventions scaffold` flow (A-11). If the user wants this packaged as a "tool" instead, the layout shifts to `docs/tools/chat-ui.md` + `~/.tool-agents/chat-ui/`, and the tool-doc-config-architect subagent must own the spec.

## Original request

```
I want you to add in a separate folder a minimal chat UI implementation capable of going through:
- the API implemented here (the existing agent-host-cc service at <repo-root>, which exposes OpenAI-compatible Chat Completions and Responses APIs)
- the official OpenAI API
- the Azure Foundry OpenAI deployments

It must allow more than one configuration. Each configuration has its own name. The user must be able to select which configuration is the active one during the chat.
```
