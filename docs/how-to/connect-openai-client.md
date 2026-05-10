# How To — Connect an OpenAI-Compatible Client to `agent-host-cc`

> **Audience:** Operators who have a running `agent-host-cc` container and want to point a UI, SDK, or script at it.
> **Prerequisite:** A running container reachable on `http://localhost:8000` (or whatever host:port you mapped). See `docs/how-to/deploy-locally.md` to get there.
> **Endpoints exposed:** Both `POST /v1/chat/completions` and `POST /v1/responses` are first-class, equivalent surfaces. Pick whichever your client speaks.

In every example below, `$TOKEN` is the value of `AGENT_HOST_API_KEY` from your `.env` file, and the base URL is `http://localhost:8000/v1`. The bearer token authorises every endpoint except `GET /healthz`.

---

## 1. Open WebUI

Open WebUI talks to OpenAI-compatible servers natively.

1. Open the Open WebUI admin panel.
2. Navigate to **Settings → Admin → Connections → OpenAI**.
3. Add a new connection:
   - **Base URL:** `http://localhost:8000/v1` (or the host-routable address of the container if Open WebUI runs on a different host).
   - **API Key:** the value of `AGENT_HOST_API_KEY`.
4. Save. Open WebUI calls `GET /v1/models` to populate the model picker. Models from `MODEL_IDS` (e.g. `claude-sonnet-4-6`) appear in the model dropdown for new chats.

If Open WebUI is also configured with a `prefix_id` (e.g. `cc`), the model field arrives as `cc.claude-sonnet-4-6`. The service strips `MODEL_PREFIX` (default `cc.`) before validating against `MODEL_IDS`, so this works out of the box.

When Open WebUI sends `files[]` as part of a chat completion, the service resolves each entry against the `FILES_API_BASE_URL` + `FILES_API_PATH_TEMPLATE`. Configure that backend to point at the same Open WebUI instance: `FILES_API_BASE_URL=http://<open-webui-host>:3080`, `FILES_API_PATH_TEMPLATE=/api/v1/files/{id}/content` (the default).

---

## 2. OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="<paste-AGENT_HOST_API_KEY-here>",
)

# --- Chat Completions: streaming ---
stream = client.chat.completions.create(
    model="claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Summarize the OpenAI SSE protocol in one sentence."}],
    stream=True,
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()

# --- Chat Completions: non-streaming ---
result = client.chat.completions.create(
    model="claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Reply with the literal word OK."}],
)
print(result.choices[0].message.content)

# --- Responses API: streaming ---
with client.responses.stream(
    model="claude-sonnet-4-6",
    input="Summarize the OpenAI Responses event sequence in one sentence.",
) as stream:
    for event in stream:
        if event.type == "response.output_text.delta":
            print(event.delta, end="", flush=True)
    print()

# --- Responses API: non-streaming ---
response = client.responses.create(
    model="claude-sonnet-4-6",
    input="Reply with the literal word OK.",
    stream=False,
)
print(response.output_text)
```

### Attachment example (Chat Completions, image as data URL)

```python
import base64, pathlib

img_bytes = pathlib.Path("./diagram.png").read_bytes()
data_url = "data:image/png;base64," + base64.b64encode(img_bytes).decode()

result = client.chat.completions.create(
    model="claude-sonnet-4-6",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Describe this diagram."},
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
    }],
)
print(result.choices[0].message.content)
```

The service base64-decodes the image, writes it to the per-chat workspace under `<WORKSPACE_DIR>/<chatId>/`, and forwards it inline to the SDK as long as it is ≤ `MAX_INLINE_IMAGE_BYTES` (default 20 MB) and the MIME type starts with `image/`. Larger images live on disk and are referenced by a manifest line appended to the user message.

### Attachment example (Responses API, image as `input_image`)

```python
response = client.responses.create(
    model="claude-sonnet-4-6",
    input=[{
        "role": "user",
        "content": [
            {"type": "input_text", "text": "Describe this diagram."},
            {"type": "input_image", "image_url": data_url},
        ],
    }],
    stream=False,
)
print(response.output_text)
```

The Responses path goes through the same attachment processor, so behaviour is identical.

---

## 3. OpenAI Node SDK

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8000/v1",
  apiKey: process.env.AGENT_HOST_API_KEY!,
});

// --- Chat Completions: streaming ---
const chatStream = await client.chat.completions.create({
  model: "claude-sonnet-4-6",
  messages: [{ role: "user", content: "Summarize in one sentence." }],
  stream: true,
});
for await (const chunk of chatStream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
process.stdout.write("\n");

// --- Chat Completions: non-streaming ---
const chatResult = await client.chat.completions.create({
  model: "claude-sonnet-4-6",
  messages: [{ role: "user", content: "Reply with the literal word OK." }],
});
console.log(chatResult.choices[0].message.content);

// --- Responses API: streaming ---
const respStream = await client.responses.create({
  model: "claude-sonnet-4-6",
  input: "Summarize in one sentence.",
  stream: true,
});
for await (const event of respStream) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta);
  }
}
process.stdout.write("\n");

// --- Responses API: non-streaming ---
const respResult = await client.responses.create({
  model: "claude-sonnet-4-6",
  input: "Reply with the literal word OK.",
  stream: false,
});
console.log(respResult.output_text);
```

