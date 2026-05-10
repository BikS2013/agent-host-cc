/**
 * SSE consumer for `POST /api/chat`.
 *
 * Why hand-rolled and not `EventSource`? The browser's `EventSource`
 * API is GET-only — it cannot send a request body. Our chat relay
 * needs a JSON body containing the conversation history, so we use
 * `fetch` + `ReadableStream` instead, with a small line-buffered
 * SSE parser. See `docs/design/project-design.md` §14.9 for the
 * rationale and the canonical parser pseudocode.
 *
 * SSE wire format being consumed (verbatim relay of upstream OpenAI
 * Chat Completions stream — §14.6.6, §14.7):
 *
 *   data: {"id":"…","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n
 *   data: {"id":"…","choices":[{"index":0,"delta":{"content":"He"}}]}\n\n
 *   data: {"id":"…","choices":[{"index":0,"delta":{"content":"llo"}}]}\n\n
 *   data: {"id":"…","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n
 *   data: [DONE]\n\n
 *
 * Mid-stream errors arrive as a synthesized error chunk:
 *
 *   data: {"error":{"type":"upstream_error","status":401,"message":"…"}}\n\n
 *   data: [DONE]\n\n
 */

import {
  ApiError,
  type ChatCompletionChunk,
  type ChatRequestBody,
  type ServerErrorEnvelope,
} from "./types";

export interface StreamChatCallbacks {
  /** Called for every non-empty content delta. */
  onDelta: (delta: string) => void;
  /** Called once when the stream terminates cleanly (sees `[DONE]`). */
  onDone: () => void;
  /** Called on any HTTP error or in-band SSE error chunk. */
  onError: (err: { type: string; message: string; status?: number }) => void;
  /** Aborts the in-flight request when triggered by the caller. */
  signal?: AbortSignal;
}

/**
 * Open a streaming chat session against `POST /api/chat`.
 *
 * Returns when either the stream terminates (`[DONE]` or upstream
 * close) or the caller's `AbortSignal` fires. Resolves to `void`;
 * all output flows through the callbacks.
 */
export async function streamChat(
  body: ChatRequestBody,
  callbacks: StreamChatCallbacks,
): Promise<void> {
  const { onDelta, onDone, onError, signal } = callbacks;

  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // Network failure or AbortError before any response was received.
    if (err instanceof DOMException && err.name === "AbortError") {
      // Caller-initiated cancellation: resolve quietly.
      return;
    }
    onError({
      type: "network_error",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Non-2xx before the SSE stream begins: parse the standard JSON
  // envelope and surface as an `ApiError`-shaped error.
  if (!res.ok) {
    let envelope: ServerErrorEnvelope | undefined;
    try {
      envelope = (await res.json()) as ServerErrorEnvelope;
    } catch {
      /* ignore — fall back to status-based message */
    }
    onError({
      type: envelope?.error.type ?? "http_error",
      message:
        envelope?.error.message ??
        `HTTP ${res.status} ${res.statusText}`,
      status: res.status,
    });
    return;
  }

  if (!res.body) {
    onError({
      type: "stream_error",
      message: "Response has no body; cannot stream",
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  try {
    // Read until upstream closes or we see `[DONE]`. Frames are
    // delimited by a blank line ("\n\n"). A single frame may contain
    // multiple `data:` lines (per the SSE spec) which the spec says
    // to concatenate with newlines.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        // Skip keep-alive comments (lines starting with ':') and
        // assemble the data payload.
        const dataLines: string[] = [];
        let isErrorEvent = false;
        for (const rawLine of frame.split("\n")) {
          const line = rawLine.replace(/\r$/, "");
          if (line.length === 0 || line.startsWith(":")) continue;
          if (line.startsWith("event:")) {
            // The relay does not currently emit named events, but if
            // it ever does, treat `event: error` as a hard error.
            if (line.slice("event:".length).trim() === "error") {
              isErrorEvent = true;
            }
            continue;
          }
          if (line.startsWith("data:")) {
            // Strip a single leading space if present (per SSE spec).
            const v = line.slice(5);
            dataLines.push(v.startsWith(" ") ? v.slice(1) : v);
          }
        }
        if (dataLines.length === 0) continue;
        const payload = dataLines.join("\n");

        if (payload === "[DONE]") {
          onDone();
          return;
        }

        let chunk: ChatCompletionChunk;
        try {
          chunk = JSON.parse(payload) as ChatCompletionChunk;
        } catch {
          // Malformed frame: surface as an error so the user is not
          // left wondering why the stream silently stopped (FU-13).
          onError({
            type: "parse_error",
            message: `Could not parse SSE frame: ${payload.slice(0, 200)}`,
          });
          continue;
        }

        // In-band error chunk synthesised by the relay (§14.6.6).
        if (chunk.error) {
          onError({
            type: chunk.error.type ?? "upstream_error",
            message: chunk.error.message ?? "Unknown upstream error",
            status: chunk.error.status,
          });
          // Keep reading — the relay will follow with `[DONE]`.
          continue;
        }
        if (isErrorEvent) {
          onError({
            type: "upstream_error",
            message: payload.slice(0, 500),
          });
          continue;
        }

        // Normal token delta. The very first chunk often carries
        // `delta.role` only and no `content` — that is fine; we
        // simply skip it.
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          onDelta(delta);
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Caller-initiated cancellation: do not surface as error.
      return;
    }
    onError({
      type: "stream_error",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* lock already released */
    }
  }

  // Safety net: upstream closed the connection without ever emitting
  // a `[DONE]` sentinel. Treat as a clean end so the SPA finalises
  // the in-progress assistant bubble rather than leaving it hanging.
  onDone();
}

// Re-exported so callers can `import { ApiError } from "./sseClient"`
// without a second import for the shared error class.
export { ApiError };
