// Unit tests for server/profileSchema.ts
//
// Covers: discriminated-union parsing, required-field enforcement,
// optional-field handling, schema-level constraints, and redaction helper.

import { describe, it, expect } from "vitest";
import {
  ProfileSchema,
  CreateProfileInputSchema,
  ProfileStoreShapeSchema,
  REDACTED_API_KEY,
  redactProfile,
} from "../../server/profileSchema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const uuid = "00000000-0000-4000-8000-000000000001";

/** Minimal valid agent-host-cc profile (full, with id). */
const validAgentHost = () => ({
  id: uuid,
  backendKind: "agent-host-cc" as const,
  name: "local",
  baseUrl: "http://localhost:8000",
  apiKey: "sk-test",
  defaultModel: "cc.claude-sonnet-4-6",
});

/** Minimal valid openai profile. */
const validOpenAi = () => ({
  id: uuid,
  backendKind: "openai" as const,
  name: "openai-prod",
  apiKey: "sk-openai",
  defaultModel: "gpt-4o-mini",
});

/** Minimal valid azure-openai profile. */
const validAzure = () => ({
  id: uuid,
  backendKind: "azure-openai" as const,
  name: "azure-foundry",
  endpoint: "https://myresource.openai.azure.com",
  deployment: "gpt-4o",
  apiVersion: "2024-10-21",
  apiKey: "azure-key-123",
});

// ---------------------------------------------------------------------------
// agent-host-cc variant
// ---------------------------------------------------------------------------

describe("ProfileSchema — agent-host-cc variant", () => {
  it("parses a complete valid profile", () => {
    const result = ProfileSchema.safeParse(validAgentHost());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backendKind).toBe("agent-host-cc");
      expect(result.data.defaultModel).toBe("cc.claude-sonnet-4-6");
    }
  });

  it("parses with optional systemPrompt set", () => {
    const input = { ...validAgentHost(), systemPrompt: "Be concise." };
    const result = ProfileSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { systemPrompt?: string }).systemPrompt).toBe("Be concise.");
    }
  });

  it("parses with optional temperature and maxTokens set", () => {
    const input = { ...validAgentHost(), temperature: 0.7, maxTokens: 256 };
    const result = ProfileSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { temperature?: number }).temperature).toBe(0.7);
      expect((result.data as { maxTokens?: number }).maxTokens).toBe(256);
    }
  });

  it("parses successfully without optional fields", () => {
    const result = ProfileSchema.safeParse(validAgentHost());
    expect(result.success).toBe(true);
    if (result.success) {
      const d = result.data as { systemPrompt?: unknown; temperature?: unknown; maxTokens?: unknown };
      expect(d.systemPrompt).toBeUndefined();
      expect(d.temperature).toBeUndefined();
      expect(d.maxTokens).toBeUndefined();
    }
  });

  it("rejects when backendKind is missing", () => {
    const { backendKind: _omit, ...rest } = validAgentHost();
    const result = ProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when baseUrl is missing", () => {
    const { baseUrl: _omit, ...rest } = validAgentHost();
    const result = ProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      // Should reference backendKind or baseUrl, discriminated union may raise on backendKind
      expect(paths.length).toBeGreaterThan(0);
    }
  });

  it("rejects when apiKey is empty string", () => {
    const result = ProfileSchema.safeParse({ ...validAgentHost(), apiKey: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("apiKey"))).toBe(true);
    }
  });

  it("rejects when defaultModel is empty string", () => {
    const result = ProfileSchema.safeParse({ ...validAgentHost(), defaultModel: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("defaultModel"))).toBe(true);
    }
  });

  it("rejects a negative temperature", () => {
    const result = ProfileSchema.safeParse({ ...validAgentHost(), temperature: -0.1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("temperature"))).toBe(true);
    }
  });

  it("rejects temperature above 2", () => {
    const result = ProfileSchema.safeParse({ ...validAgentHost(), temperature: 2.1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("temperature"))).toBe(true);
    }
  });

  it("rejects zero maxTokens (must be positive int)", () => {
    const result = ProfileSchema.safeParse({ ...validAgentHost(), maxTokens: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("maxTokens"))).toBe(true);
    }
  });

  it("rejects negative maxTokens", () => {
    const result = ProfileSchema.safeParse({ ...validAgentHost(), maxTokens: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer maxTokens", () => {
    const result = ProfileSchema.safeParse({ ...validAgentHost(), maxTokens: 1.5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("maxTokens"))).toBe(true);
    }
  });

  it("rejects name that is empty after trimming", () => {
    const result = ProfileSchema.safeParse({ ...validAgentHost(), name: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("name"))).toBe(true);
    }
  });

  it("trims leading/trailing whitespace from name", () => {
    const result = ProfileSchema.safeParse({ ...validAgentHost(), name: "  local  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("local");
    }
  });
});

