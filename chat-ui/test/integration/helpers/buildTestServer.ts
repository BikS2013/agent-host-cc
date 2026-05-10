// @vitest-environment node
//
// Shared bootstrap helper for integration tests.
// Creates a temporary HOME / profiles.json, sets CHAT_UI_PROFILES_PATH,
// builds the Fastify server via buildServer(), and tears it down after each test.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

export interface TestServerHandle {
  app: FastifyInstance;
  profilesPath: string;
  cleanup: () => Promise<void>;
}

/**
 * Build a fresh test server pointing at a temp profiles.json.
 * Call `cleanup()` in afterEach.
 */
export async function buildTestServer(): Promise<TestServerHandle> {
  // Create a temp directory for the profiles file.
  const tmpDir = mkdtempSync(join(tmpdir(), "chat-ui-test-"));
  const cfgDir = join(tmpDir, "chat-ui");
  mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
  const profilesPath = join(cfgDir, "profiles.json");
  writeFileSync(
    profilesPath,
    JSON.stringify({ activeProfileId: null, profiles: [] }, null, 2) + "\n",
    { mode: 0o600 },
  );

  // Override env so loadServerConfig picks up our temp file.
  process.env["CHAT_UI_PROFILES_PATH"] = profilesPath;
  // Port 0 → OS-assigned (test does not actually listen).
  process.env["CHAT_UI_PORT"] = "0";
  // Disable static serving — dist/client is not built in test context.
  process.env["CHAT_UI_SERVE_STATIC"] = "false";

  const { buildServer } = await import("../../../server/index.js");
  const { app } = await buildServer();

  const cleanup = async (): Promise<void> => {
    await app.close();
    // Clean up env overrides
    delete process.env["CHAT_UI_PROFILES_PATH"];
    delete process.env["CHAT_UI_PORT"];
    delete process.env["CHAT_UI_SERVE_STATIC"];
  };

  return { app, profilesPath, cleanup };
}

/**
 * Minimal valid profile body for each backendKind.
 * All include required fields; does NOT include `id` (server-assigned).
 */
export const sampleProfiles = {
  agentHostCc: {
    name: "local-agent",
    backendKind: "agent-host-cc" as const,
    baseUrl: "http://localhost:8000",
    apiKey: "test-key-abc",
    defaultModel: "cc.claude-sonnet-4-6",
  },
  openai: {
    name: "openai-prod",
    backendKind: "openai" as const,
    apiKey: "sk-test-openai",
    defaultModel: "gpt-4o",
  },
  azureOpenai: {
    name: "azure-foundry",
    backendKind: "azure-openai" as const,
    endpoint: "https://my-resource.openai.azure.com",
    deployment: "gpt-4o-deploy",
    apiVersion: "2024-10-21",
    apiKey: "azure-key-xyz",
  },
};
