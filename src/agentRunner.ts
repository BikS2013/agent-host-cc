import type { FastifyBaseLogger } from "fastify";
import type { Message, AttachmentManifest } from "./types.js";

export interface RunRequest {
  chatId: string;
  model: string;
  cwd: string;
  cleanedMessages: Message[];
  manifest: AttachmentManifest;
  /**
   * Optional Fastify Pino logger (per-request). When provided the runner
   * emits the agent.* lifecycle log lines (session-init, tool-use,
   * tool-result, assistant-text, end-of-turn) consumed by the
   * agent-host-monitor PinoJsonParser. See
   * /Users/giorgosmarinos/aiwork/agent-host-monitor/docs/design/plan-002-agent-parser-and-pino-instrumentation.md §B.
   */
  log?: FastifyBaseLogger;
}

export interface AgentRunner {
  run(req: RunRequest): AsyncIterable<unknown>;
}
