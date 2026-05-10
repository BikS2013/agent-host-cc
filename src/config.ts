import { ConfigurationError } from "./errors.js";
import type { Provider } from "./types.js";

export interface Config {
  agentHostApiKey: string;
  agentHostApiKeyExpiresAt: string | undefined;
  provider: Provider;
  // Files API config is optional at startup. If clients send `files[]`
  // entries on /v1/chat/completions or /v1/responses but `filesApiBaseUrl`
  // / `filesApiKey` are unset, the request will fail with a clear
  // `UpstreamFilesFetchError` at attachment-processing time. This honors
  // the no-fallback rule: we do not synthesize a base URL or key — we
  // surface the missing config the moment the feature is exercised.
  filesApiBaseUrl: string | undefined;
  filesApiKey: string | undefined;
  filesApiPathTemplate: string;
  modelIds: string[];
  modelPrefix: string;
  workspaceDir: string;
  workspaceMaxBytesPerChat: number;
  maxUrlFetchesPerTurn: number;
  maxRemoteFetchBytes: number;
  urlFetchTimeoutMs: number;
  agentTimeoutMs: number;
  agentMaxTurns: number;
  logLevel: string;
  listenPort: number;
  filesApiKeyExpiresAt: string | undefined;
  responsesToolUseRendering: "text";
}

const required = (env: Record<string, string | undefined>, name: string): string => {
  const v = env[name];
  if (v === undefined || v === "") throw new ConfigurationError(name);
  return v;
};

const intOr = (env: Record<string, string | undefined>, name: string, def: number): number => {
  const v = env[name];
  if (v === undefined || v === "") return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new ConfigurationError(name, `Expected integer for ${name}, got ${v}`);
  return n;
};

const resolveProvider = (env: Record<string, string | undefined>): Provider => {
  const useFoundryRaw = env.CLAUDE_CODE_USE_FOUNDRY;
  const useFoundry = useFoundryRaw === "1";
  if (useFoundry) {
    const apiKey = required(env, "ANTHROPIC_FOUNDRY_API_KEY");
    const resource = required(env, "ANTHROPIC_FOUNDRY_RESOURCE");
    return {
      kind: "anthropic-foundry",
      apiKey,
      resource,
      apiKeyExpiresAt: env.ANTHROPIC_FOUNDRY_API_KEY_EXPIRES_AT,
    };
  }
  if (useFoundryRaw !== undefined && useFoundryRaw !== "" && useFoundryRaw !== "0") {
    throw new ConfigurationError(
      "CLAUDE_CODE_USE_FOUNDRY",
      `Invalid value for CLAUDE_CODE_USE_FOUNDRY: ${useFoundryRaw} (must be '1' to enable Foundry, or unset/'0' to use Anthropic public)`,
    );
  }
  const apiKey = required(env, "ANTHROPIC_API_KEY");
  return {
    kind: "anthropic-public",
    apiKey,
    apiKeyExpiresAt: env.ANTHROPIC_API_KEY_EXPIRES_AT,
  };
};

export const loadConfig = (env: Record<string, string | undefined> = process.env): Config => {
  const agentHostApiKey = required(env, "AGENT_HOST_API_KEY");
  const provider = resolveProvider(env);
  const rawBase = env.FILES_API_BASE_URL;
  const rawKey = env.FILES_API_KEY;
  const filesApiBaseUrl = rawBase && rawBase !== "" ? rawBase : undefined;
  const filesApiKey = rawKey && rawKey !== "" ? rawKey : undefined;
  // Partial configuration is rejected at startup so operators don't ship a
  // half-configured deployment that fails only when the first `files[]`
  // request lands. Either both are set, or neither.
  if ((filesApiBaseUrl === undefined) !== (filesApiKey === undefined)) {
    const setName = filesApiBaseUrl !== undefined ? "FILES_API_BASE_URL" : "FILES_API_KEY";
    const missingName = filesApiBaseUrl !== undefined ? "FILES_API_KEY" : "FILES_API_BASE_URL";
    throw new ConfigurationError(
      missingName,
      `${setName} is set but ${missingName} is not. Set both (to enable files[] handling) or neither (to disable it).`,
    );
  }
  const filesApiPathTemplate = env.FILES_API_PATH_TEMPLATE && env.FILES_API_PATH_TEMPLATE !== ""
    ? env.FILES_API_PATH_TEMPLATE
    : "/api/v1/files/{id}/content";
  const modelIdsRaw = required(env, "MODEL_IDS");
  const modelIds = modelIdsRaw.split(",").map(s => s.trim()).filter(Boolean);
  if (modelIds.length === 0) throw new ConfigurationError("MODEL_IDS", "MODEL_IDS resolved to empty list");
  const modelPrefix = env.MODEL_PREFIX !== undefined ? env.MODEL_PREFIX : "cc.";

  // Responses-API tool-use rendering. v1 only supports "text" (italic-markdown
  // shim, identical to the Chat adapter). "item" is reserved for FUT-5 and
  // rejected at startup with ConfigurationError.
  const renderRaw = env.RESPONSES_TOOL_USE_RENDERING;
  const resolveRendering = (): "text" => {
    if (renderRaw === undefined || renderRaw === "" || renderRaw === "text") return "text";
    if (renderRaw === "item") {
      throw new ConfigurationError(
        "RESPONSES_TOOL_USE_RENDERING",
        "RESPONSES_TOOL_USE_RENDERING=item is reserved for a future release; set to 'text'",
      );
    }
    throw new ConfigurationError(
      "RESPONSES_TOOL_USE_RENDERING",
      `Invalid value for RESPONSES_TOOL_USE_RENDERING: ${renderRaw} (allowed: 'text')`,
    );
  };
  const responsesToolUseRendering: "text" = resolveRendering();

  return {
    agentHostApiKey,
    agentHostApiKeyExpiresAt: env.AGENT_HOST_API_KEY_EXPIRES_AT,
    provider,
    filesApiBaseUrl,
    filesApiKey,
    filesApiPathTemplate,
    modelIds,
    modelPrefix,
    workspaceDir: env.WORKSPACE_DIR ?? "/workspace",
    workspaceMaxBytesPerChat: intOr(env, "WORKSPACE_MAX_BYTES_PER_CHAT", 209_715_200),
    maxUrlFetchesPerTurn: intOr(env, "MAX_URL_FETCHES_PER_TURN", 5),
    maxRemoteFetchBytes: intOr(env, "MAX_REMOTE_FETCH_BYTES", 52_428_800),
    urlFetchTimeoutMs: intOr(env, "URL_FETCH_TIMEOUT_MS", 30_000),
    agentTimeoutMs: intOr(env, "AGENT_TIMEOUT_MS", 300_000),
    agentMaxTurns: intOr(env, "AGENT_MAX_TURNS", 20),
    logLevel: env.LOG_LEVEL ?? "info",
    listenPort: intOr(env, "LISTEN_PORT", 8000),
    filesApiKeyExpiresAt: env.FILES_API_KEY_EXPIRES_AT,
    responsesToolUseRendering,
  };
};
