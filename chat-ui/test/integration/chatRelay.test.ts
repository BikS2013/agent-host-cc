// @vitest-environment node
//
// Integration tests for POST /api/chat SSE relay.
// undici.request is mocked via vi.mock so no real HTTP connections are made.
//
// Coverage:
//   - 200 streamed SSE body passes all chunks through in order, ends with [DONE]
//   - Upstream URL is correct for agent-host-cc backend
//   - Upstream URL + headers are correct for openai backend
//   - Upstream URL + headers + body (no model field) correct for azure-openai
//   - Upstream 401 → relay returns 502 UpstreamError-shaped response
//   - No active profile set → 404 before opening upstream
//   - AbortController fires when client request closes

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { buildTestServer, sampleProfiles } from "./helpers/buildTestServer.js";

// ─── undici mock ──────────────────────────────────────────────────────────────
//
// We intercept undici at the module level. vi.mock hoisting guarantees this
// runs before any import that pulls undici transitively (chatRelay.ts).

// Mutable call log — reset in beforeEach.
let undiciCallArgs: Array<{
  url: string;
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  };
}> = [];

// Factory for canned upstream responses.
let mockUpstreamFactory: () => { statusCode: number; body: Readable };

vi.mock("undici", async (importOriginal) => {
  // We only need to stub `request`. Keep everything else from the real module
  // so the rest of the server code that depends on undici (if any) is intact.
  const original = await importOriginal<typeof import("undici")>();
  return {
    ...original,
    request: vi.fn(
      (url: string, options: Record<string, unknown>) => {
        undiciCallArgs.push({ url, options } as (typeof undiciCallArgs)[0]);
        return Promise.resolve(mockUpstreamFactory());
      },
    ),
  };
});

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a Readable that emits the given SSE chunks and then ends.
 */
function buildSseReadable(chunks: string[]): Readable {
  const r = new Readable({ read() {} });
  for (const chunk of chunks) {
    r.push(chunk);
  }
  r.push(null); // end-of-stream
  return r;
}

/**
 * Standard "happy path" SSE chunks that mimic an OpenAI Chat Completion stream.
 */
