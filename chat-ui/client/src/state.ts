/**
 * Global SPA state.
 *
 * Per the investigation (`docs/design/investigation-chat-ui.md`
 * recommendation 6) and the project design (§14.9):
 *
 *   - Each top-level state slice is its own `@preact/signals` signal.
 *   - The in-progress assistant message exposes a NESTED signal for
 *     its content so per-token streaming updates only that one DOM
 *     node, never the whole transcript.
 *
 * This module is the contract that Coder C's components import from.
 * The named exports below (signals + actions) MUST NOT be renamed
 * without coordinated changes in `client/src/components/`.
 */

import { signal, type Signal } from "@preact/signals";

import * as api from "./lib/api";
import { streamChat } from "./lib/sseClient";
import {
  ApiError,
  type ChatRole,
  type CreateProfileInput,
  type Profile,
  type RedactedProfile,
  type UpdateProfileInput,
  type WireMessage,
} from "./lib/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Re-exported from `./lib/types` so components have a single import path. */
export type {
  Profile,
  RedactedProfile,
  CreateProfileInput,
  UpdateProfileInput,
  ChatRole,
};

/**
 * A message rendered in the transcript.
 *
 * The `content` is itself a Signal so streaming token deltas can
 * mutate just the in-progress bubble without re-rendering the whole
 * `messages` array. Switch-banner notices (FU-10) are stored as
 * `role: "system"` messages so they appear inline in transcript order
 * yet are easy for `Composer` to filter out before sending the next
 * request.
 */
export interface Message {
  id: string;
  role: ChatRole;
  content: Signal<string>;
}

/** Per the user-supplied contract — alias used throughout the SPA. */
export type ProfileSummary = RedactedProfile;

// ---------------------------------------------------------------------------
// Signals (each top-level slice is its own signal — investigation rec 6)
// ---------------------------------------------------------------------------

/** All known profiles, with `apiKey` always equal to the literal "<redacted>". */
export const profiles: Signal<ProfileSummary[]> = signal<ProfileSummary[]>([]);

/** Currently active profile id, or null if no profile is selected. */
export const activeProfileId: Signal<string | null> = signal<string | null>(
  null,
);

/** The transcript. Streaming deltas mutate the per-message `content` signal. */
export const messages: Signal<Message[]> = signal<Message[]>([]);

/** Id of the assistant message currently being streamed, or null. */
export const streamingMessageId: Signal<string | null> = signal<string | null>(
  null,
);

/** UI-displayable error string, or null if none. Cleared by user actions. */
export const lastError: Signal<string | null> = signal<string | null>(null);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a short, collision-resistant message id. We avoid pulling
 * in a UUID dependency just for this; `crypto.randomUUID()` is
 * available in every browser we target (Chrome/Edge/Firefox/Safari
 * recent versions) and in Node ≥ 22.
 */
