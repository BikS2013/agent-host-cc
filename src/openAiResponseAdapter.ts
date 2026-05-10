// SPDX-License-Identifier: Apache-2.0
//
// OpenAI Responses API adapter (plan-003 / project-design.md §5.5).
//
// Consumes the same SDK assistant-message stream as `openAiChatSseAdapter`
// and emits the canonical Responses event sequence:
//
//   response.created
//   response.in_progress
//   response.output_item.added
//   response.content_part.added
//   response.output_text.delta   (× N)
//   response.output_text.done
//   response.content_part.done
//   response.output_item.done
//   response.completed
//   data: [DONE]\n\n
//
// On mid-stream error the adapter emits `response.failed` and then the
// `[DONE]` terminator (parallels Chat-adapter behaviour, see ADR / F-14).

import { randomUUID } from "node:crypto";
import { ConfigurationError } from "./errors.js";
import type {
  Message,
  ContentPart,
  ResponsesInputContentPart,
  ResponsesInputMessage,
  ResponsesRequest,
} from "./types.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ToolUseRendering = "text" | "item";

export interface ResponsesAdapterOptions {
  model: string;
  toolUseRendering: ToolUseRendering;
  /** Optional override for ids — primarily for deterministic tests. */
  responseId?: string;
  itemId?: string;
  /** Optional fixed `created_at` (unix seconds) — primarily for tests. */
  createdAt?: number;
}

interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface ResponseObject {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "in_progress" | "completed" | "failed";
  output: ResponseOutputItem[];
  usage?: ResponseUsage | null;
  error?: { code: string; message: string };
}

interface ResponseOutputTextPart {
  type: "output_text";
  text: string;
  annotations: unknown[];
}

interface ResponseOutputItem {
  id: string;
  object?: "message";
  type: "message";
  role: "assistant";
  status?: "in_progress" | "completed";
  content: ResponseOutputTextPart[];
}

export interface ResponsesAggregateBody extends ResponseObject {}

// ---------------------------------------------------------------------------
// SDK-shape narrowing (matches the Chat adapter contract)
// ---------------------------------------------------------------------------