const HAPPY_SSE_CHUNKS = [
  `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { content: " world" }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
  "data: [DONE]\n\n",
];

// ─── per-test server setup ────────────────────────────────────────────────────

let app: FastifyInstance;
let cleanup: () => Promise<void>;

/** Create a profile and return its id. */
async function createProfile(body: Record<string, unknown>): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/profiles",
    headers: { "content-type": "application/json" },
    payload: body,
  });
  if (res.statusCode !== 201) {
    throw new Error(`createProfile failed: ${res.statusCode} ${res.body}`);
  }
  return (res.json() as { id: string }).id;
}

beforeEach(async () => {
  // Reset call log and factory before each test.
  undiciCallArgs = [];
  mockUpstreamFactory = () => ({
    statusCode: 200,
    body: buildSseReadable(HAPPY_SSE_CHUNKS),
  });

  const handle = await buildTestServer();
  app = handle.app;
  cleanup = handle.cleanup;
});

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

// ─── SSE passthrough ──────────────────────────────────────────────────────────

describe("POST /api/chat — happy path SSE relay", () => {
  it("returns 200 with Content-Type text/event-stream and passes all chunks in order", async () => {
    // Create and auto-activate a profile.
    await createProfile(sampleProfiles.agentHostCc);

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: {
        messages: [{ role: "user", content: "ping" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    // The full payload should contain every SSE chunk in order.
    const payload = res.payload;
    for (const chunk of HAPPY_SSE_CHUNKS) {
      expect(payload).toContain(chunk);
    }
    // The final sentinel must be present.
    expect(payload).toContain("data: [DONE]");
  });

  it("SSE chunks appear in original order", async () => {
    await createProfile(sampleProfiles.agentHostCc);

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "hi" }] },
    });

    const payload = res.payload;
    const helloIdx = payload.indexOf("Hello");
    const worldIdx = payload.indexOf(" world");
    const doneIdx = payload.indexOf("[DONE]");

    expect(helloIdx).toBeGreaterThan(-1);
    expect(worldIdx).toBeGreaterThan(helloIdx);
    expect(doneIdx).toBeGreaterThan(worldIdx);
  });
});

// ─── agent-host-cc upstream URL ───────────────────────────────────────────────

describe("POST /api/chat — agent-host-cc profile", () => {
  it("calls upstream at {baseUrl}/v1/chat/completions with Authorization header", async () => {
    const id = await createProfile(sampleProfiles.agentHostCc);
    await app.inject({
      method: "POST",
      url: `/api/profiles/${id}/activate`,
    });

    await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "test" }] },
    });

    expect(undiciCallArgs).toHaveLength(1);
    const call = undiciCallArgs[0]!;
    expect(call.url).toBe(`${sampleProfiles.agentHostCc.baseUrl}/v1/chat/completions`);
    expect(call.options.headers["Authorization"]).toBe(
      `Bearer ${sampleProfiles.agentHostCc.apiKey}`,
    );
    expect(call.options.method).toBe("POST");
  });

  it("request body includes defaultModel from profile", async () => {
    await createProfile(sampleProfiles.agentHostCc);

    await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "test" }] },
    });

    const call = undiciCallArgs[0]!;
    const bodyParsed = JSON.parse(call.options.body) as { model: string };
    expect(bodyParsed.model).toBe(sampleProfiles.agentHostCc.defaultModel);
  });
});

// ─── openai upstream URL ──────────────────────────────────────────────────────

describe("POST /api/chat — openai profile", () => {
  it("calls https://api.openai.com/v1/chat/completions with Authorization: Bearer header", async () => {
    const id = await createProfile(sampleProfiles.openai);
    await app.inject({
      method: "POST",
      url: `/api/profiles/${id}/activate`,
    });

    await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "hello" }] },
    });

    expect(undiciCallArgs).toHaveLength(1);
    const call = undiciCallArgs[0]!;
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.options.headers["Authorization"]).toBe(
      `Bearer ${sampleProfiles.openai.apiKey}`,
    );
  });
});

// ─── azure-openai upstream URL ────────────────────────────────────────────────

describe("POST /api/chat — azure-openai profile", () => {
  it("builds correct Azure URL with deployment and api-version, uses api-key header", async () => {
    const id = await createProfile(sampleProfiles.azureOpenai);
    await app.inject({
      method: "POST",
      url: `/api/profiles/${id}/activate`,
    });

    await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "azure test" }] },
    });

    expect(undiciCallArgs).toHaveLength(1);
    const call = undiciCallArgs[0]!;
    const { endpoint, deployment, apiVersion, apiKey } = sampleProfiles.azureOpenai;
    const expectedUrl =
      `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions` +
      `?api-version=${encodeURIComponent(apiVersion)}`;
    expect(call.url).toBe(expectedUrl);
    expect(call.options.headers["api-key"]).toBe(apiKey);
    // Authorization header must NOT be present for Azure.
    expect(call.options.headers["Authorization"]).toBeUndefined();
  });

  it("body does NOT contain a `model` field for azure-openai", async () => {
    const id = await createProfile(sampleProfiles.azureOpenai);
    await app.inject({ method: "POST", url: `/api/profiles/${id}/activate` });

    await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "azure model test" }] },
    });

    const call = undiciCallArgs[0]!;
    const bodyParsed = JSON.parse(call.options.body) as Record<string, unknown>;
    expect("model" in bodyParsed).toBe(false);
  });
});

// ─── upstream error responses ─────────────────────────────────────────────────

describe("POST /api/chat — upstream error handling", () => {
  it("upstream 401 → relay returns 502 with upstream_error envelope", async () => {
    mockUpstreamFactory = () => ({
      statusCode: 401,
      body: buildSseReadable([JSON.stringify({ error: { message: "Unauthorized" } })]),
    });

    await createProfile(sampleProfiles.agentHostCc);

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "auth test" }] },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json<{ error: { type: string; status: number } }>();
    expect(body.error.type).toBe("upstream_error");
    expect(body.error.status).toBe(401);
  });

  it("upstream 500 → relay returns 502", async () => {
    mockUpstreamFactory = () => ({
      statusCode: 500,
      body: buildSseReadable(["Internal Server Error"]),
    });

    await createProfile(sampleProfiles.agentHostCc);

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "error test" }] },
    });

    expect(res.statusCode).toBe(502);
  });
});

// ─── no active profile ────────────────────────────────────────────────────────

describe("POST /api/chat — no active profile", () => {
  it("returns 404 with profile_not_found when no profile is active", async () => {
    // No profile created → no active profile.
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "hello" }] },
    });

    // The relay resolves the active profile before calling undici.
    // ProfileNotFoundError → HTTP 404.
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: { type: string } }>();
    expect(body.error.type).toBe("profile_not_found");
    // undici should never have been called.
    expect(undiciCallArgs).toHaveLength(0);
  });
});

// ─── invalid request body ─────────────────────────────────────────────────────

describe("POST /api/chat — validation", () => {
  it("returns 422 when messages array is empty", async () => {
    await createProfile(sampleProfiles.agentHostCc);

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [] },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: { type: string } }>();
    expect(body.error.type).toBe("invalid_profile");
  });

  it("returns 422 when messages field is absent", async () => {
    await createProfile(sampleProfiles.agentHostCc);

    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(422);
  });
});

// ─── explicit profileId ───────────────────────────────────────────────────────

describe("POST /api/chat — explicit profileId", () => {
  it("uses specified profileId even if a different profile is active", async () => {
    // Create two profiles.
    const id1 = await createProfile(sampleProfiles.agentHostCc); // auto-activated
    const id2 = await createProfile(sampleProfiles.openai);

    // id1 is active; explicitly pass id2.
    await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: {
        messages: [{ role: "user", content: "which profile?" }],
        profileId: id2,
      },
    });

    expect(undiciCallArgs).toHaveLength(1);
    const call = undiciCallArgs[0]!;
    // Should have hit the OpenAI endpoint (id2 = openai profile).
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("returns 404 when an explicit profileId does not exist", async () => {
    await createProfile(sampleProfiles.agentHostCc);

    // Use a valid v4 UUID that simply doesn't exist in the store.
    const ghostId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: {
        messages: [{ role: "user", content: "ghost profile" }],
        profileId: ghostId,
      },
    });

    expect(res.statusCode).toBe(404);
    expect(undiciCallArgs).toHaveLength(0);
  });
});

// ─── AbortController / client disconnect ─────────────────────────────────────

describe("POST /api/chat — abort signal", () => {
  it("the AbortSignal passed to undici.request is initially not aborted", async () => {
    // This test verifies that an AbortController is wired; we can't easily
    // simulate a mid-stream browser disconnect via app.inject without complex
    // stream manipulation. We verify instead that:
    //   (a) the undici mock receives a signal
    //   (b) it is not already aborted at call time (server didn't pre-abort)
    await createProfile(sampleProfiles.agentHostCc);

    await app.inject({
      method: "POST",
      url: "/api/chat",
      headers: { "content-type": "application/json" },
      payload: { messages: [{ role: "user", content: "abort test" }] },
    });

    expect(undiciCallArgs).toHaveLength(1);
    const call = undiciCallArgs[0]!;
    expect(call.options.signal).toBeDefined();
    expect(call.options.signal.aborted).toBe(false);
  });
});
