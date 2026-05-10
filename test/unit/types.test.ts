import { describe, expect, it } from "vitest";
import { ChatCompletionRequestSchema } from "../../src/types.js";

describe("ChatCompletionRequestSchema", () => {
  it("accepts a plain text message", () => {
    const r = ChatCompletionRequestSchema.parse({
      model: "cc.claude-opus-4-7",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.model).toBe("cc.claude-opus-4-7");
  });

  it("accepts multimodal content with image_url data URL", () => {
    const r = ChatCompletionRequestSchema.parse({
      model: "cc.claude-opus-4-7",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
        ],
      }],
    });
    expect(Array.isArray(r.messages[0].content)).toBe(true);
  });

  it("accepts files[] array", () => {
    const r = ChatCompletionRequestSchema.parse({
      model: "cc.claude-opus-4-7",
      messages: [{ role: "user", content: "x" }],
      files: [{ type: "file", id: "f-1", name: "a.zip" }],
    });
    expect(r.files?.[0].id).toBe("f-1");
  });

  it("accepts metadata.chat_id", () => {
    const r = ChatCompletionRequestSchema.parse({
      model: "x",
      messages: [{ role: "user", content: "x" }],
      metadata: { chat_id: "abc" },
    });
    expect(r.metadata?.chat_id).toBe("abc");
  });

  it("rejects an unknown content-part type", () => {
    expect(() =>
      ChatCompletionRequestSchema.parse({
        model: "x",
        messages: [{ role: "user", content: [{ type: "video_url", url: "x" }] }],
      }),
    ).toThrow();
  });

  it("rejects empty messages array", () => {
    expect(() =>
      ChatCompletionRequestSchema.parse({ model: "x", messages: [] }),
    ).toThrow();
  });
});
