/**
 * Typed REST client for the chat-ui Fastify backend.
 *
 * Each function maps 1:1 to one of the endpoints documented in
 * `docs/design/project-design.md` §14.6:
 *
 *   getProfiles       → GET    /api/profiles            §14.6.1
 *   createProfile     → POST   /api/profiles            §14.6.2
 *   updateProfile     → PUT    /api/profiles/:id        §14.6.3
 *   deleteProfile     → DELETE /api/profiles/:id        §14.6.4
 *   activateProfile   → POST   /api/profiles/:id/activate §14.6.5
 *
 * The streaming chat endpoint (`POST /api/chat`, §14.6.6) is handled
 * separately in `./sseClient.ts` because it needs SSE framing rather
 * than JSON parsing.
 *
 * On any non-2xx response, every function in this module throws an
 * `ApiError` (see `./types.ts`) carrying the HTTP status, the
 * server-provided `error.type`, and (when present) the
 * `ProfileValidationError.issues[]` array so the SPA can attach
 * inline messages to specific form fields.
 */

import {
  ApiError,
  type ChatRequestBody,
  type CreateProfileInput,
  type ProfilesListResponse,
  type RedactedProfile,
  type ServerErrorEnvelope,
  type UpdateProfileInput,
} from "./types";

/** Base path for all API routes. Vite dev server proxies `/api` → `:5174`. */
const API_BASE = "/api";

/**
 * Internal helper: parse a `fetch` Response, returning the JSON body
 * on success or throwing an `ApiError` on non-2xx.
 */
async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) {
    // 204 No Content → return undefined cast as T (caller knows).
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }
  // Try to parse the standard error envelope. If the body is not JSON
  // (e.g. an HTML error page from a misconfigured proxy), fall back to
  // the raw text.
  let envelope: ServerErrorEnvelope | undefined;
  let raw: unknown;
  try {
    raw = await res.json();
    if (raw && typeof raw === "object" && "error" in (raw as object)) {
      envelope = raw as ServerErrorEnvelope;
    }
  } catch {
    try {
      raw = await res.text();
    } catch {
      raw = undefined;
    }
  }
  throw new ApiError({
    status: res.status,
    type: envelope?.error.type ?? "http_error",
    message:
      envelope?.error.message ??
      (typeof raw === "string" && raw.length > 0
        ? raw
        : `HTTP ${res.status} ${res.statusText}`),
    issues: envelope?.error.issues,
    raw,
  });
}

/** GET /api/profiles — list all profiles plus the active id. (§14.6.1) */
export async function getProfiles(): Promise<ProfilesListResponse> {
  const res = await fetch(`${API_BASE}/profiles`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return parseJsonOrThrow<ProfilesListResponse>(res);
}

/**
 * POST /api/profiles — create a new profile.
 * The server assigns the `id` (UUID v4); the body must NOT include one.
 * (§14.6.2)
 */
export async function createProfile(
  input: CreateProfileInput,
): Promise<RedactedProfile> {
  const res = await fetch(`${API_BASE}/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<RedactedProfile>(res);
}

/**
 * PUT /api/profiles/:id — update an existing profile.
 *
 * The body MUST include the `id` field and it must equal the URL param.
 * Per §14.6.3, when `apiKey === "<redacted>"` or `apiKey === ""` the
 * server preserves the on-disk key; any other value rotates it.
 */
export async function updateProfile(
  id: string,
  input: UpdateProfileInput,
): Promise<RedactedProfile> {
  if (input.id !== id) {
    // Defensive: the server validates this, but failing fast in the
    // client avoids a useless round-trip.
    throw new ApiError({
      status: 400,
      type: "invalid_profile",
      message: `updateProfile: body.id (${input.id}) must equal URL id (${id})`,
    });
  }
  const res = await fetch(
    `${API_BASE}/profiles/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  return parseJsonOrThrow<RedactedProfile>(res);
}

/** DELETE /api/profiles/:id — delete a profile. Returns void on 204. (§14.6.4) */
export async function deleteProfile(id: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/profiles/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { Accept: "application/json" },
    },
  );
  await parseJsonOrThrow<void>(res);
}

/**
 * POST /api/profiles/:id/activate — set the active profile id.
 * Returns the new `{ activeProfileId }` shape. (§14.6.5)
 */
export async function activateProfile(
  id: string,
): Promise<{ activeProfileId: string }> {
  const res = await fetch(
    `${API_BASE}/profiles/${encodeURIComponent(id)}/activate`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );
  return parseJsonOrThrow<{ activeProfileId: string }>(res);
}

/**
 * Re-exported so component code can build `ChatRequestBody` instances
 * without re-importing from `./types`.
 */
export type { ChatRequestBody };
