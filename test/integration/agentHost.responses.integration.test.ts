import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const recordedUserMessages: unknown[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((args: { prompt: AsyncIterable<unknown> }) => (async function* () {
    for await (const m of args.prompt) recordedUserMessages.push(m);
    yield { type: "assistant", message: { content: [{ type: "text", text: "saw it" }] } };
    yield { type: "result", result: "" };
  })()),
}));

import { buildApp } from "../../src/httpServer.js";
import { createAttachmentProcessor } from "../../src/attachmentProcessor.js";
import { createWorkspaceManager } from "../../src/workspaceManager.js";
import { createClaudeCodeRunner } from "../../src/claudeCodeRunner.js";
import { startMockFilesApi } from "../fixtures/mockFilesApi.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ah-resp-"));
  recordedUserMessages.length = 0;
});

const buildHostApp = () => {
  const workspace = createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 });
  const ap = createAttachmentProcessor({
    workspace,
    filesApi: { baseUrl: "http://127.0.0.1:1", apiKey: "k", pathTemplate: "/api/v1/files/{id}/content", maxBytes: 1024, timeoutMs: 5000 },
    remote: { maxBytes: 1024, timeoutMs: 5000, maxFetchesPerTurn: 5 },
    maxInlineImageBytes: 1024,
  });
  const runner = createClaudeCodeRunner({
    provider: { kind: "anthropic-foundry", apiKey: "F", resource: "R" },
    maxTurns: 5, timeoutMs: 10_000,
  });
  return buildApp({
    apiKey: "k",
    modelIds: ["claude-opus-4-7"],
    modelPrefix: "cc.",
    workspaceDir: root,
    attachmentProcessor: ap,
    agentRunner: runner,
    responsesToolUseRendering: "text",
  });
};

describe("agent-host /v1/responses integration", () => {
  it("non-streaming string input → completed response with assistant text", async () => {
    const app = buildHostApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer k", "content-type": "application/json" },
      payload: {
        model: "cc.claude-opus-4-7",
        stream: false,
        metadata: { chat_id: "abc" },
        input: "hi there",
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.object).toBe("response");
    expect(body.status).toBe("completed");
    expect(body.output[0].role).toBe("assistant");
    expect(body.output[0].content[0].type).toBe("output_text");
    expect(body.output[0].content[0].text).toBe("saw it");

    // SDK saw a user message.
    expect(recordedUserMessages.length).toBeGreaterThan(0);
    const userMsg = recordedUserMessages[0] as { type: string; message: { role: string } };
    expect(userMsg.type).toBe("user");
    expect(userMsg.message.role).toBe("user");

    await app.close();
  });

  it("streaming smoke: emits canonical event sequence terminated by [DONE]", async () => {
    const app = buildHostApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer k", "content-type": "application/json" },
      payload: {
        model: "cc.claude-opus-4-7",
        stream: true,
        metadata: { chat_id: "abc-stream" },
        input: [
          { role: "user", content: [{ type: "input_text", text: "hello" }] },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/event-stream");
    const payload = r.payload;
    // Must contain the canonical events in order.
    const positions = [
      "event: response.created",
      "event: response.in_progress",
      "event: response.output_item.added",
      "event: response.content_part.added",
      "event: response.output_text.delta",
      "event: response.output_text.done",
      "event: response.content_part.done",
      "event: response.output_item.done",
      "event: response.completed",
    ].map(s => payload.indexOf(s));
    for (let i = 0; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
    expect(payload.endsWith("data: [DONE]\n\n")).toBe(true);
    // The delta carried the assistant text.
    expect(payload).toContain("\"delta\":\"saw it\"");
    await app.close();
  });

  it("input_image data URL is forwarded as image block to the SDK", async () => {
    const ow = await startMockFilesApi({});
    const workspace = createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 });
    const ap = createAttachmentProcessor({
      workspace,
      filesApi: { baseUrl: ow.url, apiKey: "k", pathTemplate: "/api/v1/files/{id}/content", maxBytes: 1024, timeoutMs: 5000 },
      remote: { maxBytes: 1024, timeoutMs: 5000, maxFetchesPerTurn: 5 },
      maxInlineImageBytes: 1024,
    });
    const runner = createClaudeCodeRunner({
      provider: { kind: "anthropic-foundry", apiKey: "F", resource: "R" },
      maxTurns: 5, timeoutMs: 10_000,
    });
    const app = buildApp({
      apiKey: "k",
      modelIds: ["claude-opus-4-7"],
      modelPrefix: "cc.",
      workspaceDir: root,
      attachmentProcessor: ap,
      agentRunner: runner,
      responsesToolUseRendering: "text",
    });

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const r = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer k", "content-type": "application/json" },
      payload: {
        model: "cc.claude-opus-4-7",
        stream: false,
        metadata: { chat_id: "img-resp" },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "what is this?" },
              { type: "input_image", image_url: `data:image/png;base64,${png}` },
            ],
          },
        ],
      },
    });
    expect(r.statusCode).toBe(200);

    expect(recordedUserMessages.length).toBeGreaterThan(0);
    const userMsg = recordedUserMessages[0] as {
      type: string;
      message: { role: string; content: Array<{ type: string }> };
    };
    expect(userMsg.type).toBe("user");
    expect(userMsg.message.role).toBe("user");
    expect(Array.isArray(userMsg.message.content)).toBe(true);
    expect(userMsg.message.content.some(c => c.type === "image")).toBe(true);

    await ow.close();
    await app.close();
  });

  it("rejects schema-invalid body with 422", async () => {
    const app = buildHostApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer k", "content-type": "application/json" },
      payload: { model: "cc.claude-opus-4-7" /* missing input */ },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.type).toBe("invalid_request");
    await app.close();
  });

  it("rejects unknown model with 404 / model_not_found", async () => {
    const app = buildHostApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { authorization: "Bearer k", "content-type": "application/json" },
      payload: { model: "cc.unknown", input: "hi", stream: false },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.type).toBe("model_not_found");
    await app.close();
  });

  it("missing bearer → 401", async () => {
    const app = buildHostApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: { "content-type": "application/json" },
      payload: { model: "cc.claude-opus-4-7", input: "hi" },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.type).toBe("unauthorized");
    await app.close();
  });
});
