/**
 * ProfileSelector — sidebar list of profiles with click-to-activate behavior.
 *
 * - Each profile renders as a row: status dot + name + kind badge.
 * - The active profile is highlighted via `.is-active`.
 * - Clicking a non-active profile calls `selectProfile(id)`; the action is
 *   responsible for inserting the FU-10 switch banner into `messages`.
 * - The whole list is disabled while a stream is in progress so users don't
 *   swap backends mid-stream (a footgun).
 * - A "Manage profiles…" button is pinned to the bottom (CSS auto-margin).
 */

import { h } from "preact";
import {
  profiles,
  activeProfileId,
  streamingMessageId,
  selectProfile,
} from "../state";

interface Props {
  onManage: () => void;
}

export function ProfileSelector({ onManage }: Props) {
  const list = profiles.value;
  const activeId = activeProfileId.value;
  const streaming = streamingMessageId.value !== null;

  return (
    <>
      <div class="sidebar__heading">Profiles</div>

      {list.length === 0 && (
        <button
          type="button"
          class="sidebar__profile"
          onClick={onManage}
          title="No profiles yet — click to create one"
        >
          <span class="sidebar__profile-dot" />
          <span class="sidebar__profile-name">No profiles yet</span>
        </button>
      )}

      {list.map((p) => {
        const isActive = p.id === activeId;
        const classes = isActive ? "sidebar__profile is-active" : "sidebar__profile";
        return (
          <button
            key={p.id}
            type="button"
            class={classes}
            disabled={streaming && !isActive}
            onClick={() => {
              if (!isActive) void selectProfile(p.id);
            }}
            title={`${p.name} (${p.backendKind})`}
          >
            <span class="sidebar__profile-dot" />
            <span class="sidebar__profile-name">{p.name}</span>
            <span class="sidebar__profile-kind">{p.backendKind}</span>
          </button>
        );
      })}

      {streaming && (
        <div class="sidebar__streaming-note">Streaming — switch disabled</div>
      )}

      <button type="button" class="sidebar__manage" onClick={onManage}>
        Manage profiles…
      </button>
    </>
  );
}
