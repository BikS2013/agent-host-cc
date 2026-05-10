import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { ConfigurationError } from "../../src/errors.js";

const BASE_REQUIRED = {
  AGENT_HOST_API_KEY: "k",
  FILES_API_BASE_URL: "http://192.168.65.1:3080",
  FILES_API_KEY: "ow",
  MODEL_IDS: "claude-opus-4-7,claude-sonnet-4-6",
};

const FOUNDRY_REQUIRED = {
  ...BASE_REQUIRED,
  ANTHROPIC_FOUNDRY_API_KEY: "f",
  ANTHROPIC_FOUNDRY_RESOURCE: "test-foundry-resource",
  CLAUDE_CODE_USE_FOUNDRY: "1",
};

const PUBLIC_REQUIRED = {
  ...BASE_REQUIRED,
  ANTHROPIC_API_KEY: "ak",
};

describe("loadConfig", () => {
  it("loads all required vars and applies documented defaults (Foundry path)", () => {
    const c = loadConfig(FOUNDRY_REQUIRED);
    expect(c.agentHostApiKey).toBe("k");
    expect(c.modelIds).toEqual(["claude-opus-4-7", "claude-sonnet-4-6"]);
    expect(c.workspaceDir).toBe("/workspace");
    expect(c.workspaceMaxBytesPerChat).toBe(209_715_200);
    expect(c.maxUrlFetchesPerTurn).toBe(5);
    expect(c.agentTimeoutMs).toBe(300_000);
    expect(c.listenPort).toBe(8000);
    expect(c.modelPrefix).toBe("cc.");
    expect(c.filesApiPathTemplate).toBe("/api/v1/files/{id}/content");
    expect(c.provider.kind).toBe("anthropic-foundry");
  });

  it("resolves Anthropic public provider when ANTHROPIC_API_KEY is set and CLAUDE_CODE_USE_FOUNDRY is unset", () => {
    const c = loadConfig(PUBLIC_REQUIRED);
    expect(c.provider.kind).toBe("anthropic-public");
    if (c.provider.kind === "anthropic-public") {
      expect(c.provider.apiKey).toBe("ak");
    }
  });

  it("resolves Foundry provider when CLAUDE_CODE_USE_FOUNDRY=1 and both Foundry vars are set", () => {
    const c = loadConfig(FOUNDRY_REQUIRED);
    expect(c.provider.kind).toBe("anthropic-foundry");
    if (c.provider.kind === "anthropic-foundry") {
      expect(c.provider.apiKey).toBe("f");
      expect(c.provider.resource).toBe("test-foundry-resource");
    }
  });

  it("throws ConfigurationError when CLAUDE_CODE_USE_FOUNDRY=1 but ANTHROPIC_FOUNDRY_RESOURCE is missing", () => {
    const env = { ...FOUNDRY_REQUIRED } as Record<string, string>;
    delete env.ANTHROPIC_FOUNDRY_RESOURCE;
    expect(() => loadConfig(env)).toThrow(ConfigurationError);
    try { loadConfig(env); } catch (e) {
      expect((e as ConfigurationError).varName).toBe("ANTHROPIC_FOUNDRY_RESOURCE");
    }
  });

  it("throws ConfigurationError when neither provider path resolves (no ANTHROPIC_API_KEY, no Foundry)", () => {
    expect(() => loadConfig(BASE_REQUIRED)).toThrow(ConfigurationError);
    try { loadConfig(BASE_REQUIRED); } catch (e) {
      expect((e as ConfigurationError).varName).toBe("ANTHROPIC_API_KEY");
    }
  });

  it("throws ConfigurationError naming the missing variable (AGENT_HOST_API_KEY)", () => {
    const env = { ...PUBLIC_REQUIRED } as Record<string, string>;
    delete env.AGENT_HOST_API_KEY;
    expect(() => loadConfig(env)).toThrow(ConfigurationError);
    try { loadConfig(env); } catch (e) {
      expect((e as ConfigurationError).varName).toBe("AGENT_HOST_API_KEY");
    }
  });

  it("rejects CLAUDE_CODE_USE_FOUNDRY values that are neither '1' nor unset/'0'", () => {
    expect(() => loadConfig({ ...PUBLIC_REQUIRED, CLAUDE_CODE_USE_FOUNDRY: "yes" }))
      .toThrow(ConfigurationError);
  });

  it("treats CLAUDE_CODE_USE_FOUNDRY='0' as Anthropic public", () => {
    const c = loadConfig({ ...PUBLIC_REQUIRED, CLAUDE_CODE_USE_FOUNDRY: "0" });
    expect(c.provider.kind).toBe("anthropic-public");
  });

  it("parses MODEL_IDS as a CSV list with trim", () => {
    const c = loadConfig({ ...PUBLIC_REQUIRED, MODEL_IDS: " a , b , c " });
    expect(c.modelIds).toEqual(["a", "b", "c"]);
  });

  it("respects optional overrides when provided", () => {
    const c = loadConfig({
      ...PUBLIC_REQUIRED,
      WORKSPACE_DIR: "/tmp/ws",
      WORKSPACE_MAX_BYTES_PER_CHAT: "1000",
      LISTEN_PORT: "9000",
      MODEL_PREFIX: "claude.",
      FILES_API_PATH_TEMPLATE: "/files/{id}",
    });
    expect(c.workspaceDir).toBe("/tmp/ws");
    expect(c.workspaceMaxBytesPerChat).toBe(1000);
    expect(c.listenPort).toBe(9000);
    expect(c.modelPrefix).toBe("claude.");
    expect(c.filesApiPathTemplate).toBe("/files/{id}");
  });

  it("allows MODEL_PREFIX to be set to empty string (disables stripping)", () => {
    const c = loadConfig({ ...PUBLIC_REQUIRED, MODEL_PREFIX: "" });
    expect(c.modelPrefix).toBe("");
  });

  it("treats Files API config as optional when both BASE_URL and KEY are unset", () => {
    const env = { ...PUBLIC_REQUIRED } as Record<string, string>;
    delete env.FILES_API_BASE_URL;
    delete env.FILES_API_KEY;
    const c = loadConfig(env);
    expect(c.filesApiBaseUrl).toBeUndefined();
    expect(c.filesApiKey).toBeUndefined();
    // path template default still resolves so callers can build URLs once the
    // base URL becomes known at runtime.
    expect(c.filesApiPathTemplate).toBe("/api/v1/files/{id}/content");
  });

  it("rejects partial Files API config (BASE_URL set, KEY missing)", () => {
    const env = { ...PUBLIC_REQUIRED } as Record<string, string>;
    delete env.FILES_API_KEY;
    expect(() => loadConfig(env)).toThrow(ConfigurationError);
    try { loadConfig(env); } catch (e) {
      expect((e as ConfigurationError).varName).toBe("FILES_API_KEY");
    }
  });

  it("rejects partial Files API config (KEY set, BASE_URL missing)", () => {
    const env = { ...PUBLIC_REQUIRED } as Record<string, string>;
    delete env.FILES_API_BASE_URL;
    expect(() => loadConfig(env)).toThrow(ConfigurationError);
    try { loadConfig(env); } catch (e) {
      expect((e as ConfigurationError).varName).toBe("FILES_API_BASE_URL");
    }
  });
});
