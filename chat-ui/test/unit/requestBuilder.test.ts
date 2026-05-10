// Unit tests for server/requestBuilder.ts
//
// All tests exercise buildUpstreamRequest — a pure, sync function. No I/O.
// Covers: URL construction, header selection, body shape, and profile defaults.

import { describe, it, expect } from "vitest";
import { buildUpstreamRequest } from "../../server/requestBuilder.js";
import type { UpstreamRequestInput } from "../../server/requestBuilder.js";
import type { AgentHostProfile, OpenAiProfile, AzureOpenAiProfile } from "../../server/profileSchema.js";

// ---------------------------------------------------------------------------
// Test fixtures — typed profile objects bypassing Zod for speed
// ---------------------------------------------------------------------------

const uuid = "00000000-0000-4000-8000-000000000001";

const agentHostProfile = (): AgentHostProfile => ({
  id: uuid,
  backendKind: "agent-host-cc",
  name: "local",
  baseUrl: "http://localhost:8000",
  apiKey: "sk-local",
  defaultModel: "cc.claude-sonnet-4-6",
});

const openAiProfile = (): OpenAiProfile => ({
  id: uuid,
  backendKind: "openai",
  name: "openai-prod",
  baseUrl: "https://api.openai.com",
  apiKey: "sk-openai",
  defaultModel: "gpt-4o-mini",
});

const azureProfile = (): AzureOpenAiProfile => ({
  id: uuid,
  backendKind: "azure-openai",
  name: "azure",
  endpoint: "https://myresource.openai.azure.com",
  deployment: "gpt-4o",
  apiVersion: "2024-10-21",
  apiKey: "azure-key-123",
});

/** Minimal body that every call uses unless overridden. */
const minimalBody = (): UpstreamRequestInput => ({
  messages: [{ role: "user", content: "Hello" }],
});

// ---------------------------------------------------------------------------
// agent-host-cc
// ---------------------------------------------------------------------------

