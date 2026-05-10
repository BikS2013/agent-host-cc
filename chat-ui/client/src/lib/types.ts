/**
 * Shared client-side types for the chat-ui SPA.
 *
 * These mirror the server's REST contract documented in
 * `docs/design/project-design.md` §14.6 (REST API contracts) and §14.4
 * (profile schema). The shapes are intentionally hand-written here (not
 * imported from the server package) because client and server are two
 * separate TypeScript projects with independent tsconfigs (project rule:
 * the client must not import from `chat-ui/server/**`).
 *
 * IMPORTANT — `apiKey` redaction (§14.6, §14.12):
 *   Every Profile object that traverses HTTP from the server to the SPA
 *   has its `apiKey` replaced with the literal sentinel string
 *   `"<redacted>"`. The single exception is the gated reveal endpoint
 *   (not used in this Phase 6b skeleton). On PUT, the SPA may either
 *   (a) send the real key (server rotates it), or (b) send `"<redacted>"`
 *   or `""` (server preserves the existing on-disk key).
 */

/** Backend kind discriminator. */
export type BackendKind = "agent-host-cc" | "openai" | "azure-openai";

/** Fields shared across all backend kinds. */
export interface ProfileBaseFields {
  id: string;
  name: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentHostProfile extends ProfileBaseFields {
  backendKind: "agent-host-cc";
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

export interface OpenAiProfile extends ProfileBaseFields {
  backendKind: "openai";
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

export interface AzureOpenAiProfile extends ProfileBaseFields {
  backendKind: "azure-openai";
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
}

/**
 * Discriminated union of all profile variants. On the wire (server →
 * SPA) the `apiKey` is always the sentinel `"<redacted>"` unless
 * fetched via the explicit reveal endpoint.
 */
export type Profile = AgentHostProfile | OpenAiProfile | AzureOpenAiProfile;

/** Same as `Profile` but with the apiKey constrained to the redaction sentinel. */
export type RedactedProfile = Profile & { apiKey: "<redacted>" };

/** Shape returned by `GET /api/profiles` (§14.6.1). */
export interface ProfilesListResponse {
  activeProfileId: string | null;
  profiles: RedactedProfile[];
}

/** Body of `POST /api/profiles` — full profile minus `id`. */
export type CreateProfileInput =
  | Omit<AgentHostProfile, "id">
  | Omit<OpenAiProfile, "id">
  | Omit<AzureOpenAiProfile, "id">;

/** Body of `PUT /api/profiles/:id` — full profile including `id`. */
export type UpdateProfileInput = Profile;

/** Standard error envelope returned by the server (§14.6, §14.10). */
export interface ServerErrorEnvelope {
  error: {
    type: string;
    message: string;
    issues?: Array<{ path: Array<string | number>; message: string }>;
    [extra: string]: unknown;
  };
}

/** Thrown by `lib/api.ts` and `lib/sseClient.ts` on non-2xx responses. */
export class ApiError extends Error {
  public readonly status: number;
  public readonly type: string;
  public readonly issues?: Array<{ path: Array<string | number>; message: string }>;
  public readonly raw: unknown;

  constructor(args: {
    status: number;
    type: string;
    message: string;
    issues?: Array<{ path: Array<string | number>; message: string }>;
    raw?: unknown;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.status = args.status;
    this.type = args.type;
    this.issues = args.issues;
    this.raw = args.raw;
  }
}

/** Role on a chat message (mirrors OpenAI Chat Completions). */
export type ChatRole = "user" | "assistant" | "system";

/**
 * Wire-format message sent to `POST /api/chat`. The server forwards
 * these verbatim to the upstream backend after profile-level
 * system-prompt prepending (§14.8).
 */
export interface WireMessage {
  role: ChatRole;
  content: string;
}

/** Request body for `POST /api/chat` (§14.6.6). */
export interface ChatRequestBody {
  messages: WireMessage[];
  /** Optional override; if absent the server uses `activeProfileId`. */
  profileId?: string;
}

/** Shape of a single OpenAI Chat Completions streaming chunk. */
export interface ChatCompletionChunk {
  id?: string;
  object?: string;
  choices?: Array<{
    index?: number;
    delta?: { role?: ChatRole; content?: string };
    finish_reason?: string | null;
  }>;
  error?: { type: string; message: string; status?: number };
}
