import { describe, expect, it } from "vitest";
import { adaptToOpenAiSse } from "../../src/openAiChatSseAdapter.js";

const collect = async (it: AsyncIterable<string>): Promise<string[]> => {
  const out: string[] = []; for await (const s of it) out.push(s); return out;
};

describe("adaptToOpenAiSse", () => {
  it("emits delta chunks for assistant text and a final stop chunk + [DONE]", async () => {
    async function* events() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } };
      yield { type: "assistant", message: { content: [{ type: "text", text: " world" }] } };
      yield { type: "result", result: "ok" };
    }
    const chunks = await collect(adaptToOpenAiSse(events(), { id: "x", model: "m", created: 1 }));
    const joined = chunks.join("");
    expect(joined).toContain('"delta":{"content":"Hello"}');
    expect(joined).toContain('"delta":{"content":" world"}');
    expect(joined).toContain('"finish_reason":"stop"');
    expect(chunks.at(-1)).toBe("data: [DONE]\n\n");
  });
  it("renders tool_use as italic markdown", async () => {
    async function* events() {
      yield { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file: "a" } }] } };
      yield { type: "result", result: "ok" };
    }
    const out = (await collect(adaptToOpenAiSse(events(), { id: "x", model: "m", created: 1 }))).join("");
    expect(out).toMatch(/\*\[Read.*\]\*/);
  });
  it("on mid-stream error → emits error chunk then [DONE]", async () => {
    async function* events() { yield { type: "assistant", message: { content: [{ type: "text", text: "A" }] } }; throw new Error("boom"); }
    const chunks = await collect(adaptToOpenAiSse(events(), { id: "x", model: "m", created: 1 }));
    expect(chunks.some(c => c.includes("\"error\""))).toBe(true);
    expect(chunks.at(-1)).toBe("data: [DONE]\n\n");
  });
});
