import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeCodeRunner } from "../../src/claudeCodeRunner.js";
import { AgentTimeoutError } from "../../src/errors.js";
import type { Provider } from "../../src/types.js";

const FOUNDRY_PROVIDER: Provider = { kind: "anthropic-foundry", apiKey: "F", resource: "R" };
const PUBLIC_PROVIDER: Provider = { kind: "anthropic-public", apiKey: "AK" };

describe("claudeCodeRunner", () => {
  let originalMarker: string | undefined;
  beforeEach(() => {
    originalMarker = process.env.AGENT_HOST_TEST_MARKER;
  });
  afterEach(() => {
    if (originalMarker === undefined) delete process.env.AGENT_HOST_TEST_MARKER;
    else process.env.AGENT_HOST_TEST_MARKER = originalMarker;
  });

  it("invokes SDK with cleanedMessages and Foundry env when provider is anthropic-foundry", async () => {
    (sdkQuery as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue((async function*() { yield { type: "result", result: "ok" }; })());

    process.env.AGENT_HOST_TEST_MARKER = "marker-value";

    const runner = createClaudeCodeRunner({
      provider: FOUNDRY_PROVIDER, maxTurns: 5, timeoutMs: 5000,
    });
    const events: unknown[] = [];
    for await (const ev of runner.run({
      chatId: "abc", model: "claude-opus-4-7", cwd: "/tmp/abc",
      cleanedMessages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      manifest: [],
    })) events.push(ev);

    const call = (sdkQuery as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const opts = (call[0] as { options: { env: Record<string,string>; cwd: string; model: string } }).options;
    expect(opts.env.CLAUDE_CODE_USE_FOUNDRY).toBe("1");
    expect(opts.env.ANTHROPIC_FOUNDRY_API_KEY).toBe("F");
    expect(opts.env.ANTHROPIC_FOUNDRY_RESOURCE).toBe("R");
    // process.env must be spread first so unrelated parent vars survive.
    expect(opts.env.AGENT_HOST_TEST_MARKER).toBe("marker-value");
    expect(opts.cwd).toBe("/tmp/abc");
    expect(opts.model).toBe("claude-opus-4-7");
    expect(events.length).toBe(1);
  });

  it("invokes SDK with ANTHROPIC_API_KEY (and no Foundry vars) when provider is anthropic-public", async () => {
    (sdkQuery as unknown as { mockReturnValue: (v: unknown) => void; mockClear: () => void }).mockClear();
    (sdkQuery as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue((async function*() { yield { type: "result", result: "ok" }; })());

    process.env.AGENT_HOST_TEST_MARKER = "marker-public";

    const runner = createClaudeCodeRunner({
      provider: PUBLIC_PROVIDER, maxTurns: 5, timeoutMs: 5000,
    });
    for await (const _ of runner.run({
      chatId: "abc", model: "claude-opus-4-7", cwd: "/tmp/abc",
      cleanedMessages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      manifest: [],
    })) { /* drain */ }

    const calls = (sdkQuery as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const opts = (calls[calls.length - 1]![0] as { options: { env: Record<string,string> } }).options;
    expect(opts.env.ANTHROPIC_API_KEY).toBe("AK");
    expect(opts.env.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined();
    expect(opts.env.ANTHROPIC_FOUNDRY_API_KEY).toBeUndefined();
    expect(opts.env.ANTHROPIC_FOUNDRY_RESOURCE).toBeUndefined();
    expect(opts.env.AGENT_HOST_TEST_MARKER).toBe("marker-public");
  });

  it("times out and throws AgentTimeoutError if SDK never yields", async () => {
    (sdkQuery as unknown as { mockReturnValue: (v: unknown) => void })
      .mockReturnValue((async function*() {
        await new Promise(r => setTimeout(r, 200));
        yield { type: "result", result: "late" };
      })());
    const runner = createClaudeCodeRunner({
      provider: FOUNDRY_PROVIDER, maxTurns: 5, timeoutMs: 50,
    });
    await expect((async () => {
      for await (const _ of runner.run({
        chatId: "abc", model: "x", cwd: "/tmp/abc",
        cleanedMessages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        manifest: [],
      })) { /* drain */ }
    })()).rejects.toBeInstanceOf(AgentTimeoutError);
  });
});
