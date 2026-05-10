import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Vite configuration for the chat-ui SPA half.
//
// Topology A (npm run dev): this Vite dev server runs on 127.0.0.1:5173
// and proxies "/api/*" to the Fastify server (tsx watch) on 127.0.0.1:5174.
// Topology B (npm run start): Vite is NOT used; Fastify alone serves the
// compiled SPA bundle from dist/client/ on CHAT_UI_PORT (default 5173).
//
// See docs/design/project-design.md §14.2 / §14.11.
export default defineConfig({
  root: "./client",
  plugins: [preact()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5174",
        changeOrigin: false,
        ws: false,
      },
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
});
