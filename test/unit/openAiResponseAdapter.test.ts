import { describe, expect, it } from "vitest";
import { adaptToOpenAiResponseSse } from "../../src/openAiResponseAdapter.js";
import { ConfigurationError } from "../../src/errors.js";

const collect = async (it: AsyncIterable<string>): Promise<string[]> => {
  const out: string[] = []; for await (const s of it) out.push(s); return out;
};

interface ParsedEvent { event: string; data: Record<string, unknown>; }
const parseEvents = (chunks: string[]): { events: ParsedEvent[]; terminator: string | null } => {
  const events: ParsedEvent[] = [];
  let terminator: string | null = null;
  for (const c of chunks) {
    if (c === "data: [DONE]\n\n") { terminator = c; continue; }
    const lines = c.split("\n");
    const evLine = lines.find(l => l.startsWith("event: "));
    const dataLine = lines.find(l => l.startsWith("data: "));
    if (!evLine || !dataLine) continue;
    events.push({
      event: evLine.slice("event: ".length),
      data: JSON.parse(dataLine.slice("data: ".length)),
    });
  }
  return { events, terminator };
};

describe("adaptToOpenAiResponseSse", () => {
  it("emits the canonical event sequence for text-only output", async () => {
    async function* source() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } };
      yield { type: "assistant", message: { content: [{ type: "text", text: " world" }] } };
      yield { type: "result", result: "ok" };
    }
    const chunks = await collect(adaptToOpenAiResponseSse(source(), {
      model: "claude-opus-4-7",
      toolUseRendering: "text",
      responseId: "resp_test",
      itemId: "msg_test",
      createdAt: 1_700_000_000,
    }));
    const { events, terminator } = parseEvents(chunks);

    // First event must be response.created with status in_progress.
    expect(events[0]?.event).toBe("response.created");
    expect((events[0]?.data as { type: string }).type).toBe("response.created");
    const respCreated = events[0]?.data as { response: { status: string } };
    expect(respCreated.response.status).toBe("in_progress");

    // Strict canonical order:
    const evOrder = events.map(e => e.event);
    expect(evOrder.slice(0, 5)).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
    ]);
    // Last 4 events before terminator
    expect(evOrder.slice(-4)).toEqual([
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ]);

    // sequence_number is monotonic from 0.
    const seqs = events.map(e => (e.data as { sequence_number: number }).sequence_number);
    expect(seqs[0]).toBe(0);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe((seqs[i - 1] ?? -1) + 1);
    }

    // The two text deltas carry "Hello" and " world".
    const deltas = events.filter(e => e.event === "response.output_text.delta");
    expect(deltas.length).toBe(2);
    expect((deltas[0]?.data as { delta: string }).delta).toBe("Hello");
    expect((deltas[1]?.data as { delta: string }).delta).toBe(" world");

    // output_text.done aggregates the full text.
    const done = events.find(e => e.event === "response.output_text.done");
    expect((done?.data as { text: string }).text).toBe("Hello world");

    // response.completed has status completed and the populated output.
    const completed = events.find(e => e.event === "response.completed");
    const cdata = completed?.data as { response: { status: string; output: Array<{ content: Array<{ text: string }> }> } };
    expect(cdata.response.status).toBe("completed");
    expect(cdata.response.output[0]?.content[0]?.text).toBe("Hello world");

    // Terminator is the last thing on the wire.
    expect(terminator).toBe("data: [DONE]\n\n");
    expect(chunks.at(-1)).toBe("data: [DONE]\n\n");
  });

  it("renders tool_use blocks as italic-markdown deltas on the same item", async () => {
    async function* source() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "before" }] } };
      yield { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }] } };
      yield { type: "assistant", message: { content: [{ type: "text", text: "after" }] } };
      yield { type: "result", result: "ok" };
    }
    const chunks = await collect(adaptToOpenAiResponseSse(source(), {
      model: "m", toolUseRendering: "text", responseId: "resp_x", itemId: "msg_x", createdAt: 1,
    }));
    const { events } = parseEvents(chunks);
    const deltas = events.filter(e => e.event === "response.output_text.delta");
    expect(deltas.length).toBe(3);
    const toolDelta = (deltas[1]?.data as { delta: string; item_id: string }).delta;
    expect(toolDelta).toMatch(/\*\[Bash.*\]\*/);
    // Same item_id across all deltas.
    const itemIds = new Set(deltas.map(d => (d.data as { item_id: string }).item_id));
    expect(itemIds.size).toBe(1);
    expect(itemIds.has("msg_x")).toBe(true);
  });

  it("on mid-stream error → emits response.failed event before [DONE]", async () => {
    async function* source() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "A" }] } };
      throw new Error("boom");
    }
    const chunks = await collect(adaptToOpenAiResponseSse(source(), {
      model: "m", toolUseRendering: "text",
    }));
    const { events, terminator } = parseEvents(chunks);

    // Last event before the terminator is response.failed.
    expect(events.at(-1)?.event).toBe("response.failed");
    const failed = events.at(-1)?.data as {
      response: { status: string; error: { code: string; message: string } };
    };
    expect(failed.response.status).toBe("failed");
    expect(failed.response.error.code).toBe("agent_error");
    expect(failed.response.error.message).toBe("boom");

    // Terminator follows.
    expect(terminator).toBe("data: [DONE]\n\n");
    expect(chunks.at(-1)).toBe("data: [DONE]\n\n");

    // No response.completed was emitted.
    expect(events.some(e => e.event === "response.completed")).toBe(false);
  });

  it("rejects toolUseRendering='item' with ConfigurationError", async () => {
    async function* source() { yield { type: "result", result: "" }; }
    const it = adaptToOpenAiResponseSse(source(), { model: "m", toolUseRendering: "item" });
    await expect(async () => {
      for await (const _ of it) { /* drain */ void _; }
    }).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("each chunk is a valid SSE event with an event: line and a trailing blank line", async () => {
    async function* source() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "x" }] } };
      yield { type: "result", result: "" };
    }
    const chunks = await collect(adaptToOpenAiResponseSse(source(), {
      model: "m", toolUseRendering: "text",
    }));
    for (const c of chunks) {
      if (c === "data: [DONE]\n\n") continue;
      expect(c.startsWith("event: ")).toBe(true);
      expect(c.endsWith("\n\n")).toBe(true);
      expect(c).toMatch(/^event: response\.[a-z_.]+\ndata: \{.*\}\n\n$/s);
    }
  });
});
