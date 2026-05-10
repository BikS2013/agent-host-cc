/**
 * ProfileSelector — active-profile dropdown plus a "Manage profiles..." toggle.
 *
 * - Bound to `activeProfileId` from `../state`.
 * - On change, calls `selectProfile(newId)` (Coder B's action; that action is
 *   responsible for inserting the FU-10 switch banner into `messages`).
 * - The selector is disabled while a stream is in progress so the user does
 *   NOT swap backends mid-stream (the inflight request would still complete on
 *   the previous profile, but switching mid-stream is a footgun for users).
 * - Each option shows the profile name plus its `backendKind` as a tag.
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

  const handleChange = (e: Event) => {
    const target = e.currentTarget as HTMLSelectElement;
    const value = target.value;
    if (value === "") return;
    void selectProfile(value);
  };

  return (
    <div class="profile-selector">
      <label class="profile-selector__label" for="profile-selector-dropdown">
        Active profile
      </label>

      <select
        id="profile-selector-dropdown"
        class="profile-selector__dropdown"
        value={activeId ?? ""}
        onChange={handleChange}
        disabled={streaming || list.length === 0}
      >
        {list.length === 0 && (
          <option value="">(no profiles — create one)</option>
        )}
        {list.length > 0 && activeId === null && (
          <option value="">(pick a profile)</option>
        )}
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} [{p.backendKind}]
          </option>
        ))}
      </select>

      {streaming && (
        <div class="profile-selector__streaming-note">
          Streaming in progress — switch disabled.
        </div>
      )}

      <button
        type="button"
        class="profile-selector__manage"
        onClick={onManage}
      >
        Manage profiles...
      </button>
    </div>
  );
}
