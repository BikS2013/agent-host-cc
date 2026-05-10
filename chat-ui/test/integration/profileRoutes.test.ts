// @vitest-environment node
//
// Integration tests for the /api/profiles* endpoints.
// Each test gets a fresh server (fresh temp profiles.json) via buildTestServer().
//
// Coverage:
//   GET  /api/profiles                       → 200, redacted apiKeys
//   POST /api/profiles (agent-host-cc)        → 201, returns redacted profile
//   POST /api/profiles (openai)               → 201
//   POST /api/profiles (azure-openai)         → 201
//   POST /api/profiles (invalid body)         → 422 with issues array
//   PUT  /api/profiles/:id (key="<redacted>") → 200, preserves existing key
//   PUT  /api/profiles/:id (new key)          → 200, overwrites key
//   DELETE /api/profiles/:id (non-active)     → 204, list shrinks
//   DELETE /api/profiles/:id (active, others) → 204, auto-activates another
//   DELETE /api/profiles/:id (only+active)    → 422 (cannot delete only profile)
//   POST /api/profiles/:id/activate           → 200, subsequent GET reflects it
//   GET  /api/profiles/:id?reveal=true (127)  → 200, raw apiKey returned
//   GET  /api/profiles/:id?reveal=true (non-loopback) → 422

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, sampleProfiles } from "./helpers/buildTestServer.js";

const REDACTED = "<redacted>";

// ─── shared state ────────────────────────────────────────────────────────────

let app: FastifyInstance;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const handle = await buildTestServer();
  app = handle.app;
  cleanup = handle.cleanup;
});

afterEach(async () => {
  await cleanup();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function createProfile(body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/profiles",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

// ─── GET /api/profiles ───────────────────────────────────────────────────────

describe("GET /api/profiles", () => {
  it("returns 200 with empty profiles list when no profiles exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ profiles: unknown[]; activeProfileId: unknown }>();
    expect(body.profiles).toEqual([]);
    expect(body.activeProfileId).toBeNull();
  });

  it("redacts apiKey with '<redacted>' sentinel in every listed profile", async () => {
    // Create one profile.
    await createProfile(sampleProfiles.agentHostCc);

    const res = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ profiles: Array<Record<string, unknown>> }>();
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]?.apiKey).toBe(REDACTED);
  });

  it("returns activeProfileId matching the first-created profile (auto-activated)", async () => {
    const createRes = await createProfile(sampleProfiles.agentHostCc);
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ id: string }>();

    const listRes = await app.inject({ method: "GET", url: "/api/profiles" });
    const listed = listRes.json<{ activeProfileId: string }>();
    expect(listed.activeProfileId).toBe(created.id);
  });
});

// ─── POST /api/profiles ──────────────────────────────────────────────────────

describe("POST /api/profiles", () => {
  it("creates an agent-host-cc profile → 201 with redacted apiKey", async () => {
    const res = await createProfile(sampleProfiles.agentHostCc);
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body.backendKind).toBe("agent-host-cc");
    expect(body.name).toBe(sampleProfiles.agentHostCc.name);
    expect(body.apiKey).toBe(REDACTED);
    expect(typeof body.id).toBe("string");
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("creates an openai profile → 201 with redacted apiKey", async () => {
    const res = await createProfile(sampleProfiles.openai);
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body.backendKind).toBe("openai");
    expect(body.apiKey).toBe(REDACTED);
  });

  it("creates an azure-openai profile → 201 with redacted apiKey", async () => {
    const res = await createProfile(sampleProfiles.azureOpenai);
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body.backendKind).toBe("azure-openai");
    expect(body.apiKey).toBe(REDACTED);
    expect(body.deployment).toBe(sampleProfiles.azureOpenai.deployment);
  });

  it("appears in subsequent GET /api/profiles list", async () => {
    await createProfile(sampleProfiles.openai);
    const listRes = await app.inject({ method: "GET", url: "/api/profiles" });
    const body = listRes.json<{ profiles: Array<{ name: string }> }>();
    expect(body.profiles.some((p) => p.name === sampleProfiles.openai.name)).toBe(true);
  });

  it("returns 422 when required field is missing (missing apiKey)", async () => {
    const badBody = { name: "bad-profile", backendKind: "openai", defaultModel: "gpt-4o" };
    const res = await createProfile(badBody);
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: { type: string; issues?: unknown[] } }>();
    expect(body.error.type).toBe("invalid_profile");
    // issues array should be present (Zod-shaped)
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect((body.error.issues as unknown[]).length).toBeGreaterThan(0);
  });

  it("returns 422 when backendKind is absent", async () => {
    const badBody = { name: "no-kind", apiKey: "k" };
    const res = await createProfile(badBody);
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: { type: string } }>();
    expect(body.error.type).toBe("invalid_profile");
  });

  it("returns 422 when azure-openai profile has invalid apiVersion format", async () => {
    const badAzure = {
      ...sampleProfiles.azureOpenai,
      apiVersion: "not-a-date",
      name: "bad-azure",
    };
    const res = await createProfile(badAzure);
    expect(res.statusCode).toBe(422);
  });

  it("returns 422 when trying to include `id` in the body (server-assigned)", async () => {
    const bodyWithId = { ...sampleProfiles.openai, id: "00000000-0000-0000-0000-000000000001" };
    const res = await createProfile(bodyWithId);
    expect(res.statusCode).toBe(422);
  });
});

