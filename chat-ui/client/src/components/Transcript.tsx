/**
 * Transcript — renders the `messages` signal as a list of role-tagged bubbles.
 *
 * Performance contract (Investigation rec 6.A): each message carries a NESTED
 * `content` signal. Each bubble is its own child component that subscribes to
 * `msg.content.value`, so a streaming token append re-renders only that one
 * bubble — never the whole list.
 *
 * Assistant messages are rendered through `marked` (markdown → HTML). User
 * messages stay as plain text so a stray "*" doesn't accidentally render as
 * bold. Switch banners (role: "system", content prefixed with the FU-10
 * sentinel) render as compact inline pills.
 *
 * Streaming markdown can contain unclosed fences. We pass the text through
 * `marked` as-is; `marked` is lenient and renders partial blocks gracefully.
 */

import { h, Fragment } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { marked } from "marked";
import {
  activeProfileId,
  messages,
  profiles,
  sendMessage,
  streamingMessageId,
  type Message,
} from "../state";

const STARTERS: { label: string; prompt: string }[] = [
  { label: "Explain a concept", prompt: "Explain how SSE streaming works in plain language." },
  { label: "Write code", prompt: "Write a TypeScript function that debounces another function." },
  { label: "Plan a task", prompt: "Help me plan a refactor of a Fastify route handler." },
  { label: "Summarise", prompt: "Summarise the key differences between WebSockets and Server-Sent Events." },
];

function isSwitchBanner(msg: Message): boolean {
  return (
    msg.role === "system" &&
    msg.content.value.startsWith("— switched to profile")
  );
}

function renderMarkdown(text: string): string {
  // `marked.parse` with sync option returns a string. Configure once per call
  // (cheap). GFM gives us fenced code blocks, tables, autolinks.
  return marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
}

interface BubbleProps {
  msg: Message;
  isStreaming: boolean;
}

function Bubble({ msg, isStreaming }: BubbleProps) {
  const text = msg.content.value;

  if (isSwitchBanner(msg)) {
    return (
      <div class="message message--banner" role="status">
        <span class="message__content">{text}</span>
      </div>
    );
  }

  if (msg.role === "user") {
    return (
      <div class="message message--user" data-message-id={msg.id}>
        <div class="message__content">{text}</div>
      </div>
    );
  }

  if (msg.role === "assistant") {
    // Render markdown for assistant output. We append the streaming cursor
    // AFTER the rendered HTML so unclosed blocks don't swallow it.
    const html = renderMarkdown(text);
    return (
      <div class="message message--assistant" data-message-id={msg.id}>
        <div class="message__role">Assistant</div>
        <div
          class="message__content"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {isStreaming && (
          <span class="cursor" aria-hidden="true" />
        )}
      </div>
    );
  }

  // Other system messages (not switch banners) — render as plain text rows.
  return (
    <div class="message message--system" data-message-id={msg.id}>
      <div class="message__role">System</div>
      <div class="message__content">{text}</div>
    </div>
  );
}

export function Transcript() {
  const list = messages.value;
  const streamingId = streamingMessageId.value;
  const activeId = activeProfileId.value;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [list.length]);

  const streamingMsg =
    streamingId !== null ? list.find((m) => m.id === streamingId) : null;
  const streamingLen =
    streamingMsg !== null && streamingMsg !== undefined
      ? (streamingMsg.content.value as string).length
      : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [streamingLen]);

  const activeName = useMemo(() => {
    if (activeId === null) return null;
    return profiles.value.find((p) => p.id === activeId)?.name ?? null;
  }, [activeId, profiles.value]);

  const isEmpty = list.length === 0;

  return (
    <div class="transcript" ref={scrollRef}>
      <div class="transcript__inner">
        {isEmpty ? (
          <div class="transcript__empty">
            <div>
              <div class="transcript__empty-title">
                {activeName !== null ? `Chat with ${activeName}` : "Set up a profile to start"}
              </div>
              <div class="transcript__empty-subtitle">
                {activeId === null
                  ? "Open “Manage profiles…” in the sidebar to add an OpenAI, Azure, or agent-host-cc backend."
                  : "Pick a prompt below, or type your own."}
              </div>
            </div>
            {activeId !== null && (
              <div class="transcript__starters">
                {STARTERS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    class="transcript__starter"
                    onClick={() => void sendMessage(s.prompt)}
                  >
                    <strong style={{ display: "block", marginBottom: 4, color: "var(--fg)" }}>
                      {s.label}
                    </strong>
                    {s.prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Fragment>
            {list.map((msg) => (
              <Bubble
                key={msg.id}
                msg={msg}
                isStreaming={msg.id === streamingId}
              />
            ))}
          </Fragment>
        )}
      </div>
    </div>
  );
}