describe("buildUpstreamRequest — agent-host-cc", () => {
  it("builds the correct URL: {baseUrl}/v1/chat/completions", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    expect(req.url).toBe("http://localhost:8000/v1/chat/completions");
  });

  it("strips trailing slash from baseUrl before appending path", () => {
    const profile = { ...agentHostProfile(), baseUrl: "http://localhost:8000/" };
    const req = buildUpstreamRequest(profile, minimalBody());
    expect(req.url).toBe("http://localhost:8000/v1/chat/completions");
  });

  it("sets Authorization: Bearer {apiKey}", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    expect(req.headers["Authorization"]).toBe("Bearer sk-local");
  });

  it("sets Content-Type: application/json", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    expect(req.headers["Content-Type"]).toBe("application/json");
  });

  it("sets Accept: text/event-stream", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    expect(req.headers["Accept"]).toBe("text/event-stream");
  });

  it("includes model verbatim from defaultModel (cc. prefix preserved)", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["model"]).toBe("cc.claude-sonnet-4-6");
  });

  it("sets stream: true by default (when body.stream is not specified)", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["stream"]).toBe(true);
  });

  it("forwards the messages array unchanged", () => {
    const messages = [
      { role: "system" as const, content: "Be brief." },
      { role: "user" as const, content: "Hello" },
    ];
    const req = buildUpstreamRequest(agentHostProfile(), { messages });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["messages"]).toEqual(messages);
  });

  it("does NOT include api-key header", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    expect(req.headers["api-key"]).toBeUndefined();
  });

  it("injects temperature from profile when absent from body", () => {
    const profile = { ...agentHostProfile(), temperature: 0.5 };
    const req = buildUpstreamRequest(profile, minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["temperature"]).toBe(0.5);
  });

  it("injects maxTokens from profile as max_tokens when absent from body", () => {
    const profile = { ...agentHostProfile(), maxTokens: 512 };
    const req = buildUpstreamRequest(profile, minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["max_tokens"]).toBe(512);
  });

  it("body temperature overrides profile temperature", () => {
    const profile = { ...agentHostProfile(), temperature: 0.5 };
    const req = buildUpstreamRequest(profile, { ...minimalBody(), temperature: 0.9 });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["temperature"]).toBe(0.9);
  });

  it("body max_tokens overrides profile maxTokens", () => {
    const profile = { ...agentHostProfile(), maxTokens: 256 };
    const req = buildUpstreamRequest(profile, { ...minimalBody(), max_tokens: 1024 });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["max_tokens"]).toBe(1024);
  });

  it("omits temperature from body when absent from both body and profile", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["temperature"]).toBeUndefined();
  });

  it("omits max_tokens from body when absent from both body and profile", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["max_tokens"]).toBeUndefined();
  });

  it("prepends a system message from profile.systemPrompt when first message is not system", () => {
    const profile = { ...agentHostProfile(), systemPrompt: "Be concise." };
    const req = buildUpstreamRequest(profile, minimalBody());
    const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0]).toEqual({ role: "system", content: "Be concise." });
    expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("does NOT prepend system message when first message is already system", () => {
    const profile = { ...agentHostProfile(), systemPrompt: "Be concise." };
    const messages = [
      { role: "system" as const, content: "Existing system." },
      { role: "user" as const, content: "Hello" },
    ];
    const req = buildUpstreamRequest(profile, { messages });
    const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
    // Should NOT have two system messages
    expect(body.messages[0]).toEqual({ role: "system", content: "Existing system." });
    expect(body.messages.length).toBe(2);
  });

  it("does NOT prepend system message when profile.systemPrompt is absent", () => {
    const req = buildUpstreamRequest(agentHostProfile(), minimalBody());
    const body = JSON.parse(req.body) as { messages: Array<{ role: string }> };
    expect(body.messages[0]?.role).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// openai
// ---------------------------------------------------------------------------

describe("buildUpstreamRequest — openai", () => {
  it("builds the correct URL using the profile's baseUrl", () => {
    const req = buildUpstreamRequest(openAiProfile(), minimalBody());
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("falls back to https://api.openai.com when baseUrl is undefined (belt-and-braces path)", () => {
    // Construct a profile without baseUrl to hit the ?? fallback in the source
    const profile = { ...openAiProfile(), baseUrl: undefined as unknown as string };
    const req = buildUpstreamRequest(profile, minimalBody());
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("strips trailing slash from baseUrl", () => {
    const profile = { ...openAiProfile(), baseUrl: "https://api.openai.com/" };
    const req = buildUpstreamRequest(profile, minimalBody());
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("sets Authorization: Bearer {apiKey}", () => {
    const req = buildUpstreamRequest(openAiProfile(), minimalBody());
    expect(req.headers["Authorization"]).toBe("Bearer sk-openai");
  });

  it("sets Content-Type: application/json", () => {
    const req = buildUpstreamRequest(openAiProfile(), minimalBody());
    expect(req.headers["Content-Type"]).toBe("application/json");
  });

  it("includes model verbatim from defaultModel", () => {
    const req = buildUpstreamRequest(openAiProfile(), minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-4o-mini");
  });

  it("sets stream: true by default", () => {
    const req = buildUpstreamRequest(openAiProfile(), minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["stream"]).toBe(true);
  });

  it("does NOT set api-key header", () => {
    const req = buildUpstreamRequest(openAiProfile(), minimalBody());
    expect(req.headers["api-key"]).toBeUndefined();
  });

  it("uses a custom baseUrl when provided", () => {
    const profile = { ...openAiProfile(), baseUrl: "https://my-proxy.example.com" };
    const req = buildUpstreamRequest(profile, minimalBody());
    expect(req.url).toBe("https://my-proxy.example.com/v1/chat/completions");
  });

  it("injects temperature from profile when absent from body", () => {
    const profile = { ...openAiProfile(), temperature: 0.3 };
    const req = buildUpstreamRequest(profile, minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["temperature"]).toBe(0.3);
  });

  it("injects max_tokens from profile.maxTokens when absent from body", () => {
    const profile = { ...openAiProfile(), maxTokens: 128 };
    const req = buildUpstreamRequest(profile, minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["max_tokens"]).toBe(128);
  });

  it("passes messages unchanged", () => {
    const messages = [{ role: "user" as const, content: "What is 2+2?" }];
    const req = buildUpstreamRequest(openAiProfile(), { messages });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["messages"]).toEqual(messages);
  });
});

// ---------------------------------------------------------------------------
// azure-openai
// ---------------------------------------------------------------------------

describe("buildUpstreamRequest — azure-openai", () => {
  it("builds the correct Azure URL format", () => {
    const req = buildUpstreamRequest(azureProfile(), minimalBody());
    expect(req.url).toBe(
      "https://myresource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21",
    );
  });

  it("strips trailing slash from endpoint", () => {
    const profile = { ...azureProfile(), endpoint: "https://myresource.openai.azure.com/" };
    const req = buildUpstreamRequest(profile, minimalBody());
    expect(req.url).toContain("https://myresource.openai.azure.com/openai/deployments/");
    expect(req.url).not.toContain("//openai");
  });

  it("URL-encodes the deployment name", () => {
    const profile = { ...azureProfile(), deployment: "my deployment/v2" };
    const req = buildUpstreamRequest(profile, minimalBody());
    expect(req.url).toContain("my%20deployment%2Fv2");
  });

  it("URL-encodes the apiVersion in the query string", () => {
    const profile = { ...azureProfile(), apiVersion: "2024-10-21-preview" };
    const req = buildUpstreamRequest(profile, minimalBody());
    expect(req.url).toContain("api-version=2024-10-21-preview");
  });

  it("sets api-key header (lower-case) to the profile apiKey", () => {
    const req = buildUpstreamRequest(azureProfile(), minimalBody());
    expect(req.headers["api-key"]).toBe("azure-key-123");
  });

  it("does NOT set Authorization header", () => {
    const req = buildUpstreamRequest(azureProfile(), minimalBody());
    expect(req.headers["Authorization"]).toBeUndefined();
  });

  it("sets Content-Type: application/json", () => {
    const req = buildUpstreamRequest(azureProfile(), minimalBody());
    expect(req.headers["Content-Type"]).toBe("application/json");
  });

  it("OMITS model from the request body (deployment is in the URL)", () => {
    const req = buildUpstreamRequest(azureProfile(), minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["model"]).toBeUndefined();
  });

  it("sets stream: true by default", () => {
    const req = buildUpstreamRequest(azureProfile(), minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["stream"]).toBe(true);
  });

  it("passes messages unchanged", () => {
    const messages = [{ role: "user" as const, content: "Test" }];
    const req = buildUpstreamRequest(azureProfile(), { messages });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["messages"]).toEqual(messages);
  });

  it("injects temperature from profile when absent from body", () => {
    const profile = { ...azureProfile(), temperature: 0.8 };
    const req = buildUpstreamRequest(profile, minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["temperature"]).toBe(0.8);
  });

  it("injects max_tokens from profile.maxTokens when absent from body", () => {
    const profile = { ...azureProfile(), maxTokens: 200 };
    const req = buildUpstreamRequest(profile, minimalBody());
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["max_tokens"]).toBe(200);
  });

  it("body temperature overrides profile temperature", () => {
    const profile = { ...azureProfile(), temperature: 0.2 };
    const req = buildUpstreamRequest(profile, { ...minimalBody(), temperature: 1.5 });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["temperature"]).toBe(1.5);
  });

  it("prepends systemPrompt from profile when profile has one", () => {
    const profile = { ...azureProfile(), systemPrompt: "Azure system." };
    const req = buildUpstreamRequest(profile, minimalBody());
    const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0]).toEqual({ role: "system", content: "Azure system." });
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: stream flag propagation
// ---------------------------------------------------------------------------

describe("buildUpstreamRequest — streaming flag", () => {
  it("passes stream:false through to the body when explicitly set", () => {
    const req = buildUpstreamRequest(agentHostProfile(), { ...minimalBody(), stream: false });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["stream"]).toBe(false);
  });

  it("passes stream:true through to the body when explicitly set", () => {
    const req = buildUpstreamRequest(openAiProfile(), { ...minimalBody(), stream: true });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body["stream"]).toBe(true);
  });
});