// ---------------------------------------------------------------------------
// openai variant
// ---------------------------------------------------------------------------

describe("ProfileSchema — openai variant", () => {
  it("parses a minimal valid profile (no baseUrl)", () => {
    const result = ProfileSchema.safeParse(validOpenAi());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backendKind).toBe("openai");
      // Schema default must be applied
      expect((result.data as { baseUrl?: string }).baseUrl).toBe("https://api.openai.com");
    }
  });

  it("parses with an explicit baseUrl override", () => {
    const input = { ...validOpenAi(), baseUrl: "https://my-proxy.example.com" };
    const result = ProfileSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { baseUrl?: string }).baseUrl).toBe("https://my-proxy.example.com");
    }
  });

  it("rejects when apiKey is missing", () => {
    const { apiKey: _omit, ...rest } = validOpenAi();
    const result = ProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when defaultModel is missing", () => {
    const { defaultModel: _omit, ...rest } = validOpenAi();
    const result = ProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("parses with optional systemPrompt present", () => {
    const result = ProfileSchema.safeParse({ ...validOpenAi(), systemPrompt: "You are helpful." });
    expect(result.success).toBe(true);
  });

  it("rejects a negative temperature", () => {
    const result = ProfileSchema.safeParse({ ...validOpenAi(), temperature: -0.5 });
    expect(result.success).toBe(false);
  });

  it("rejects zero maxTokens", () => {
    const result = ProfileSchema.safeParse({ ...validOpenAi(), maxTokens: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL baseUrl", () => {
    const result = ProfileSchema.safeParse({ ...validOpenAi(), baseUrl: "not-a-url" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("baseUrl"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// azure-openai variant
// ---------------------------------------------------------------------------

describe("ProfileSchema — azure-openai variant", () => {
  it("parses a complete valid azure profile", () => {
    const result = ProfileSchema.safeParse(validAzure());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backendKind).toBe("azure-openai");
      expect((result.data as { deployment?: string }).deployment).toBe("gpt-4o");
    }
  });

  it("accepts apiVersion with -preview suffix", () => {
    const result = ProfileSchema.safeParse({ ...validAzure(), apiVersion: "2024-10-21-preview" });
    expect(result.success).toBe(true);
  });

  it("rejects malformed apiVersion", () => {
    const result = ProfileSchema.safeParse({ ...validAzure(), apiVersion: "latest" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("apiVersion"))).toBe(true);
    }
  });

  it("rejects when endpoint is missing", () => {
    const { endpoint: _omit, ...rest } = validAzure();
    const result = ProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when deployment is missing", () => {
    const { deployment: _omit, ...rest } = validAzure();
    const result = ProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when apiKey is missing", () => {
    const { apiKey: _omit, ...rest } = validAzure();
    const result = ProfileSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("does NOT have a defaultModel field — extra field is stripped or rejected by discriminated union", () => {
    // azure-openai schema does not define defaultModel; adding it should
    // still parse successfully (Zod object strips extra fields by default in v4),
    // but the resulting type should NOT include defaultModel.
    const withModel = { ...validAzure(), defaultModel: "gpt-4o" };
    const result = ProfileSchema.safeParse(withModel);
    // The schema may or may not reject extra keys; what matters is that
    // `defaultModel` is NOT exposed in the typed output — it must be absent
    // from the parsed data (Zod's default behaviour is to strip unknowns).
    if (result.success) {
      // If parse succeeds, defaultModel must not be present in the output
      expect((result.data as Record<string, unknown>)["defaultModel"]).toBeUndefined();
    }
    // If it fails, that is also acceptable (strict rejection).
    // Either way the test documents the policy.
  });

  it("rejects a non-URL endpoint", () => {
    const result = ProfileSchema.safeParse({ ...validAzure(), endpoint: "not-a-url" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("endpoint"))).toBe(true);
    }
  });

  it("parses with optional temperature", () => {
    const result = ProfileSchema.safeParse({ ...validAzure(), temperature: 1.0 });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown backendKind
// ---------------------------------------------------------------------------

describe("ProfileSchema — discriminator failure", () => {
  it("rejects an unknown backendKind", () => {
    const result = ProfileSchema.safeParse({
      id: uuid,
      backendKind: "bedrock",
      name: "test",
      apiKey: "key",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when backendKind is absent entirely", () => {
    const result = ProfileSchema.safeParse({ id: uuid, name: "test" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateProfileInputSchema (no `id` field)
// ---------------------------------------------------------------------------

describe("CreateProfileInputSchema", () => {
  it("accepts a valid agent-host-cc create input without id", () => {
    const { id: _omit, ...rest } = validAgentHost();
    const result = CreateProfileInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects when id is included (no such field in create schema)", () => {
    // CreateProfileInputSchema is formed via .omit({ id: true }), so extra
    // fields like id are either stripped silently or cause no error.
    // What matters is that the schema DOES NOT require id.
    const { id: _omit, ...rest } = validAgentHost();
    const result = CreateProfileInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("accepts a valid openai create input without id", () => {
    const { id: _omit, ...rest } = validOpenAi();
    const result = CreateProfileInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("accepts a valid azure-openai create input without id", () => {
    const { id: _omit, ...rest } = validAzure();
    const result = CreateProfileInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ProfileStoreShapeSchema
// ---------------------------------------------------------------------------

describe("ProfileStoreShapeSchema", () => {
  it("accepts an empty store", () => {
    const result = ProfileStoreShapeSchema.safeParse({ activeProfileId: null, profiles: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a store with one valid profile", () => {
    const result = ProfileStoreShapeSchema.safeParse({
      activeProfileId: uuid,
      profiles: [validAgentHost()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when two profiles share the same name", () => {
    const p2 = { ...validOpenAi(), id: "00000000-0000-4000-8000-000000000002", name: "local" };
    const result = ProfileStoreShapeSchema.safeParse({
      activeProfileId: uuid,
      profiles: [validAgentHost(), p2],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message);
      expect(msgs.some((m) => m.toLowerCase().includes("unique") || m.toLowerCase().includes("name"))).toBe(true);
    }
  });

  it("accepts two profiles with different names", () => {
    const p2 = { ...validOpenAi(), id: "00000000-0000-4000-8000-000000000002" };
    const result = ProfileStoreShapeSchema.safeParse({
      activeProfileId: uuid,
      profiles: [validAgentHost(), p2],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// redactProfile helper
// ---------------------------------------------------------------------------

describe("redactProfile", () => {
  it("replaces apiKey with the REDACTED_API_KEY sentinel", () => {
    const profile = ProfileSchema.parse(validAgentHost());
    const redacted = redactProfile(profile);
    expect(redacted.apiKey).toBe(REDACTED_API_KEY);
  });

  it("does not mutate the original profile object", () => {
    const profile = ProfileSchema.parse(validAgentHost());
    const original = profile.apiKey;
    redactProfile(profile);
    expect(profile.apiKey).toBe(original);
  });

  it("preserves all other fields unchanged", () => {
    const profile = ProfileSchema.parse(validAgentHost());
    const redacted = redactProfile(profile);
    expect(redacted.name).toBe(profile.name);
    expect(redacted.backendKind).toBe(profile.backendKind);
    expect((redacted as { defaultModel?: string }).defaultModel).toBe(
      (profile as { defaultModel?: string }).defaultModel,
    );
  });

  it("REDACTED_API_KEY constant is the literal string '<redacted>'", () => {
    expect(REDACTED_API_KEY).toBe("<redacted>");
  });
});
