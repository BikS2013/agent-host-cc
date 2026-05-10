/**
 * App — root layout for the chat-ui SPA.
 *
 * Layout:
 *   - Top bar (title + active profile chip + stop + theme toggle)
 *   - Sidebar (New-chat button + profile list + Manage…)
 *   - Main column (transcript + composer)
 *   - Error banner pinned above the body when lastError != null
 *
 * This component is a pure consumer of Coder B's signal contract from
 * `../state` and never reaches into `../lib/*` or the server directly.
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  activeProfileId,
  clearTranscript,
  lastError,
  profiles,
  stopStreaming,
  streamingMessageId,
} from "../state";
import { ProfileSelector } from "./ProfileSelector";
import { ProfileEditor } from "./ProfileEditor";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";

type Theme = "dark" | "light";

function readInitialTheme(): Theme {
  const stored = (typeof localStorage !== "undefined"
    ? localStorage.getItem("chat-ui.theme")
    : null) as Theme | null;
  if (stored === "dark" || stored === "light") return stored;
  return "dark";
}

export function App() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const error = lastError.value;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("chat-ui.theme", theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const activeId = activeProfileId.value;
  const active = profiles.value.find((p) => p.id === activeId) ?? null;
  const isStreaming = streamingMessageId.value != null;

  return (
    <div class="app">
      <header class="topbar" role="banner">
        <span class="topbar__title">agent-host-cc · chat</span>
        <span class="topbar__spacer" />
        {active != null && (
          <span class="topbar__profile-chip" title={`Profile: ${active.name}`}>
            <span class="topbar__profile-chip-dot" />
            <span>{active.name}</span>
            <span class="topbar__profile-chip-kind">{active.backendKind}</span>
          </span>
        )}
        <button
          type="button"
          class="topbar__stop"
          disabled={!isStreaming}
          onClick={stopStreaming}
          aria-label="Stop streaming"
          title="Stop streaming response"
        >
          ■ Stop
        </button>
        <button
          type="button"
          class="topbar__icon-btn"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "☼" : "☾"}
        </button>
      </header>

      {error !== null && (
        <div class="error-banner" role="alert">
          <span class="error-banner__message">{error}</span>
          <button
            type="button"
            class="error-banner__dismiss"
            onClick={() => {
              lastError.value = null;
            }}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      <div class="app__body">
        <aside class="sidebar" aria-label="Profiles">
          <button
            type="button"
            class="sidebar__new"
            onClick={clearTranscript}
            disabled={isStreaming}
            title="Clear transcript and start a new chat"
          >
            <span aria-hidden="true">＋</span>
            <span>New chat</span>
          </button>
          <ProfileSelector onManage={() => setEditorOpen((v) => !v)} />
        </aside>

        <main class="main" aria-label="Chat">
          <Transcript />
          <Composer />
        </main>
      </div>

      {editorOpen && <ProfileEditor onClose={() => setEditorOpen(false)} />}
    </div>
  );
}
