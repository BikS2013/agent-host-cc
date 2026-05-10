// Vitest configuration for chat-ui server-side unit tests.
//
// Environment: "node" is the correct environment for all server modules
// (profileSchema, requestBuilder, profileStore, config). If a future agent
// adds client tests that need DOM APIs, add a per-file directive:
//   // @vitest-environment jsdom
// rather than changing this global config.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
