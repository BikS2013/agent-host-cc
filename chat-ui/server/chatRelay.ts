// SSE chat relay handler.
//
// Resolves the active profile, builds the upstream request, issues it via
// undici, and pipes the upstream SSE body byte-for-byte into reply.raw.
//
// Per docs/design/project-design.md §14.7:
//  - The relay does NOT parse the SSE; it forwards bytes verbatim. This
//    preserves the host service's tool-call markdown shim intact.
//  - Mid-stream upstream errors are translated into an in-band SSE error
//    chunk + [DONE] (see writeSseError).
//  - An AbortController tied to the client-disconnect event aborts the
//    upstream call when the user closes the browser tab.
//
// Mirrors the reply.raw / setHeader / write / end pattern used by
// src/httpServer.ts in the host service.

import { request as undiciRequest } from "undici";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ProfileStore } from "./profileStore.js";
import { buildUpstreamRequest, type ChatMessage } from "./requestBuilder.js";
import { ProfileNotFoundError, UpstreamError, ValidationError } from "./errors.js";

/** Request body for POST /api/chat. */
const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      }),
    )
    .min(1),
  profileId: z.string().uuid().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
});

export type ChatRequestBody = z.infer<typeof ChatRequestSchema>;

export interface ChatRelayDeps {
  store: ProfileStore;
}

/**
 * Resolve the profile: explicit profileId wins; else the store's active id.
 * Throws ProfileNotFoundError if neither resolves.
 */
const resolveProfileId = (deps: ChatRelayDeps, body: ChatRequestBody): string => {
  if (typeof body.profileId === "string" && body.profileId.length > 0) {
    return body.profileId;
  }
  const active = deps.store.getActiveProfileId();
  if (!active) {
    throw new ProfileNotFoundError(
      "(active)",
      "no active profile configured; create a profile and activate it first",
    );
  }
  return active;
};

/**
 * Write an in-band SSE error chunk + [DONE] sentinel to reply.raw.
 * Used for mid-stream upstream errors discovered AFTER headers were flushed.
 */
const writeSseError = (
  reply: FastifyReply,
  err: { type: string; status?: number; message: string },
): void => {
  const payload = JSON.stringify({ error: err });
  reply.raw.write(`data: ${payload}\n\n`);
  reply.raw.write("data: [DONE]\n\n");
};

/**
 * Handle POST /api/chat. Throws ChatUiError subclasses on validation /
 * resolution failures (handled by Fastify's error handler before headers
 * flush). After SSE headers have flushed, errors are translated to in-band
 * SSE error chunks instead.
 */
export async function handleChatRequest(
  deps: ChatRelayDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // 1. Validate body.
  const parsed = ChatRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ValidationError(
      "chat request body validation failed",
      parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })),
    );
  }
  const body = parsed.data;

  // 2. Resolve active profile (raw, with real apiKey).
  const profileId = resolveProfileId(deps, body);
  const profile = deps.store.getProfile(profileId);

  // 3. Build upstream request.
  const messages: ChatMessage[] = body.messages.map((m) => ({ role: m.role, content: m.content }));
  const upstream = buildUpstreamRequest(profile, {
    messages,
    stream: true,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
  });

  // 4. AbortController tied to client disconnect.
  //
  // We listen on the underlying TCP socket — NOT on `request.raw`. In Node 18+
  // an IncomingMessage emits 'close' as soon as its readable side completes
  // (i.e. once Fastify has finished parsing the JSON body), which would abort
  // the upstream call the instant we issued it. The socket's 'close' event
  // fires only on an actual client disconnect, which is what we want.
  const ac = new AbortController();
  const onClose = (): void => {
    if (!ac.signal.aborted) ac.abort();
  };
  const socket = request.raw.socket;
  if (socket) socket.on("close", onClose);
  const detachClose = (): void => {
    if (socket) socket.off("close", onClose);
  };

  // 5. Issue upstream call. If this throws BEFORE we set SSE headers, the
  //    Fastify error handler converts it to a JSON envelope. After headers
  //    are flushed, we write an in-band SSE error chunk instead.
  let upstreamResp: Awaited<ReturnType<typeof undiciRequest>>;
  try {
    upstreamResp = await undiciRequest(upstream.url, {
      method: "POST",
      headers: upstream.headers,
      body: upstream.body,
      signal: ac.signal,
    });
  } catch (err) {
    detachClose();
    const msg = err instanceof Error ? err.message : String(err);
    throw new UpstreamError(0, `failed to reach upstream: ${msg}`);
  }

  // 6. Branch on upstream status.
  if (upstreamResp.statusCode >= 400) {
    // Drain the body for diagnostic context, but cap the size so a giant
    // upstream error page doesn't blow up our reply.
    let bodyText = "";
    try {
      const buf = await upstreamResp.body.arrayBuffer();
      bodyText = Buffer.from(buf).toString("utf8").slice(0, 2048);
    } catch {
      // ignore
    } finally {
      detachClose();
    }
    throw new UpstreamError(
      upstreamResp.statusCode,
      `upstream returned ${upstreamResp.statusCode}`,
      bodyText,
    );
  }

  // 7. Set SSE headers on reply.raw and hijack so Fastify won't try to send
  //    its own body. Mirrors src/httpServer.ts:155–162.
  reply.hijack();
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  // Status line is implied; raw response will write 200 on first write.

  try {
    await pipeline(upstreamResp.body, reply.raw, { end: false });
  } catch (err) {
    // Mid-stream failure: emit an in-band SSE error chunk + [DONE].
    const msg = err instanceof Error ? err.message : String(err);
    try {
      writeSseError(reply, {
        type: "upstream_error",
        message: `mid-stream relay failure: ${msg}`,
      });
    } catch {
      // socket may already be gone
    }
  } finally {
    detachClose();
    try {
      reply.raw.end();
    } catch {
      // ignore
    }
  }
}
