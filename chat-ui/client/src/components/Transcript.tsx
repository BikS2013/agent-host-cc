/**
 * Transcript — renders the `messages` signal as a list of role-tagged bubbles.
 *
 * Performance contract (Investigation rec 6.A): each message carries a NESTED
 * `content` signal. We render each bubble as its own child component that
 * subscribes to `msg.content.value`, so a streaming token append re-renders
 * only that one bubble — never the whole list.
 *
 * Switch banners: messages with `kind === "switch-banner"` are rendered with
 * a system-styled row. They are NOT forwarded to the upstream by the composer
 * (Coder B's `sendMessage` action is responsible for that filter).
 */

import { h, Fragment } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { messages, streamingMessageId, type Message } from "../state";

interface BubbleProps {
  msg: Message;
  isStreaming: boolean;
}

/**
 * Switch banners are stored as `role: "system"` messages whose content
 * starts with "— switched to profile" (per `state.ts` / FU-10). We detect
 * them by that prefix so they render with a distinct style.
 */
function isSwitchBanner(msg: Message): boolean {
  return (
    msg.role === "system" &&
    msg.content.value.startsWith("— switched to profile")
  );
}

function Bubble({ msg, isStreaming }: BubbleProps) {
  // Read the nested content signal here so this child re-renders on delta,
  // but the parent <Transcript /> does not.
  const text = msg.content.value;

  if (isSwitchBanner(msg)) {
    return (
      <div class="message message--system message--banner" role="status">
        <span class="message__content">{text}</span>
      </div>
    );
  }

  const roleClass =
    msg.role === "user"
      ? "message--user"
      : msg.role === "assistant"
        ? "message--assistant"
        : "message--system";

  return (
    <div class={`message ${roleClass}`} data-message-id={msg.id}>
      <div class="message__role">{msg.role}</div>
      <div class="message__content">
        {text}
        {isStreaming && <span class="cursor" aria-hidden="true">|</span>}
      </div>
    </div>
  );
}

export function Transcript() {
  const list = messages.value;
  const streamingId = streamingMessageId.value;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on list-length change. Per-token growth of the active bubble
  // is handled by a second effect below that re-runs when the streaming
  // bubble's content changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [list.length]);

  // Track the streaming bubble's content length so we keep the view pinned to
  // the bottom while tokens arrive. Reading `.value` inside the effect body
  // creates a subscription, but we want a reactive trigger — so we read the
  // current length explicitly into the dependency array.
  const streamingMsg =
    streamingId !== null ? list.find((m) => m.id === streamingId) : null;
  const streamingLen =
    streamingMsg !== null && streamingMsg !== undefined
      ? (streamingMsg.content.value as string).length
      : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamingLen]);

  return (
    <div class="transcript" ref={scrollRef}>
      {list.length === 0 ? (
        <div class="transcript__empty">
          Pick a profile and start chatting.
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
  );
}
