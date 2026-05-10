// Process entry for the chat-ui server.
//
// Wires together: config load → config-dir bootstrap → profile store →
// Fastify app (with @fastify/static for the SPA bundle and the SPA-fallback
// notFound handler) → profile routes → POST /api/chat → listen on 127.0.0.1.
//
// Topology B (single-port, npm run start) and Topology A's API half
// (Fastify on :5174 behind Vite proxy) both go through this entry point.
// In dev, set CHAT_UI_PORT=5174 (the dev:server script does this implicitly
// because the Vite proxy points at :5174 unconditionally).

import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  bootstrapConfigDir,
  loadServerConfig,
  type ServerConfig,
} from "./config.js";
import { createProfileStore } from "./profileStore.js";
import { registerProfileRoutes } from "./profileRoutes.js";
import { handleChatRequest } from "./chatRelay.js";
import { ChatUiError } from "./errors.js";

/** Resolve the SPA static directory relative to this server bundle. */
const resolveStaticDirAbs = (cfg: ServerConfig): string => {
  if (isAbsolute(cfg.staticDir)) return cfg.staticDir;
  // When compiled, this file lives at <project>/dist/server/index.js.
  // The SPA bundle is at <project>/dist/client/.
  // When running via tsx from <project>/server/index.ts, it's at
  // <project>/dist/client/ — same relative offset (../../dist/client from
  // server/, ../client from dist/server/). We compute both and use the one
  // that exists.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "client"), // compiled: dist/server -> dist/client
    resolve(here, "..", "..", "dist", "client"), // tsx: server/ -> dist/client
    resolve(here, "..", cfg.staticDir),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Return the most plausible one even if missing; static-serving will warn.
  return candidates[0] ?? resolve(here, "..", "client");
};

export async function buildServer(): Promise<{ app: FastifyInstance; cfg: ServerConfig }> {
  const cfg = loadServerConfig();
  bootstrapConfigDir(cfg, (msg) => {
    // eslint-disable-next-line no-console
    console.warn(`[chat-ui] ${msg}`);
  });

  const store = createProfileStore({ path: cfg.profilesPath });

  const app = Fastify({
    bodyLimit: 8 * 1024 * 1024, // 8 MB — chat bodies are tiny but headroom is cheap
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      redact: ["req.headers.authorization", 'req.headers["api-key"]'],
    },
    trustProxy: false,
  });

  // Centralised error handler — converts ChatUiError subclasses into typed
  // envelopes. Mirrors the host service's pattern in src/httpServer.ts.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ChatUiError) {
      reply.code(err.httpStatus).send(err.toEnvelope());
      return;
    }
    const fastifyErr = err as { statusCode?: number; code?: string; message?: string };
    if (
      typeof fastifyErr.statusCode === "number" &&
      fastifyErr.statusCode >= 400 &&
      fastifyErr.statusCode < 600
    ) {
      const code = typeof fastifyErr.code === "string" ? fastifyErr.code : "fastify_error";
      req.log.warn({ err, url: req.url }, "fastify error");
      reply.code(fastifyErr.statusCode).send({
        error: { type: code, message: fastifyErr.message ?? "fastify error" },
      });
      return;
    }
    req.log.error({ err, url: req.url }, "internal error in request handler");
    reply.code(500).send({
      error: { type: "internal", message: err instanceof Error ? err.message : "Internal error" },
    });
  });

  // Health check (handy for k8s-style liveness even though this is a dev tool)
  app.get("/healthz", async () => ({ ok: true }));

  // /api/profiles* — six endpoints
  await registerProfileRoutes(app, { store });

  // /api/chat — SSE relay
  app.post("/api/chat", async (request, reply) => {
    await handleChatRequest({ store }, request, reply);
  });

  // Static SPA bundle + SPA fallback. In production-like Topology B, Fastify
  // serves the compiled bundle from dist/client. In dev (Topology A), this
  // path may not exist; we still register the plugin but the dev SPA is
  // served by Vite.
  if (cfg.serveStatic) {
    const staticAbs = resolveStaticDirAbs(cfg);
    if (existsSync(staticAbs)) {
      await app.register(fastifyStatic, {
        root: staticAbs,
        index: ["index.html"],
        wildcard: false,
        decorateReply: true,
      });

      // SPA fallback: any non-/api 404 returns index.html so client routing works.
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith("/api/")) {
          reply.code(404).send({ error: { type: "not_found", message: `route not found: ${request.url}` } });
          return;
        }
        // Send index.html for SPA routes.
        reply.type("text/html").sendFile("index.html");
      });
    } else {
      app.log.info(
        { staticAbs },
        "static SPA dir not present — running in API-only mode (e.g. dev with Vite)",
      );
      app.setNotFoundHandler((request, reply) => {
        reply.code(404).send({
          error: {
            type: "not_found",
            message:
              `route not found: ${request.url} (static dir missing — did you run \`npm run build\`?)`,
          },
        });
      });
    }
  }

  return { app, cfg };
}

// Process entry — only runs when invoked directly, not when imported by tests.
const isDirectInvocation =
  // tsx / node: process.argv[1] === <this file>
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  // resolve(...) handles both .ts and compiled .js paths
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  buildServer()
    .then(async ({ app, cfg }) => {
      try {
        const addr = await app.listen({ host: cfg.host, port: cfg.port });
        // listen() returns the actual address including the OS-assigned port
        // when port=0. Print it explicitly per AC-CU-12.
        // eslint-disable-next-line no-console
        console.log(`[chat-ui] listening at ${addr}`);
      } catch (err) {
        app.log.error({ err }, "failed to start");
        process.exit(1);
      }
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[chat-ui] startup failed:", err);
      process.exit(1);
    });
}
