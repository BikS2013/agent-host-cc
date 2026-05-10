/**
 * Composer — text input + Send button.
 *
 * - Enter sends. Shift+Enter inserts a newline.
 * - Disabled when no profile is active OR a stream is in progress.
 * - Placeholder shows the active profile's name when one is selected.
 * - Calls `sendMessage(text)` then clears the textarea.
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import {
  activeProfileId,
  streamingMessageId,
  profiles,
  sendMessage,
} from "../state";

export function Composer() {
  const [text, setText] = useState("");
  const activeId = activeProfileId.value;
  const streaming = streamingMessageId.value !== null;
  const disabled = activeId === null || streaming;

  const activeName =
    activeId !== null
      ? (profiles.value.find((p) => p.id === activeId)?.name ?? "")
      : "";

  const placeholder =
    activeId === null
      ? "Pick a profile to start chatting..."
      : streaming
        ? "Streaming reply..."
        : `Message [${activeName}]...`;

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed === "" || disabled) return;
    setText("");
    try {
      await sendMessage(trimmed);
    } catch {
      // Errors are surfaced via lastError in state.ts; nothing to do here.
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const handleClick = (e: Event) => {
    e.preventDefault();
    void submit();
  };

  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        class="composer__textarea"
        value={text}
        placeholder={placeholder}
        onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={3}
      />
      <button
        type="button"
        class="composer__send"
        onClick={handleClick}
        disabled={disabled || text.trim() === ""}
      >
        Send
      </button>
    </form>
  );
}
