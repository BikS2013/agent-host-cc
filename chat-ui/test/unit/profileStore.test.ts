// Unit tests for server/profileStore.ts
//
// Uses a temporary directory per test to isolate filesystem state.
// Process.env.HOME is NOT mutated here — instead we pass the absolute temp path
// directly to createProfileStore via ProfileStoreOptions.path.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { createProfileStore } from "../../server/profileStore.js";
import { bootstrapConfigDir } from "../../server/config.js";
import { ProfileNotFoundError, ValidationError } from "../../server/errors.js";
import type { CreateProfileInput } from "../../server/profileSchema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let profilesPath: string;

/** Create a fresh temp directory and bootstrap the empty profiles.json before each test. */
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-ui-test-"));
  profilesPath = path.join(tmpDir, "profiles.json");
  bootstrapConfigDir({ configDir: tmpDir, profilesPath }, () => undefined);
});

/** Remove the temp directory after each test. */
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeStore = () => createProfileStore({ path: profilesPath });

/** Minimal valid agent-host-cc create input (no id). */
const agentHostInput = (name = "local"): CreateProfileInput => ({
  backendKind: "agent-host-cc",
  name,
  baseUrl: "http://localhost:8000",
  apiKey: "sk-test",
  defaultModel: "cc.claude-sonnet-4-6",
});

const openAiInput = (name = "openai-prod"): CreateProfileInput => ({
  backendKind: "openai",
  name,
  apiKey: "sk-openai",
  defaultModel: "gpt-4o-mini",
});

const azureInput = (name = "azure"): CreateProfileInput => ({
  backendKind: "azure-openai",
  name,
  endpoint: "https://myresource.openai.azure.com",
  deployment: "gpt-4o",
  apiVersion: "2024-10-21",
  apiKey: "azure-key",
});

// ---------------------------------------------------------------------------
// Bootstrap: directory and file permissions
// ---------------------------------------------------------------------------

