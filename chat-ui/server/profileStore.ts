// On-disk profile store (~/.agent-host-cc/chat-ui/profiles.json).
//
// Every read re-validates the file against ProfileStoreShapeSchema
// (no in-memory cache) so manual edits are caught immediately. Every
// write goes through tmp + rename for atomicity, and re-applies mode
// 0600 to defeat umask drift.

import { readFileSync, writeFileSync, renameSync, statSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ProfileStoreShapeSchema,
  ProfileSchema,
  REDACTED_API_KEY,
  type Profile,
  type ProfileStoreShape,
  type CreateProfileInput,
  type UpdateProfileInput,
} from "./profileSchema.js";
import { ProfileNotFoundError, ValidationError } from "./errors.js";

export interface ProfileStore {
  /** List all profiles (raw, with real apiKeys). */
  listProfiles(): Profile[];
  /** Get one profile by id. Throws ProfileNotFoundError if absent. */
  getProfile(id: string): Profile;
  /** Create a new profile. Server assigns id. Throws ValidationError on name collision. */
  createProfile(input: CreateProfileInput): Profile;
  /** Update an existing profile. The PUT/<redacted>/'' preserves existing apiKey semantics live in profileRoutes, not here. */
  updateProfile(id: string, next: UpdateProfileInput): Profile;
  /** Delete a profile. Throws ProfileNotFoundError if absent, ValidationError if it's the only profile and is active. */
  deleteProfile(id: string): void;
  /** Get the currently-active profile id, or null if none. */
  getActiveProfileId(): string | null;
  /** Set the active profile id. Throws ProfileNotFoundError if id is unknown. */
  setActiveProfileId(id: string): void;
  /** Re-read and parse the entire on-disk file. */
  readFile(): ProfileStoreShape;
}

export interface ProfileStoreOptions {
  /** Absolute path to profiles.json. */
  path: string;
  /** Optional UUID generator override (for tests). */
  uuid?: () => string;
}

export function createProfileStore(opts: ProfileStoreOptions): ProfileStore {
  const path = opts.path;
  const newId = opts.uuid ?? randomUUID;

  const readFile = (): ProfileStoreShape => {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        // The bootstrap should have created an empty file; if it didn't,
        // fail loudly rather than silently re-bootstrapping.
        throw new ValidationError(`profiles file not found at ${path}`);
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ValidationError(
        `profiles file at ${path} is not valid JSON: ${(err as Error).message}`,
      );
    }
    const result = ProfileStoreShapeSchema.safeParse(parsed);
    if (!result.success) {
      throw new ValidationError(
        `profiles file at ${path} failed schema validation`,
        result.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })),
      );
    }
    return result.data;
  };

  const writeFile = (next: ProfileStoreShape): void => {
    const validated = ProfileStoreShapeSchema.safeParse(next);
    if (!validated.success) {
      throw new ValidationError(
        "refusing to persist invalid profiles document",
        validated.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })),
      );
    }
    const json = JSON.stringify(validated.data, null, 2) + "\n";
    const tmp = path + ".tmp";
    // tmp file gets 0600 explicitly (writeFile honours mode only on create)
    writeFileSync(tmp, json, { mode: 0o600 });
    // rename is atomic on POSIX
    renameSync(tmp, path);
    // Belt-and-braces: re-assert 0600 on the final path (rename preserves mode
    // from tmp, but if a previous file at `path` had different perms set, an
    // unusual filesystem might surprise us).
    try {
      const st = statSync(path);
      if ((st.mode & 0o777) !== 0o600) {
        chmodSync(path, 0o600);
      }
    } catch {
      // ignore
    }
    // Also assert dir mode 0700 if accessible (best-effort)
    try {
      const dir = dirname(path);
      const st = statSync(dir);
      if ((st.mode & 0o777) !== 0o700) {
        chmodSync(dir, 0o700);
      }
    } catch {
      // ignore
    }
  };

  const listProfiles = (): Profile[] => readFile().profiles;

  const getProfile = (id: string): Profile => {
    const file = readFile();
    const found = file.profiles.find((p) => p.id === id);
    if (!found) throw new ProfileNotFoundError(id);
    return found;
  };

  const createProfile = (input: CreateProfileInput): Profile => {
    // Re-parse the input as a CreateProfileInput. (Routes have already done
    // this; doing it here too keeps the store self-defending against bad
    // direct callers.)
    const file = readFile();
    if (file.profiles.some((p) => p.name === input.name)) {
      throw new ValidationError(`Profile name '${input.name}' is already used`);
    }
    const id = newId();
    // The discriminated-union infer on `Profile` makes the spread tricky
    // because each variant has its own field set. We construct via re-parse
    // through ProfileSchema to get a properly-typed Profile.
    const candidate = { id, ...input } as unknown;
    const parsed = ProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ValidationError(
        "profile body failed schema validation",
        parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })),
      );
    }
    const next: ProfileStoreShape = {
      activeProfileId: file.activeProfileId ?? id, // first-ever profile auto-activates
      profiles: [...file.profiles, parsed.data],
    };
    writeFile(next);
    return parsed.data;
  };

  const updateProfile = (id: string, body: UpdateProfileInput): Profile => {
    if (body.id !== id) {
      throw new ValidationError(`profile id in body (${body.id}) must match URL id (${id})`);
    }
    const file = readFile();
    const idx = file.profiles.findIndex((p) => p.id === id);
    if (idx < 0) throw new ProfileNotFoundError(id);

    // Name uniqueness check (excluding the row being updated)
    if (file.profiles.some((p, i) => i !== idx && p.name === body.name)) {
      throw new ValidationError(`Profile name '${body.name}' is already used`);
    }

    // Validate the updated profile against ProfileSchema.
    const parsed = ProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        "profile body failed schema validation",
        parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })),
      );
    }
    const updated = parsed.data;
    const profiles = file.profiles.slice();
    profiles[idx] = updated;
    writeFile({ activeProfileId: file.activeProfileId, profiles });
    return updated;
  };

  const deleteProfile = (id: string): void => {
    const file = readFile();
    const idx = file.profiles.findIndex((p) => p.id === id);
    if (idx < 0) throw new ProfileNotFoundError(id);

    const isActive = file.activeProfileId === id;
    const isOnly = file.profiles.length === 1;
    if (isActive && isOnly) {
      throw new ValidationError(
        "Cannot delete the only profile while it is active. Create another profile first or activate a different one.",
      );
    }

    const remaining = file.profiles.filter((p) => p.id !== id);
    let nextActive: string | null = file.activeProfileId;
    if (isActive) {
      // Auto-activate the first remaining profile
      const first = remaining[0];
      nextActive = first ? first.id : null;
    }
    writeFile({ activeProfileId: nextActive, profiles: remaining });
  };

  const getActiveProfileId = (): string | null => readFile().activeProfileId;

  const setActiveProfileId = (id: string): void => {
    const file = readFile();
    if (!file.profiles.some((p) => p.id === id)) {
      throw new ProfileNotFoundError(id);
    }
    writeFile({ activeProfileId: id, profiles: file.profiles });
  };

  return {
    listProfiles,
    getProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    getActiveProfileId,
    setActiveProfileId,
    readFile,
  };
}

// Helpful type guard re-export so callers can detect the redaction sentinel.
export const isRedactedSentinel = (v: unknown): boolean =>
  v === REDACTED_API_KEY || v === "";

// Avoid unused-import warnings on `join` if a downstream removes the dirname
// usage; keep this no-op reference.
void join;