function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Defensive fallback for exotic runtimes (test harness without
  // WebCrypto). Not cryptographically strong; only used for DOM keys.
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Look up a profile by id from the in-memory `profiles` signal.
 * Returns `undefined` if not found.
 */
function findProfile(id: string | null): ProfileSummary | undefined {
  if (id == null) return undefined;
  return profiles.value.find((p) => p.id === id);
}

/**
 * Build the wire-format message array for `POST /api/chat`. We strip
 * any switch-banner system rows before sending — those are UI-only
 * markers (FU-10 / OD-3). A switch-banner is recognised as a system
 * message whose content begins with "— switched to profile".
 */
function messagesForUpstream(): WireMessage[] {
  return messages.value
    .filter(
      (m) =>
        !(m.role === "system" && m.content.value.startsWith("— switched to profile")),
    )
    .map((m) => ({ role: m.role, content: m.content.value }));
}

/** Format an `ApiError` (or generic Error) as the user-facing string. */
function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.issues && err.issues.length > 0) {
      const detail = err.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return `${err.type}: ${err.message} (${detail})`;
    }
    return `${err.type}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Actions (the contract Coder C calls into)
// ---------------------------------------------------------------------------

/**
 * Load all profiles + the active id from the server. Called at
 * application startup (`main.tsx`) and after every CRUD mutation so
 * the local cache stays consistent with `profiles.json`.
 */
export async function loadProfiles(): Promise<void> {
  try {
    const list = await api.getProfiles();
    profiles.value = list.profiles;
    activeProfileId.value = list.activeProfileId;
    lastError.value = null;
  } catch (err) {
    lastError.value = formatError(err);
  }
}

/**
 * Switch the active profile.
 *
 * Per FU-10 / A-7, this MUST preserve the in-memory transcript so
 * the user can compare backends on identical context. We append a
 * non-blocking inline banner so later replies can be visually
 * correlated with the profile that produced them.
 */
export async function selectProfile(id: string): Promise<void> {
  try {
    const result = await api.activateProfile(id);
    activeProfileId.value = result.activeProfileId;
    const profile = findProfile(result.activeProfileId);
    const banner: Message = {
      id: newMessageId(),
      role: "system",
      content: signal(`— switched to profile "${profile?.name ?? id}" —`),
    };
    messages.value = [...messages.value, banner];
    lastError.value = null;
  } catch (err) {
    lastError.value = formatError(err);
  }
}

/** Clear the transcript ("new conversation" button, FU-14). */
export function clearTranscript(): void {
  messages.value = [];
  streamingMessageId.value = null;
  lastError.value = null;
}

/**
 * Append a token delta to the message identified by `messageId`.
 * Mutates the per-message nested signal so only that bubble re-renders.
 * If the message is not found (e.g. the user cleared the transcript
 * mid-stream), the delta is silently dropped.
 */
export function appendDelta(messageId: string, delta: string): void {
  const msg = messages.value.find((m) => m.id === messageId);
  if (!msg) return;
  msg.content.value = msg.content.value + delta;
}

/**
 * Send a user message and stream the assistant reply.
 *
 * Sequence:
 *   1. Append a `user` message with the supplied text.
 *   2. Create the assistant placeholder message (empty content
 *      signal) and mark it as the in-progress streaming target.
 *   3. Open the SSE stream against `POST /api/chat`, forwarding
 *      the full transcript (minus switch-banners). The active
 *      profile id is included explicitly so the server does not
 *      have to re-read the store.
 *   4. For each delta, mutate the assistant message's content
 *      signal in place.
 *   5. On `[DONE]` (or stream close), clear `streamingMessageId`.
 *   6. On any error, surface via `lastError` and finalise.
 *
 * The function does not throw; errors are reported through
 * `lastError`. Returns when the stream is fully consumed.
 */
export async function sendMessage(text: string): Promise<void> {
  const trimmed = text;
  if (trimmed.length === 0) return;
  if (activeProfileId.value == null) {
    lastError.value = "No active profile — create or activate one first.";
    return;
  }
  if (streamingMessageId.value != null) {
    lastError.value = "A response is already streaming; please wait.";
    return;
  }

  // Step 1: append user message.
  const userMsg: Message = {
    id: newMessageId(),
    role: "user",
    content: signal(trimmed),
  };
  // Step 2: create assistant placeholder.
  const assistantMsg: Message = {
    id: newMessageId(),
    role: "assistant",
    content: signal(""),
  };
  messages.value = [...messages.value, userMsg, assistantMsg];
  streamingMessageId.value = assistantMsg.id;
  lastError.value = null;

  // Step 3: open the SSE stream. The wire payload is built BEFORE
  // we appended the empty assistant placeholder is filtered out
  // automatically — see messagesForUpstream's content-based filter
  // (an empty assistant content survives, which is fine: the upstream
  // ignores trailing empty assistants per OpenAI spec). To be safe
  // we exclude the placeholder explicitly here.
  const wireMessages = messagesForUpstream().filter(
    (m) => !(m.role === "assistant" && m.content === ""),
  );

  await streamChat(
    {
      messages: wireMessages,
      profileId: activeProfileId.value,
    },
    {
      onDelta: (delta) => appendDelta(assistantMsg.id, delta),
      onDone: () => {
        streamingMessageId.value = null;
      },
      onError: (err) => {
        lastError.value = `${err.type}: ${err.message}`;
        // Surface the error inline in the assistant bubble too, so
        // users do not see a blank reply (FU-13).
        if (assistantMsg.content.value.length === 0) {
          assistantMsg.content.value = `[error: ${err.message}]`;
        }
        streamingMessageId.value = null;
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Profile CRUD wrappers
//
// Each one calls the corresponding `api.*` function and then refreshes
// the local cache via `loadProfiles()` so the UI sees the new state
// immediately. Errors are caught and surfaced through `lastError` —
// the function returns the new (or unchanged) profile on success and
// `null` on failure so callers (form handlers) can distinguish.
// ---------------------------------------------------------------------------

export async function createProfile(
  input: CreateProfileInput,
): Promise<RedactedProfile | null> {
  try {
    const created = await api.createProfile(input);
    await loadProfiles();
    return created;
  } catch (err) {
    lastError.value = formatError(err);
    return null;
  }
}

export async function updateProfile(
  id: string,
  input: UpdateProfileInput,
): Promise<RedactedProfile | null> {
  try {
    const updated = await api.updateProfile(id, input);
    await loadProfiles();
    return updated;
  } catch (err) {
    lastError.value = formatError(err);
    return null;
  }
}

export async function deleteProfile(id: string): Promise<boolean> {
  try {
    await api.deleteProfile(id);
    await loadProfiles();
    return true;
  } catch (err) {
    lastError.value = formatError(err);
    return false;
  }
}