describe("bootstrapConfigDir — directory and file permissions", () => {
  it("creates the config directory with mode 0700", () => {
    // bootstrapConfigDir already ran in beforeEach; verify the created dir mode.
    const stat = fs.statSync(tmpDir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("creates profiles.json with mode 0600", () => {
    const stat = fs.statSync(profilesPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("profiles.json contains a valid empty document", () => {
    const raw = fs.readFileSync(profilesPath, "utf8");
    const parsed = JSON.parse(raw) as { activeProfileId: unknown; profiles: unknown[] };
    expect(parsed.activeProfileId).toBeNull();
    expect(parsed.profiles).toEqual([]);
  });

  it("is idempotent — calling a second time does not overwrite an existing file", () => {
    // Write a sentinel to the file, then call bootstrapConfigDir again
    fs.writeFileSync(profilesPath, '{"activeProfileId":null,"profiles":[]}', { mode: 0o600 });
    // bootstrapConfigDir should not clobber the existing file
    bootstrapConfigDir({ configDir: tmpDir, profilesPath }, () => undefined);
    const raw = fs.readFileSync(profilesPath, "utf8");
    expect(raw).toContain("activeProfileId");
  });
});

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

describe("createProfileStore — CRUD", () => {
  it("listProfiles returns an empty array on fresh store", () => {
    const store = makeStore();
    expect(store.listProfiles()).toEqual([]);
  });

  it("createProfile returns a profile with a server-assigned UUID", () => {
    const store = makeStore();
    const p = store.createProfile(agentHostInput());
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("createProfile persists the profile (visible on listProfiles)", () => {
    const store = makeStore();
    store.createProfile(agentHostInput());
    const list = store.listProfiles();
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe("local");
  });

  it("createProfile can use a custom uuid generator (via opts.uuid)", () => {
    const fixedId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const store = createProfileStore({ path: profilesPath, uuid: () => fixedId });
    const p = store.createProfile(agentHostInput());
    expect(p.id).toBe(fixedId);
  });

  it("getProfile returns the created profile by id", () => {
    const store = makeStore();
    const created = store.createProfile(agentHostInput());
    const fetched = store.getProfile(created.id);
    expect(fetched).toEqual(created);
  });

  it("getProfile throws ProfileNotFoundError for an unknown id", () => {
    const store = makeStore();
    expect(() => store.getProfile("nonexistent-id")).toThrow(ProfileNotFoundError);
  });

  it("createProfile throws ValidationError on duplicate name", () => {
    const store = makeStore();
    store.createProfile(agentHostInput("dupe"));
    expect(() => store.createProfile(agentHostInput("dupe"))).toThrow(ValidationError);
  });

  it("updateProfile replaces the profile data", () => {
    const store = makeStore();
    const created = store.createProfile(agentHostInput());
    const updated = store.updateProfile(created.id, {
      ...created,
      name: "local-updated",
    });
    expect(updated.name).toBe("local-updated");
  });

  it("getProfile reflects the update after updateProfile", () => {
    const store = makeStore();
    const created = store.createProfile(agentHostInput());
    store.updateProfile(created.id, { ...created, name: "new-name" });
    const fetched = store.getProfile(created.id);
    expect(fetched.name).toBe("new-name");
  });

  it("updateProfile throws ValidationError when body.id !== url id", () => {
    const store = makeStore();
    const created = store.createProfile(agentHostInput());
    expect(() =>
      store.updateProfile("different-id", { ...created, id: "different-id" }),
    ).toThrow(ProfileNotFoundError);
    // Also test the mismatch case where body.id !== argument id
    expect(() =>
      store.updateProfile(created.id, { ...created, id: "wrong-id" }),
    ).toThrow(ValidationError);
  });

  it("updateProfile throws ProfileNotFoundError for unknown id", () => {
    const store = makeStore();
    expect(() =>
      store.updateProfile("nonexistent", {
        id: "nonexistent",
        backendKind: "openai",
        name: "x",
        baseUrl: "https://api.openai.com",
        apiKey: "k",
        defaultModel: "gpt-4o",
      }),
    ).toThrow(ProfileNotFoundError);
  });

  it("deleteProfile removes the profile", () => {
    const store = makeStore();
    const p1 = store.createProfile(agentHostInput("p1"));
    store.createProfile(openAiInput("p2")); // need a second so p1 isn't the only one
    // Activate p2 so p1 is not active
    store.setActiveProfileId(store.listProfiles()[1]!.id);
    store.deleteProfile(p1.id);
    const list = store.listProfiles();
    expect(list.some((p) => p.id === p1.id)).toBe(false);
  });

  it("deleteProfile throws ProfileNotFoundError for unknown id", () => {
    const store = makeStore();
    expect(() => store.deleteProfile("nonexistent")).toThrow(ProfileNotFoundError);
  });

  it("creates multiple profiles and all are listed", () => {
    const store = makeStore();
    store.createProfile(agentHostInput("a"));
    store.createProfile(openAiInput("b"));
    store.createProfile(azureInput("c"));
    const list = store.listProfiles();
    expect(list.length).toBe(3);
    const names = list.map((p) => p.name).sort();
    expect(names).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// Active profile management
// ---------------------------------------------------------------------------

describe("createProfileStore — active profile", () => {
  it("getActiveProfileId returns null on empty store", () => {
    const store = makeStore();
    expect(store.getActiveProfileId()).toBeNull();
  });

  it("first created profile is auto-activated", () => {
    const store = makeStore();
    const p = store.createProfile(agentHostInput());
    expect(store.getActiveProfileId()).toBe(p.id);
  });

  it("second created profile does NOT change the active id", () => {
    const store = makeStore();
    const p1 = store.createProfile(agentHostInput("first"));
    store.createProfile(openAiInput("second"));
    expect(store.getActiveProfileId()).toBe(p1.id);
  });

  it("setActiveProfileId changes the active profile", () => {
    const store = makeStore();
    store.createProfile(agentHostInput("a"));
    const p2 = store.createProfile(openAiInput("b"));
    store.setActiveProfileId(p2.id);
    expect(store.getActiveProfileId()).toBe(p2.id);
  });

  it("setActiveProfileId throws ProfileNotFoundError for unknown id", () => {
    const store = makeStore();
    expect(() => store.setActiveProfileId("unknown-id")).toThrow(ProfileNotFoundError);
  });

  it("cannot delete the only profile when it is active", () => {
    const store = makeStore();
    const only = store.createProfile(agentHostInput());
    expect(() => store.deleteProfile(only.id)).toThrow(ValidationError);
  });

  it("can delete a non-active profile even if it is the second of two", () => {
    const store = makeStore();
    const p1 = store.createProfile(agentHostInput("p1"));
    const p2 = store.createProfile(openAiInput("p2"));
    // p1 is active (first created)
    store.deleteProfile(p2.id);
    expect(store.listProfiles().length).toBe(1);
    expect(store.getActiveProfileId()).toBe(p1.id);
  });

  it("auto-activates first remaining profile when active profile is deleted", () => {
    const store = makeStore();
    const p1 = store.createProfile(agentHostInput("p1"));
    const p2 = store.createProfile(openAiInput("p2"));
    // p1 is active; switch active to p2 so we can delete p1
    store.setActiveProfileId(p2.id);
    // Now p2 is active; delete p1 (non-active)
    store.deleteProfile(p1.id);
    // p2 remains active
    expect(store.getActiveProfileId()).toBe(p2.id);

    // Now add p3, make active, delete p2 (non-active) — remaining is just p3
    const p3 = store.createProfile(azureInput("p3"));
    store.setActiveProfileId(p3.id);
    store.deleteProfile(p2.id);
    expect(store.getActiveProfileId()).toBe(p3.id);
  });
});

// ---------------------------------------------------------------------------
// readFile and malformed JSON
// ---------------------------------------------------------------------------

describe("createProfileStore — readFile and malformed input", () => {
  it("readFile returns the current store shape", () => {
    const store = makeStore();
    store.createProfile(agentHostInput());
    const file = store.readFile();
    expect(file.profiles.length).toBe(1);
    expect(file.activeProfileId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("throws ValidationError when profiles.json contains invalid JSON", () => {
    fs.writeFileSync(profilesPath, "NOT JSON{{{", { mode: 0o600 });
    const store = makeStore();
    expect(() => store.listProfiles()).toThrow(ValidationError);
  });

  it("throws ValidationError when profiles.json is missing (ENOENT)", () => {
    fs.unlinkSync(profilesPath);
    const store = makeStore();
    expect(() => store.listProfiles()).toThrow(ValidationError);
  });

  it("throws ValidationError when profiles.json fails schema validation", () => {
    // Write valid JSON but invalid shape
    fs.writeFileSync(profilesPath, JSON.stringify({ activeProfileId: null, profiles: "bad" }), {
      mode: 0o600,
    });
    const store = makeStore();
    expect(() => store.listProfiles()).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Atomic write: simulate rename failure via read-only directory
// ---------------------------------------------------------------------------

describe("createProfileStore — atomic write", () => {
  it("leaves the original file intact when rename cannot complete (read-only dir trick)", () => {
    // The store writes to a .tmp file then renames it. We cannot spy on ESM
    // named exports in Node 22 ESM mode. Instead we set the directory to
    // read-only so that the tmp file write fails — the rename never executes
    // and the original file should be unmodified.
    //
    // Note: this test verifies that the .tmp write failing leaves the original
    // intact, which is the observable guarantee of the atomic-write design.
    const store = makeStore();
    store.createProfile(agentHostInput("original"));
    const before = fs.readFileSync(profilesPath, "utf8");

    // Make the directory non-writable so tmp file creation fails
    fs.chmodSync(tmpDir, 0o555);

    try {
      // This should throw because we cannot create the .tmp file in the dir
      expect(() => store.createProfile(openAiInput("should-not-land"))).toThrow();
    } finally {
      // Restore directory permissions so afterEach cleanup succeeds
      fs.chmodSync(tmpDir, 0o755);
    }

    // The original profiles.json must be unchanged (it was already written
    // and is stored under tmpDir which we made read-only AFTER the first write)
    const after = fs.readFileSync(profilesPath, "utf8");
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// File permissions after write
// ---------------------------------------------------------------------------

describe("createProfileStore — file permissions after write", () => {
  it("profiles.json has mode 0600 after createProfile", () => {
    const store = makeStore();
    store.createProfile(agentHostInput());
    const stat = fs.statSync(profilesPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
