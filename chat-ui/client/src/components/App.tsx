/**
 * App — root layout for the chat-ui SPA.
 *
 * Two-column layout: a sidebar containing the profile selector + manage toggle,
 * and a main panel containing the transcript and the composer. An error banner
 * is pinned to the top whenever `lastError.value` is non-null.
 *
 * This component is a pure consumer of Coder B's signal contract from
 * `../state` and never reaches into `../lib/*` or the server directly.
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import { lastError } from "../state";
import { ProfileSelector } from "./ProfileSelector";
import { ProfileEditor } from "./ProfileEditor";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";

export function App() {
  const [editorOpen, setEditorOpen] = useState(false);
  const error = lastError.value;

  return (
    <div class="app">
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
            x
          </button>
        </div>
      )}

      <div class="app__body">
        <aside class="sidebar">
          <ProfileSelector onManage={() => setEditorOpen((v) => !v)} />
        </aside>

        <main class="main">
          <Transcript />
          <Composer />
        </main>
      </div>

      {editorOpen && (
        <ProfileEditor onClose={() => setEditorOpen(false)} />
      )}
    </div>
  );
}
