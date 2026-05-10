export interface SseHeader { id: string; model: string; created: number; }

interface AssistantBlock { type: string; text?: string; name?: string; input?: unknown; }
interface AssistantMsg { type: "assistant"; message: { content: AssistantBlock[] }; }
interface ResultMsg { type: "result"; result: unknown; }

const isAssistant = (e: unknown): e is AssistantMsg =>
  typeof e === "object" && e !== null && (e as { type?: unknown }).type === "assistant";
const isResult = (e: unknown): e is ResultMsg =>
  typeof e === "object" && e !== null && (e as { type?: unknown }).type === "result";

const sseLine = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;

const deltaChunk = (h: SseHeader, content: string) => sseLine({
  id: h.id, object: "chat.completion.chunk", created: h.created, model: h.model,
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
});

const stopChunk = (h: SseHeader) => sseLine({
  id: h.id, object: "chat.completion.chunk", created: h.created, model: h.model,
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
});

const errorChunk = (h: SseHeader, type: string, message: string) => sseLine({
  id: h.id, object: "chat.completion.chunk", created: h.created, model: h.model,
  error: { type, message },
});

export async function* adaptToOpenAiSse(
  events: AsyncIterable<unknown>,
  header: SseHeader,
): AsyncIterable<string> {
  try {
    for await (const ev of events) {
      if (isAssistant(ev)) {
        for (const blk of ev.message.content) {
          if (blk.type === "text" && typeof blk.text === "string" && blk.text.length > 0) {
            yield deltaChunk(header, blk.text);
          } else if (blk.type === "tool_use") {
            const argHint = blk.input ? `: ${JSON.stringify(blk.input).slice(0, 80)}` : "";
            yield deltaChunk(header, `\n\n*[${blk.name ?? "tool"}${argHint}]*\n`);
          }
        }
      } else if (isResult(ev)) {
        // final assistant turn boundary
      }
    }
    yield stopChunk(header);
  } catch (err) {
    yield errorChunk(header, "agent_error", err instanceof Error ? err.message : String(err));
  } finally {
    yield "data: [DONE]\n\n";
  }
}