interface AssistantBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}
interface AssistantMsg { type: "assistant"; message: { content: AssistantBlock[] }; }
interface ResultMsg {
  type: "result";
  result?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

const isAssistant = (e: unknown): e is AssistantMsg =>
  typeof e === "object" && e !== null && (e as { type?: unknown }).type === "assistant";
const isResult = (e: unknown): e is ResultMsg =>
  typeof e === "object" && e !== null && (e as { type?: unknown }).type === "result";

// ---------------------------------------------------------------------------
// SSE serialization
// ---------------------------------------------------------------------------

const sseEvent = (eventType: string, payload: unknown): string =>
  `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;

const SSE_DONE = "data: [DONE]\n\n";

// ---------------------------------------------------------------------------
// Tool-use rendering (Option 4A — italic-markdown shim, identical to Chat)
// ---------------------------------------------------------------------------

const renderToolUseText = (block: AssistantBlock): string => {
  const argHint = block.input ? `: ${JSON.stringify(block.input).slice(0, 80)}` : "";
  return `\n\n*[${block.name ?? "tool"}${argHint}]*\n`;
};

// ---------------------------------------------------------------------------
// Input translation: ResponsesRequest.input → internal Message[]
// ---------------------------------------------------------------------------

/**
 * Translate the Responses API `input` field into the same internal `Message[]`
 * shape the Chat-Completions adapter feeds to the runner. Subsequent stages
 * (attachmentProcessor, agentRunner) are oblivious to the surface origin.
 *
 *  - string `input` → single user message with text content.
 *  - array of `ResponsesInputMessage`:
 *      * `input_text`  → `{ type: "text", text }`.
 *      * `input_image` → `{ type: "image_url", image_url: { url } }` so that
 *        attachmentProcessor's data-URL/http branch handles it unchanged.
 */
export const translateResponsesInputToMessages = (
  input: ResponsesRequest["input"],
): Message[] => {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }
  return input.map((m: ResponsesInputMessage): Message => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    const parts: ContentPart[] = m.content.map((p: ResponsesInputContentPart): ContentPart => {
      if (p.type === "input_text") {
        return { type: "text", text: p.text };
      }
      // input_image
      const url = p.image_url;
      const part: ContentPart = {
        type: "image_url",
        image_url: p.detail !== undefined ? { url, detail: p.detail } : { url },
      };
      return part;
    });
    return { role: m.role, content: parts };
  });
};

// ---------------------------------------------------------------------------
// Streaming adapter
// ---------------------------------------------------------------------------

const newResponseId = (): string => `resp_${randomUUID().replace(/-/g, "")}`;
const newItemId = (): string => `msg_${randomUUID().replace(/-/g, "")}`;

const assertToolUseRenderingSupported = (mode: ToolUseRendering): void => {
  if (mode === "item") {
    throw new ConfigurationError(
      "RESPONSES_TOOL_USE_RENDERING",
      "RESPONSES_TOOL_USE_RENDERING=item is reserved for a future release; set to 'text'",
    );
  }
};

/**
 * Streaming Responses adapter. Yields fully-formed SSE event strings (each
 * already terminated with the SSE blank-line separator). On mid-stream error
 * yields a `response.failed` event before the `[DONE]` terminator.
 */
export async function* adaptToOpenAiResponseSse(
  source: AsyncIterable<unknown>,
  options: ResponsesAdapterOptions,
): AsyncIterable<string> {
  assertToolUseRenderingSupported(options.toolUseRendering);

  const responseId = options.responseId ?? newResponseId();
  const itemId = options.itemId ?? newItemId();
  const createdAt = options.createdAt ?? Math.floor(Date.now() / 1000);

  let sequence = 0;
  const nextSeq = (): number => sequence++;

  const baseResponse = (
    status: ResponseObject["status"],
    output: ResponseOutputItem[],
    usage: ResponseUsage | null,
  ): ResponseObject => ({
    id: responseId,
    object: "response",
    created_at: createdAt,
    model: options.model,
    status,
    output,
    usage,
  });

  // Emit `response.created`.
  yield sseEvent("response.created", {
    type: "response.created",
    sequence_number: nextSeq(),
    response: baseResponse("in_progress", [], null),
  });

  // Emit `response.in_progress`.
  yield sseEvent("response.in_progress", {
    type: "response.in_progress",
    sequence_number: nextSeq(),
    response: baseResponse("in_progress", [], null),
  });

  // Emit `response.output_item.added`.
  yield sseEvent("response.output_item.added", {
    type: "response.output_item.added",
    sequence_number: nextSeq(),
    output_index: 0,
    item: {
      id: itemId,
      object: "message",
      type: "message",
      role: "assistant",
      status: "in_progress",
      content: [],
    },
  });

  // Emit `response.content_part.added`.
  yield sseEvent("response.content_part.added", {
    type: "response.content_part.added",
    sequence_number: nextSeq(),
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });

  let accumulatedText = "";
  let usage: ResponseUsage | null = null;

  try {
    for await (const ev of source) {
      if (isAssistant(ev)) {
        for (const blk of ev.message.content) {
          let delta = "";
          if (blk.type === "text" && typeof blk.text === "string" && blk.text.length > 0) {
            delta = blk.text;
          } else if (blk.type === "tool_use") {
            // Option 4A — render as italic-markdown, on the same content part.
            delta = renderToolUseText(blk);
          }
          if (delta.length > 0) {
            accumulatedText += delta;
            yield sseEvent("response.output_text.delta", {
              type: "response.output_text.delta",
              sequence_number: nextSeq(),
              item_id: itemId,
              output_index: 0,
              content_index: 0,
              delta,
            });
          }
        }
      } else if (isResult(ev)) {
        // Pass-through usage when the SDK provides one.
        if (ev.usage && typeof ev.usage === "object") {
          const inT = Number(ev.usage.input_tokens ?? 0);
          const outT = Number(ev.usage.output_tokens ?? 0);
          const totT = Number(ev.usage.total_tokens ?? inT + outT);
          usage = { input_tokens: inT, output_tokens: outT, total_tokens: totT };
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield sseEvent("response.failed", {
      type: "response.failed",
      sequence_number: nextSeq(),
      response: {
        ...baseResponse("failed", [], null),
        error: { code: "agent_error", message },
      },
    });
    yield SSE_DONE;
    return;
  }

  // Emit `response.output_text.done`.
  yield sseEvent("response.output_text.done", {
    type: "response.output_text.done",
    sequence_number: nextSeq(),
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text: accumulatedText,
  });

  // Emit `response.content_part.done`.
  yield sseEvent("response.content_part.done", {
    type: "response.content_part.done",
    sequence_number: nextSeq(),
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: accumulatedText, annotations: [] },
  });

  const finalItem: ResponseOutputItem = {
    id: itemId,
    object: "message",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: accumulatedText, annotations: [] }],
  };

  // Emit `response.output_item.done`.
  yield sseEvent("response.output_item.done", {
    type: "response.output_item.done",
    sequence_number: nextSeq(),
    output_index: 0,
    item: finalItem,
  });

  // Emit `response.completed`.
  const finalUsage: ResponseUsage = usage ?? {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  yield sseEvent("response.completed", {
    type: "response.completed",
    sequence_number: nextSeq(),
    response: baseResponse("completed", [finalItem], finalUsage),
  });

  // Terminator.
  yield SSE_DONE;
}

// ---------------------------------------------------------------------------
// Non-streaming aggregator
// ---------------------------------------------------------------------------

/**
 * Drain the SDK source and return a single Responses-API JSON body matching
 * the shape of the `response.completed` event's `response` object.
 *
 * Single source of truth (ADR-3): the same underlying SDK shape feeds both
 * the streaming and non-streaming code paths. We deliberately don't replay
 * SSE strings here — instead we mirror the production aggregator behaviour
 * by walking the same source twice-removed (text accumulation only). The
 * resulting body is byte-identical to `response.completed.response`.
 */
export async function aggregateResponsesNonStreaming(
  source: AsyncIterable<unknown>,
  options: ResponsesAdapterOptions,
): Promise<ResponsesAggregateBody> {
  assertToolUseRenderingSupported(options.toolUseRendering);

  const responseId = options.responseId ?? newResponseId();
  const itemId = options.itemId ?? newItemId();
  const createdAt = options.createdAt ?? Math.floor(Date.now() / 1000);

  let accumulatedText = "";
  let usage: ResponseUsage | null = null;

  for await (const ev of source) {
    if (isAssistant(ev)) {
      for (const blk of ev.message.content) {
        if (blk.type === "text" && typeof blk.text === "string" && blk.text.length > 0) {
          accumulatedText += blk.text;
        } else if (blk.type === "tool_use") {
          accumulatedText += renderToolUseText(blk);
        }
      }
    } else if (isResult(ev)) {
      if (ev.usage && typeof ev.usage === "object") {
        const inT = Number(ev.usage.input_tokens ?? 0);
        const outT = Number(ev.usage.output_tokens ?? 0);
        const totT = Number(ev.usage.total_tokens ?? inT + outT);
        usage = { input_tokens: inT, output_tokens: outT, total_tokens: totT };
      }
    }
  }

  const finalItem: ResponseOutputItem = {
    id: itemId,
    object: "message",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: accumulatedText, annotations: [] }],
  };

  return {
    id: responseId,
    object: "response",
    created_at: createdAt,
    model: options.model,
    status: "completed",
    output: [finalItem],
    usage: usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
}
