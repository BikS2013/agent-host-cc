// Unit tests for server/config.ts
//
// Tests cover: CHAT_UI_PORT parsing and default, CHAT_UI_PROFILES_PATH override,
// ConfigurationError on invalid port, and the bootstrapConfigDir function.
// process.env is never mutated directly — all tests pass a typed env map to
// loadServerConfig. This prevents cross-test pollution.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadServerConfig, bootstrapConfigDir } from "../../server/config.js";
import { ConfigurationError } from "../../server/errors.js";

// ---------------------------------------------------------------------------
// CHAT_UI_PORT
// ---------------------------------------------------------------------------

describe("loadServerConfig — CHAT_UI_PORT", () => {
  it("returns default port 5173 when CHAT_UI_PORT is not set", () => {
    const cfg = loadServerConfig({});
    expect(cfg.port).toBe(5173);
  });

  it("returns default port 5173 when CHAT_UI_PORT is an empty string", () => {
    const cfg = loadServerConfig({ CHAT_UI_PORT: "" });
    expect(cfg.port).toBe(5173);
  });

  it("parses CHAT_UI_PORT to an integer when set to '3000'", () => {
    const cfg = loadServerConfig({ CHAT_UI_PORT: "3000" });
    expect(cfg.port).toBe(3000);
  });

  it("parses CHAT_UI_PORT=0 (OS-assigned port)", () => {
    const cfg = loadServerConfig({ CHAT_UI_PORT: "0" });
    expect(cfg.port).toBe(0);
  });

  it("parses CHAT_UI_PORT=65535 (maximum valid port)", () => {
    const cfg = loadServerConfig({ CHAT_UI_PORT: "65535" });
    expect(cfg.port).toBe(65535);
  });

  it("throws ConfigurationError when CHAT_UI_PORT is a non-integer", () => {
    expect(() => loadServerConfig({ CHAT_UI_PORT: "abc" })).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError when CHAT_UI_PORT is a float", () => {
    expect(() => loadServerConfig({ CHAT_UI_PORT: "3000.5" })).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError when CHAT_UI_PORT is out of range (negative)", () => {
    expect(() => loadServerConfig({ CHAT_UI_PORT: "-1" })).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError when CHAT_UI_PORT is out of range (>65535)", () => {
    expect(() => loadServerConfig({ CHAT_UI_PORT: "65536" })).toThrow(ConfigurationError);
  });

  it("ConfigurationError carries the correct varName for CHAT_UI_PORT", () => {
    try {
      loadServerConfig({ CHAT_UI_PORT: "not-a-number" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      expect((err as ConfigurationError).varName).toBe("CHAT_UI_PORT");
    }
  });
});

// ---------------------------------------------------------------------------
// Host binding
// ---------------------------------------------------------------------------

describe("loadServerConfig — host", () => {
  it("always returns host as '127.0.0.1'", () => {
    const cfg = loadServerConfig({});
    expect(cfg.host).toBe("127.0.0.1");
  });
});

// ---------------------------------------------------------------------------
// CHAT_UI_PROFILES_PATH override
// ---------------------------------------------------------------------------

describe("loadServerConfig — CHAT_UI_PROFILES_PATH", () => {
  it("uses ~/.agent-host-cc/chat-ui/profiles.json when env var is not set", () => {
    const cfg = loadServerConfig({});
    expect(cfg.profilesPath).toContain("profiles.json");
    expect(cfg.configDir).toContain(".agent-host-cc");
  });

  it("honors CHAT_UI_PROFILES_PATH when set to an absolute path", () => {
    const override = "/tmp/custom-profiles.json";
    const cfg = loadServerConfig({ CHAT_UI_PROFILES_PATH: override });
    expect(cfg.profilesPath).toBe(override);
  });

  it("derives configDir as the parent directory of the overridden profilesPath", () => {
    const override = "/tmp/subdir/profiles.json";
    const cfg = loadServerConfig({ CHAT_UI_PROFILES_PATH: override });
    expect(cfg.configDir).toBe("/tmp/subdir");
  });

  it("CHAT_UI_PROFILES_PATH empty string falls back to default path", () => {
    const cfg = loadServerConfig({ CHAT_UI_PROFILES_PATH: "" });
    expect(cfg.profilesPath).toContain("profiles.json");
    expect(cfg.profilesPath).toContain(".agent-host-cc");
  });
});

// ---------------------------------------------------------------------------
// CHAT_UI_SERVE_STATIC
// ---------------------------------------------------------------------------

describe("loadServerConfig — CHAT_UI_SERVE_STATIC", () => {
  it("returns serveStatic=true when env var is 'true'", () => {
    const cfg = loadServerConfig({ CHAT_UI_SERVE_STATIC: "true" });
    expect(cfg.serveStatic).toBe(true);
  });

  it("returns serveStatic=false when env var is 'false'", () => {
    const cfg = loadServerConfig({ CHAT_UI_SERVE_STATIC: "false" });
    expect(cfg.serveStatic).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bootstrapConfigDir — filesystem integration (uses real temp dir)
// ---------------------------------------------------------------------------

describe("bootstrapConfigDir — filesystem integration", () => {
  let tmpDir: string;
  let profilesPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-ui-config-test-"));
    profilesPath = path.join(tmpDir, "sub", "profiles.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the config directory when it does not exist", () => {
    const configDir = path.join(tmpDir, "sub");
    bootstrapConfigDir({ configDir, profilesPath }, () => undefined);
    expect(fs.existsSync(configDir)).toBe(true);
  });

  it("created config directory has mode 0700", () => {
    const configDir = path.join(tmpDir, "sub");
    bootstrapConfigDir({ configDir, profilesPath }, () => undefined);
    const stat = fs.statSync(configDir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("creates profiles.json with mode 0600", () => {
    const configDir = path.join(tmpDir, "sub");
    bootstrapConfigDir({ configDir, profilesPath }, () => undefined);
    const stat = fs.statSync(profilesPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("profiles.json contains the empty document shape", () => {
    const configDir = path.join(tmpDir, "sub");
    bootstrapConfigDir({ configDir, profilesPath }, () => undefined);
    const raw = fs.readFileSync(profilesPath, "utf8");
    const parsed = JSON.parse(raw) as { activeProfileId: unknown; profiles: unknown[] };
    expect(parsed.activeProfileId).toBeNull();
    expect(parsed.profiles).toEqual([]);
  });

  it("does not overwrite an existing profiles.json", () => {
    const configDir = path.join(tmpDir, "sub");
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const sentinel = JSON.stringify({ activeProfileId: null, profiles: [], sentinel: true });
    fs.writeFileSync(profilesPath, sentinel, { mode: 0o600 });

    bootstrapConfigDir({ configDir, profilesPath }, () => undefined);

    const raw = fs.readFileSync(profilesPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["sentinel"]).toBe(true);
  });

  it("calls the warn callback when directory mode is not 0700", () => {
    const configDir = path.join(tmpDir, "sub");
    fs.mkdirSync(configDir, { recursive: true, mode: 0o755 });

    const warnings: string[] = [];
    bootstrapConfigDir(
      { configDir, profilesPath },
      (msg) => warnings.push(msg),
    );

    // A warning should be emitted about the loose directory permissions
    expect(warnings.some((w) => w.includes(configDir))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression guard: no new required env vars silently default
// ---------------------------------------------------------------------------

describe("loadServerConfig — no-fallback regression guard", () => {
  it("returns a complete ServerConfig even with an empty env, relying only on authorised defaults", () => {
    // This test ensures that calling loadServerConfig({}) does NOT throw.
    // All fields that appear in the returned config must come from:
    //   1. Authorised defaults (CHAT_UI_PORT=5173, openai.baseUrl='https://api.openai.com')
    //   2. Computed values (configDir, profilesPath, serveStatic, staticDir)
    // If a future required env var is added without a test, this test will
    // silently pass — but the ConfigurationError tests above serve as the guard.
    expect(() => loadServerConfig({})).not.toThrow();
    const cfg = loadServerConfig({});
    // Structural sanity on returned object
    expect(typeof cfg.port).toBe("number");
    expect(cfg.host).toBe("127.0.0.1");
    expect(typeof cfg.configDir).toBe("string");
    expect(typeof cfg.profilesPath).toBe("string");
    expect(typeof cfg.serveStatic).toBe("boolean");
    expect(typeof cfg.staticDir).toBe("string");
  });
});
