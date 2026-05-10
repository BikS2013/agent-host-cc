import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/httpServer.js";

const APP = (overrides: Partial<Parameters<typeof buildApp>[0]> = {}) => buildApp({
  apiKey: "secret",
  modelIds: ["claude-opus-4-7", "claude-sonnet-4-6"],
  modelPrefix: "cc.",
  workspaceDir: "/tmp/ws",
  // unused for these tests:
  attachmentProcessor: { process: async () => ({ cleanedMessages: [], manifest: [] }) } as never,
  agentRunner: { run: async function*() { yield { type: "result", result: "" }; } } as never,
  ...overrides,
});

describe("httpServer simple endpoints", () => {
  it("GET /healthz returns 200 without auth", async () => {
    const app = APP();
    const r = await app.inject({ method: "GET", url: "/healthz" });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("GET /v1/models without bearer → 401", async () => {
    const app = APP();
    const r = await app.inject({ method: "GET", url: "/v1/models" });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.type).toBe("unauthorized");
    await app.close();
  });

  it("GET /v1/models with bearer returns the configured list", async () => {
    const app = APP();
    const r = await app.inject({
      method: "GET", url: "/v1/models",
      headers: { authorization: "Bearer secret" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.map((m: { id: string }) => m.id))
      .toEqual(["claude-opus-4-7", "claude-sonnet-4-6"]);
    await app.close();
  });
});

describe("POST /v1/chat/completions error envelopes", () => {
  it("rejects schema-invalid body with 422 / invalid_request", async () => {
    const app = APP();
    const r = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      payload: { model: "x", messages: [] },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.type).toBe("invalid_request");
    await app.close();
  });

  it("rejects unknown model with 404 / model_not_found", async () => {
    const app = APP();
    const r = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      payload: { model: "cc.unknown", messages: [{ role: "user", content: "hi" }] },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.type).toBe("model_not_found");
    await app.close();
  });

  it("non-streaming returns aggregated assistant content (default cc. prefix strip)", async () => {
    const app = buildApp({
      apiKey: "secret",
      modelIds: ["claude-opus-4-7"],
      modelPrefix: "cc.",
      workspaceDir: "/tmp/ws",
      attachmentProcessor: { process: async (i: unknown) => ({ cleanedMessages: (i as { messages: unknown[] }).messages, manifest: [] }) } as never,
      agentRunner: { run: async function*() {
        yield { type: "assistant", message: { content: [{ type: "text", text: "hi back" }] } };
        yield { type: "result", result: "ok" };
      } } as never,
    });
    const r = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      payload: { model: "cc.claude-opus-4-7", messages: [{ role: "user", content: "hi" }], stream: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().choices[0].message.content).toBe("hi back");
    await app.close();
  });
});

describe("MODEL_PREFIX configurability", () => {
  const aggApp = (modelPrefix: string) => buildApp({
    apiKey: "secret",
    modelIds: ["claude-opus-4-7"],
    modelPrefix,
    workspaceDir: "/tmp/ws",
    attachmentProcessor: { process: async (i: unknown) => ({ cleanedMessages: (i as { messages: unknown[] }).messages, manifest: [] }) } as never,
    agentRunner: { run: async function*() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
      yield { type: "result", result: "ok" };
    } } as never,
  });

  it("custom prefix 'claude.' strips claude.<model>", async () => {
    const app = aggApp("claude.");
    const r = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      payload: { model: "claude.claude-opus-4-7", messages: [{ role: "user", content: "hi" }], stream: false },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("empty prefix disables stripping (model must match verbatim)", async () => {
    const app = aggApp("");
    const ok = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      payload: { model: "claude-opus-4-7", messages: [{ role: "user", content: "hi" }], stream: false },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      payload: { model: "cc.claude-opus-4-7", messages: [{ role: "user", content: "hi" }], stream: false },
    });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().error.type).toBe("model_not_found");
    await app.close();
  });
});
