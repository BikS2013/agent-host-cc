/**
 * Composer — auto-grow text input + Send button.
 *
 * - Enter sends. Shift+Enter inserts a newline.
 * - Disabled when no profile is active OR a stream is in progress.
 * - Placeholder shows the active profile's name when one is selected.
 * - Auto-grows up to max-height (capped via CSS); collapses on send.
 */

import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  activeProfileId,
  streamingMessageId,
  profiles,
  sendMessage,
} from "../state";

export function Composer() {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const activeId = activeProfileId.value;
  const streaming = streamingMessageId.value !== null;
  const disabled = activeId === null || streaming;

  const activeName =
    activeId !== null
      ? (profiles.value.find((p) => p.id === activeId)?.name ?? "")
      : "";

  const placeholder =
    activeId === null
      ? "Pick a profile to start chatting…"
      : streaming
        ? "Streaming reply…"
        : `Message ${activeName}…`;

  // Auto-grow: reset to auto so scrollHeight is the natural content height,
  // then clamp to max via CSS max-height.
  useEffect(() => {
    const el = taRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed === "" || disabled) return;
    setText("");
    if (taRef.current !== null) taRef.current.style.height = "auto";
    try {
      await sendMessage(trimmed);
    } catch {
      // Errors surfaced via lastError in state.ts; nothing to do here.
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div>
      <form
        class="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div class="composer__inner">
          <textarea
            ref={taRef}
            class="composer__textarea"
            value={text}
            placeholder={placeholder}
            onInput={(e) =>
              setText((e.currentTarget as HTMLTextAreaElement).value)
            }
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            aria-label="Message input"
          />
          <button
            type="submit"
            class="composer__send"
            disabled={disabled || text.trim() === ""}
            aria-label="Send message"
            title="Send (Enter)"
          >
            ↑
          </button>
        </div>
        <div class="composer__hint">
          {streaming
            ? "Streaming — press Stop in the top bar to cancel."
            : "Enter to send · Shift+Enter for newline"}
        </div>
      </form>
    </div>
  );
}
