import { describe, expect, it } from "vitest";
import { aggregateResponsesNonStreaming } from "../../src/openAiResponseAdapter.js";
import { ConfigurationError } from "../../src/errors.js";

describe("aggregateResponsesNonStreaming", () => {
  it("returns a Responses JSON body with the full text and assistant role", async () => {
    async function* source() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } };
      yield { type: "assistant", message: { content: [{ type: "text", text: " world" }] } };
      yield { type: "result", result: "ok" };
    }
    const body = await aggregateResponsesNonStreaming(source(), {
      model: "claude-opus-4-7",
      toolUseRendering: "text",
      responseId: "resp_t",
      itemId: "msg_t",
      createdAt: 1_700_000_000,
    });
    expect(body.id).toBe("resp_t");
    expect(body.object).toBe("response");
    expect(body.status).toBe("completed");
    expect(body.created_at).toBe(1_700_000_000);
    expect(body.model).toBe("claude-opus-4-7");
    expect(body.output.length).toBe(1);
    const item = body.output[0]!;
    expect(item.type).toBe("message");
    expect(item.role).toBe("assistant");
    expect(item.status).toBe("completed");
    expect(item.content[0]!.type).toBe("output_text");
    expect(item.content[0]!.text).toBe("Hello world");
    expect(body.usage).toEqual({ input_tokens: 0, output_tokens: 0, total_tokens: 0 });
  });

  it("renders tool_use blocks via the same italic-markdown shim", async () => {
    async function* source() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "X" }] } };
      yield { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file: "a.txt" } }] } };
      yield { type: "result", result: "" };
    }
    const body = await aggregateResponsesNonStreaming(source(), {
      model: "m", toolUseRendering: "text",
    });
    expect(body.output[0]!.content[0]!.text).toMatch(/^X\n\n\*\[Read.*\]\*\n$/);
  });

  it("rejects toolUseRendering='item'", async () => {
    async function* source() { yield { type: "result", result: "" }; }
    await expect(
      aggregateResponsesNonStreaming(source(), { model: "m", toolUseRendering: "item" }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("propagates SDK-provided usage when present", async () => {
    async function* source() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
      yield { type: "result", result: "", usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } };
    }
    const body = await aggregateResponsesNonStreaming(source(), {
      model: "m", toolUseRendering: "text",
    });
    expect(body.usage).toEqual({ input_tokens: 12, output_tokens: 8, total_tokens: 20 });
  });
});