// ─── PUT /api/profiles/:id ────────────────────────────────────────────────────

describe("PUT /api/profiles/:id", () => {
  it("updates name and preserves existing apiKey when sent '<redacted>'", async () => {
    // Create a profile.
    const createRes = await createProfile(sampleProfiles.agentHostCc);
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ id: string; name: string }>();
    const id = created.id;

    // PUT with apiKey = "<redacted>" — server must keep original key.
    const updateBody = {
      ...sampleProfiles.agentHostCc,
      id,
      name: "local-agent-renamed",
      apiKey: REDACTED,
    };
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/profiles/${id}`,
      headers: { "content-type": "application/json" },
      payload: updateBody,
    });
    expect(putRes.statusCode).toBe(200);
    const updated = putRes.json<{ name: string; apiKey: string }>();
    expect(updated.name).toBe("local-agent-renamed");
    // The returned value should still be redacted on the wire.
    expect(updated.apiKey).toBe(REDACTED);

    // Reveal the raw key via localhost reveal endpoint to confirm it was preserved.
    const revealRes = await app.inject({
      method: "GET",
      url: `/api/profiles/${id}?reveal=true`,
      remoteAddress: "127.0.0.1",
    });
    expect(revealRes.statusCode).toBe(200);
    const rawProfile = revealRes.json<{ apiKey: string }>();
    // The original key must be intact (not replaced with "<redacted>").
    expect(rawProfile.apiKey).toBe(sampleProfiles.agentHostCc.apiKey);
  });

  it("overwrites apiKey when a new (non-redacted) key is provided", async () => {
    const createRes = await createProfile(sampleProfiles.agentHostCc);
    const id = createRes.json<{ id: string }>().id;
    const NEW_KEY = "new-api-key-9999";

    const putRes = await app.inject({
      method: "PUT",
      url: `/api/profiles/${id}`,
      headers: { "content-type": "application/json" },
      payload: { ...sampleProfiles.agentHostCc, id, apiKey: NEW_KEY },
    });
    expect(putRes.statusCode).toBe(200);

    const revealRes = await app.inject({
      method: "GET",
      url: `/api/profiles/${id}?reveal=true`,
      remoteAddress: "127.0.0.1",
    });
    const rawProfile = revealRes.json<{ apiKey: string }>();
    expect(rawProfile.apiKey).toBe(NEW_KEY);
  });

  it("returns 404 when updating a non-existent profile id", async () => {
    // Use a properly-formatted v4 UUID that simply doesn't exist in the store.
    const nonExistentId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/profiles/${nonExistentId}`,
      headers: { "content-type": "application/json" },
      payload: { ...sampleProfiles.openai, id: nonExistentId },
    });
    expect(putRes.statusCode).toBe(404);
  });
});

// ─── DELETE /api/profiles/:id ─────────────────────────────────────────────────

