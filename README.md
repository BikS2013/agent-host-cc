# agent-host-cc

OpenAI-compatible HTTP host for the Anthropic Claude Code agent, packaged as a single OCI container. Exposes both `POST /v1/chat/completions` and `POST /v1/responses` (streaming and non-streaming) plus `GET /v1/models`, `GET /healthz`, and `GET /files/:chatId/*path`. Drop it behind any OpenAI-SDK-compatible client — Open WebUI, the official `openai` Node/Python SDKs, custom UIs, evaluation harnesses — without coupling your deployment to Azure AI Foundry or to any upstream UI container. Supports the Anthropic public API by default; Azure AI Foundry is opt-in via a single environment variable.

## Quick start

```bash
# 1. Install and build.
cd 
npm install && npm run build

# 2. Configure environment.
cp .env.example .env && chmod 600 .env
#    Then edit .env: set AGENT_HOST_API_KEY (use `openssl rand -hex 32`),
#    ANTHROPIC_API_KEY, MODEL_IDS, FILES_API_BASE_URL, FILES_API_KEY.

# 3. Build the container image.
npm run image:build           # auto-detects docker or Apple `container`
#    Or call a specific runtime:
#      npm run image:build:docker   v1.2.0
#      npm run image:build:apple    v1.2.0

# 4. Run.
npm run image:run             # auto-detects docker or Apple `container`
#    Or call a specific runtime:
#      npm run image:run:docker
#      npm run image:run:apple
#    Background:
#      DETACH=1 npm run image:run

# 5. Smoke-test.
curl -s http://localhost:8000/healthz
#   → {"ok":true}
```

## Documentation

- **Architecture, components, request flow** — `docs/design/project-design.md`.
- **Deploy locally (Docker + Apple container, troubleshooting)** — `docs/how-to/deploy-locally.md`.
- **Connect a client (Open WebUI, OpenAI SDKs, curl)** — `docs/how-to/connect-openai-client.md`.
- **Configuration variables (every knob, defaults, validation matrix)** — `docs/design/configuration-guide.md`.
- **Functional and non-functional requirements** — `docs/design/project-functions.md`.

## License

Proprietary (placeholder — replace with your chosen license before distributing).