The shapes match the OpenAI cloud surfaces 1:1 — there is nothing client-specific to configure beyond `baseURL` and `apiKey`.

---

## 4. curl

### `POST /v1/chat/completions` — streaming

```bash
curl -N -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/v1/chat/completions \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Say hello in one word."}],
    "stream": true
  }'
```

Output is a sequence of `data: {…}\n\n` SSE frames followed by `data: [DONE]\n\n`. Each frame is a `chat.completion.chunk` JSON object whose `choices[0].delta.content` carries the next token(s).

### `POST /v1/chat/completions` — non-streaming

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/v1/chat/completions \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Say hello in one word."}],
    "stream": false
  }' | jq .
```

Returns one `chat.completion` JSON object with `choices[0].message.content` and `usage`.

### `POST /v1/responses` — streaming

```bash
curl -N -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/v1/responses \
  -d '{
    "model": "claude-sonnet-4-6",
    "input": "Say hello in one word.",
    "stream": true
  }'
```

Output is the canonical Responses event sequence:

```
event: response.created
data: {...}

event: response.in_progress
data: {...}

event: response.output_item.added
data: {...}

event: response.content_part.added
data: {...}

event: response.output_text.delta
data: {"delta":"Hello",...}
…

event: response.output_text.done
data: {...}

event: response.content_part.done
data: {...}

event: response.output_item.done
data: {...}

event: response.completed
data: {"response":{...,"output":[...],"usage":{...}}}

data: [DONE]
```

### `POST /v1/responses` — non-streaming

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/v1/responses \
  -d '{
    "model": "claude-sonnet-4-6",
    "input": "Say hello in one word.",
    "stream": false
  }' | jq .
```

Returns the aggregated `Response` JSON object — the same body the streaming path sends in its terminal `response.completed` event.

### `GET /v1/models`

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/v1/models | jq .
```

### `GET /healthz` (no auth)

```bash
curl -s http://localhost:8000/healthz
# {"ok":true}
```

---

## 5. Files endpoint — retrieving workspace artifacts

When the agent writes a file into its workspace (e.g. a generated chart, a downloaded artifact, a tool result), it is reachable via `GET /files/:chatId/*path` with bearer auth. The service applies path-traversal protection: `..`, absolute paths, or any resolved path that escapes the chat root yields `400 invalid_request`.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/files/<chatId>/<filename> \
  --output ./downloaded-artifact
```

The `<chatId>` is whichever value you sent as `metadata.chat_id` on the originating chat-completion or responses request. If you omitted `metadata.chat_id`, the service derived a deterministic `auto-<16-hex>` value (silent-default exception #2 — see `CLAUDE.md`); you can find it in the structured log line for the request.

The endpoint streams `application/octet-stream`. Missing files return HTTP 404 (no envelope).

---

## 6. Choosing between Chat Completions and Responses

Both endpoints are first-class and share the same runner, attachment processor, workspace, and configuration loader. The differences are at the wire level only.

| Aspect | `/v1/chat/completions` | `/v1/responses` |
|---|---|---|
| Request shape | `messages: [{role, content}]` (content is string OR `[ContentPart]`). | `input` is a string OR `[InputMessage]`; content parts use `input_text` / `input_image`. |
| Streaming wire format | A flat stream of `chat.completion.chunk` JSON frames, each carrying a `choices[0].delta.content` token; terminator `data: [DONE]\n\n`. | A canonical envelope: `response.created` → `response.in_progress` → `response.output_item.added` → `response.content_part.added` → repeated `response.output_text.delta` → `response.output_text.done` → `response.content_part.done` → `response.output_item.done` → `response.completed` → terminator `data: [DONE]\n\n`. |
| Non-streaming response | `chat.completion` JSON with `choices[0].message.content` + `usage`. | `Response` JSON with `output:[…]`, `status:"completed"`, `usage`. |
| Tool-use rendering | Italic markdown `\n\n*[<tool>: <truncated_input>]*\n` inserted into `delta.content`. | Italic markdown delivered as another `response.output_text.delta` on the same item. (The `RESPONSES_TOOL_USE_RENDERING=item` mode is reserved for a future plan.) |
| `stream` default | `false` (per OpenAI Chat Completions convention). | `true` (per OpenAI Responses convention). |
| Attachment surface | `image_url` content parts; data URLs and remote URLs supported. | `input_image` content parts; same data URL / remote URL handling. |
| `files[]` extension | Supported. | Supported. |
| `metadata.chat_id` | Supported. | Supported. |

**Rule of thumb:** if your client is new and you control the wire format, prefer `/v1/responses` — it carries richer envelope structure, distinguishes content parts and items, and is the surface OpenAI is investing in going forward. If your client is an existing OpenAI-SDK consumer or a UI like Open WebUI that already speaks Chat Completions, `/v1/chat/completions` is the path of least resistance and produces identical agent behavior.

Both endpoints share the same `MODEL_IDS`, the same `MODEL_PREFIX` stripping, the same `AGENT_HOST_API_KEY` bearer auth, the same per-chat workspace, and the same `FILES_API_*` resolution. There is no operational reason to enable one and disable the other.

---

## 7. Cross-references

- Configuration: `docs/design/configuration-guide.md`.
- Local deployment: `docs/how-to/deploy-locally.md`.
- Wire-level architecture: `docs/design/project-design.md` §5 (HTTP API contracts).
