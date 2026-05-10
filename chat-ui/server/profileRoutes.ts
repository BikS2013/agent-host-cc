// REST API routes for profile management. Six endpoints per
// docs/design/project-design.md §14.6:
//   GET    /api/profiles
//   POST   /api/profiles
//   PUT    /api/profiles/:id
//   DELETE /api/profiles/:id
//   POST   /api/profiles/:id/activate
//   GET    /api/profiles/:id?reveal=true   (gated to localhost; returns raw key)
//
// Every other endpoint redacts apiKey with the literal "<redacted>" sentinel.
// PUT with apiKey === "<redacted>" or "" preserves the existing key.

import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CreateProfileInputSchema,
  ProfileSchema,
  REDACTED_API_KEY,
  redactProfile,
  type Profile,
} from "./profileSchema.js";
import type { ProfileStore } from "./profileStore.js";
import { ProfileNotFoundError, ValidationError } from "./errors.js";

export interface ProfileRoutesDeps {
  store: ProfileStore;
}

const isLocalhostIp = (ip: string | undefined): boolean =>
  ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

/** Strip apiKey from every profile in a list (returns new objects). */
const redactList = (profiles: Profile[]): Profile[] => profiles.map(redactProfile);

export async function registerProfileRoutes(
  app: FastifyInstance,
  deps: ProfileRoutesDeps,
): Promise<void> {
  const { store } = deps;

  // ----- GET /api/profiles ---------------------------------------------------
  app.get("/api/profiles", async () => {
    const file = store.readFile();
    return {
      activeProfileId: file.activeProfileId,
      profiles: redactList(file.profiles),
    };
  });

  // ----- GET /api/profiles/:id (?reveal=true gated to localhost) -------------
  app.get<{ Params: { id: string }; Querystring: { reveal?: string } }>(
    "/api/profiles/:id",
    async (request) => {
      const { id } = request.params;
      const reveal = request.query.reveal === "true";
      const profile = store.getProfile(id);
      if (reveal) {
        if (!isLocalhostIp(request.ip)) {
          throw new ValidationError("reveal endpoint is restricted to localhost");
        }
        return profile;
      }
      return redactProfile(profile);
    },
  );

  // ----- POST /api/profiles --------------------------------------------------
  app.post("/api/profiles", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    if (body && "id" in body) {
      throw new ValidationError("POST /api/profiles must not include `id` (server-assigned)");
    }
    const parsed = CreateProfileInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "profile body validation failed",
        parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })),
      );
    }
    const created = store.createProfile(parsed.data);
    reply.code(201);
    return redactProfile(created);
  });

  // ----- PUT /api/profiles/:id ----------------------------------------------
  app.put<{ Params: { id: string } }>("/api/profiles/:id", async (request) => {
    const { id } = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      throw new ValidationError("PUT body must be a JSON object");
    }

    // PUT-with-redacted-key semantics: if the inbound apiKey is the redaction
    // sentinel or an empty string, we KEEP the existing on-disk key. Otherwise
    // the new key replaces the old one.
    const inboundKey = (body as { apiKey?: unknown }).apiKey;
    let bodyForValidation: Record<string, unknown> = { ...body };
    if (inboundKey === REDACTED_API_KEY || inboundKey === "" || inboundKey === undefined) {
      try {
        const existing = store.getProfile(id);
        bodyForValidation = { ...body, apiKey: existing.apiKey };
      } catch (err) {
        if (err instanceof ProfileNotFoundError) throw err;
        throw err;
      }
    }

    // Ensure body.id matches URL id (or set it if absent).
    bodyForValidation["id"] = id;

    const parsed = ProfileSchema.safeParse(bodyForValidation);
    if (!parsed.success) {
      throw new ValidationError(
        "profile body validation failed",
        parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })),
      );
    }
    const updated = store.updateProfile(id, parsed.data);
    return redactProfile(updated);
  });

  // ----- DELETE /api/profiles/:id -------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    const { id } = request.params;
    store.deleteProfile(id);
    reply.code(204);
    return null;
  });

  // ----- POST /api/profiles/:id/activate ------------------------------------
  app.post<{ Params: { id: string } }>("/api/profiles/:id/activate", async (request) => {
    const { id } = request.params;
    store.setActiveProfileId(id);
    return { activeProfileId: id };
  });
}

// Exported for tests
export const _internal = { isLocalhostIp };
// Avoid unused-import warning in case downstream tooling complains
void (null as unknown as FastifyRequest);