describe("DELETE /api/profiles/:id", () => {
  it("deletes a non-active profile → 204, list shrinks", async () => {
    // Create two profiles.
    const r1 = await createProfile(sampleProfiles.agentHostCc);
    const id1 = r1.json<{ id: string }>().id;
    const r2 = await createProfile(sampleProfiles.openai);
    const id2 = r2.json<{ id: string }>().id;

    // Activate profile 1 explicitly so profile 2 is non-active.
    await app.inject({
      method: "POST",
      url: `/api/profiles/${id1}/activate`,
    });

    // Delete non-active profile 2.
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/profiles/${id2}`,
    });
    expect(delRes.statusCode).toBe(204);

    // List should now have only profile 1.
    const listRes = await app.inject({ method: "GET", url: "/api/profiles" });
    const body = listRes.json<{ profiles: Array<{ id: string }> }>();
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]?.id).toBe(id1);
  });

  it("deletes the active profile when other profiles exist → auto-activates another", async () => {
    const r1 = await createProfile(sampleProfiles.agentHostCc);
    const id1 = r1.json<{ id: string }>().id;
    const r2 = await createProfile(sampleProfiles.openai);
    const id2 = r2.json<{ id: string }>().id;

    // Activate profile 1 (first created, already auto-activated).
    const listBefore = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(listBefore.json<{ activeProfileId: string }>().activeProfileId).toBe(id1);

    // Delete the active profile.
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/profiles/${id1}`,
    });
    expect(delRes.statusCode).toBe(204);

    // Profile 2 should now be active.
    const listAfter = await app.inject({ method: "GET", url: "/api/profiles" });
    const afterBody = listAfter.json<{ activeProfileId: string; profiles: unknown[] }>();
    expect(afterBody.profiles).toHaveLength(1);
    expect(afterBody.activeProfileId).toBe(id2);
  });

  it("returns 422 when trying to delete the only profile while it is active", async () => {
    const r1 = await createProfile(sampleProfiles.agentHostCc);
    const id1 = r1.json<{ id: string }>().id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/profiles/${id1}`,
    });
    // The store throws ValidationError (HTTP 422) per §14.6.4 design.
    expect(delRes.statusCode).toBe(422);
    const body = delRes.json<{ error: { type: string; message: string } }>();
    expect(body.error.type).toBe("invalid_profile");
    expect(body.error.message).toMatch(/only profile/i);
  });

  it("returns 404 when deleting a non-existent profile id", async () => {
    const delRes = await app.inject({
      method: "DELETE",
      url: "/api/profiles/00000000-0000-0000-0000-000000000099",
    });
    expect(delRes.statusCode).toBe(404);
  });
});

// ─── POST /api/profiles/:id/activate ─────────────────────────────────────────

describe("POST /api/profiles/:id/activate", () => {
  it("sets the active profile and subsequent GET reflects the change", async () => {
    const r1 = await createProfile(sampleProfiles.agentHostCc);
    const id1 = r1.json<{ id: string }>().id;
    const r2 = await createProfile(sampleProfiles.openai);
    const id2 = r2.json<{ id: string }>().id;

    // profile 1 is auto-activated; activate profile 2.
    const actRes = await app.inject({
      method: "POST",
      url: `/api/profiles/${id2}/activate`,
    });
    expect(actRes.statusCode).toBe(200);
    const actBody = actRes.json<{ activeProfileId: string }>();
    expect(actBody.activeProfileId).toBe(id2);

    // GET /api/profiles confirms the new active id.
    const listRes = await app.inject({ method: "GET", url: "/api/profiles" });
    const listBody = listRes.json<{ activeProfileId: string }>();
    expect(listBody.activeProfileId).toBe(id2);
  });

  it("returns 404 when activating a non-existent profile id", async () => {
    const actRes = await app.inject({
      method: "POST",
      url: "/api/profiles/00000000-0000-0000-0000-000000000099/activate",
    });
    expect(actRes.statusCode).toBe(404);
  });
});

// ─── GET /api/profiles/:id?reveal=true ───────────────────────────────────────

describe("GET /api/profiles/:id?reveal=true", () => {
  it("returns the raw apiKey when called from 127.0.0.1", async () => {
    const createRes = await createProfile(sampleProfiles.agentHostCc);
    const id = createRes.json<{ id: string }>().id;

    const revealRes = await app.inject({
      method: "GET",
      url: `/api/profiles/${id}?reveal=true`,
      remoteAddress: "127.0.0.1",
    });
    expect(revealRes.statusCode).toBe(200);
    const body = revealRes.json<{ apiKey: string }>();
    expect(body.apiKey).toBe(sampleProfiles.agentHostCc.apiKey);
    // Must NOT be the sentinel.
    expect(body.apiKey).not.toBe(REDACTED);
  });

  it("returns the raw apiKey when called from ::1 (IPv6 loopback)", async () => {
    const createRes = await createProfile(sampleProfiles.agentHostCc);
    const id = createRes.json<{ id: string }>().id;

    const revealRes = await app.inject({
      method: "GET",
      url: `/api/profiles/${id}?reveal=true`,
      remoteAddress: "::1",
    });
    expect(revealRes.statusCode).toBe(200);
    const body = revealRes.json<{ apiKey: string }>();
    expect(body.apiKey).toBe(sampleProfiles.agentHostCc.apiKey);
  });

  it("returns 422 when called from a non-loopback address", async () => {
    const createRes = await createProfile(sampleProfiles.agentHostCc);
    const id = createRes.json<{ id: string }>().id;

    const revealRes = await app.inject({
      method: "GET",
      url: `/api/profiles/${id}?reveal=true`,
      remoteAddress: "10.0.0.1",
    });
    expect(revealRes.statusCode).toBe(422);
    const body = revealRes.json<{ error: { type: string } }>();
    expect(body.error.type).toBe("invalid_profile");
  });

  it("returns redacted profile when reveal=false (or absent)", async () => {
    const createRes = await createProfile(sampleProfiles.agentHostCc);
    const id = createRes.json<{ id: string }>().id;

    const noRevealRes = await app.inject({
      method: "GET",
      url: `/api/profiles/${id}`,
      remoteAddress: "127.0.0.1",
    });
    expect(noRevealRes.statusCode).toBe(200);
    const body = noRevealRes.json<{ apiKey: string }>();
    expect(body.apiKey).toBe(REDACTED);
  });

  it("returns 404 for a non-existent profile id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/profiles/00000000-0000-0000-0000-000000000099?reveal=true",
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(404);
  });
});
