import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Capture all messages yielded into the SDK's `prompt` async iterable.
// `vi.mock` factories are hoisted; we expose a module-level array via a
// dedicated mock module that the test can import after the mock is set up.
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
  root = mkdtempSync(join(tmpdir(), "ah-"));
  recordedUserMessages.length = 0;
});

describe("agent-host integration", () => {
  it("pasted image data URL is written to disk AND forwarded as image block to SDK", async () => {
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
    });

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const r = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer k", "content-type": "application/json" },
      payload: {
        model: "cc.claude-opus-4-7",
        stream: false,
        metadata: { chat_id: "abc" },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
          ],
        }],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().choices[0].message.content).toBe("saw it");

    // Verify the SDK received an image block in the user message.
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
});
