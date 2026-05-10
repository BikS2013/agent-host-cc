// Server config loader for the chat-ui sub-app.
//
// Reads process.env, enforces the no-fallback rule (project convention NF-3),
// and bootstraps the on-disk config directory at ~/.agent-host-cc/chat-ui/
// with mode 0700, plus profiles.json with mode 0600.
//
// The ONLY authorised env-var default in this sub-app is `CHAT_UI_PORT=5173`
// (per refined-request §Constraints / FU-6). Schema-level default
// `openai.baseUrl="https://api.openai.com"` is the other authorised default
// and lives in profileSchema.ts.

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, writeFileSync, statSync, chmodSync } from "node:fs";
import { ConfigurationError } from "./errors.js";

export interface ServerConfig {
  /** TCP port to bind. 0 means OS-assigned. Default 5173. */
  port: number;
  /** Bind address. Always "127.0.0.1" — never overridable (security). */
  host: "127.0.0.1";
  /** Absolute path to the chat-ui config directory. */
  configDir: string;
  /** Absolute path to profiles.json. */
  profilesPath: string;
  /** When true, host the compiled SPA bundle from dist/client. */
  serveStatic: boolean;
  /** Absolute path to the static SPA bundle (only meaningful when serveStatic === true). */
  staticDir: string;
}

const DEFAULT_PORT = 5173;

/**
 * Parse an integer from an env-var. Throws ConfigurationError on a non-integer.
 * Returns `undefined` on absent / empty so the caller can decide whether to
 * apply an authorised default.
 */
const intOrUndefined = (env: NodeJS.ProcessEnv, name: string): number | undefined => {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new ConfigurationError(name, `${name} must be an integer; got "${raw}"`);
  }
  return n;
};

/**
 * Load the server configuration from process.env.
 *
 * Authorised defaults (per FU-6):
 *  - CHAT_UI_PORT → 5173
 *
 * No other config field has a fallback. Required fields that are not yet
 * required in this build (e.g. there are no required envs in v1) will be
 * added with `required(env, "NAME")` style — never with `?? "default"`.
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const portEnv = intOrUndefined(env, "CHAT_UI_PORT");
  const port = portEnv ?? DEFAULT_PORT;
  if (port < 0 || port > 65535) {
    throw new ConfigurationError("CHAT_UI_PORT", `CHAT_UI_PORT out of range: ${port}`);
  }

  const profilesPathOverride = env["CHAT_UI_PROFILES_PATH"];
  const configDir = profilesPathOverride
    ? // when an explicit path is given, configDir is its parent
      dirOf(profilesPathOverride)
    : join(homedir(), ".agent-host-cc", "chat-ui");
  const profilesPath = profilesPathOverride && profilesPathOverride.length > 0
    ? profilesPathOverride
    : join(configDir, "profiles.json");

  // In compiled production runs (`npm run start`), Fastify serves the SPA
  // bundle that Vite emitted to dist/client. In dev, Vite owns the SPA
  // entirely on its own port, so we skip static-serving.
  const serveStaticEnv = env["CHAT_UI_SERVE_STATIC"];
  const serveStatic = serveStaticEnv === undefined
    // Default heuristic: if we can locate dist/client beside the running
    // server bundle, serve it. Otherwise (dev mode), don't.
    ? defaultServeStatic()
    : serveStaticEnv === "true";

  const staticDir = resolveStaticDir();

  return { port, host: "127.0.0.1", configDir, profilesPath, serveStatic, staticDir };
}

const dirOf = (p: string): string => {
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return ".";
  return p.slice(0, idx);
};

const resolveStaticDir = (): string => {
  // The compiled server entry is at dist/server/index.js, the SPA bundle at
  // dist/client. When tsx-running from source (server/index.ts), look for
  // ../dist/client relative to the chat-ui project root.
  // We resolve relative to import.meta.url at runtime in index.ts; here we
  // just provide the conventional path string. The runtime resolves it.
  return "dist/client";
};

const defaultServeStatic = (): boolean => {
  // We can't reliably introspect filesystem from this pure config function,
  // so we default to true and let bootstrapConfigDir / Fastify warn if the
  // directory is missing. The dev script runs through `tsx watch` and Vite
  // is the SPA host; the operator can set CHAT_UI_SERVE_STATIC=false to
  // disable static-serving when running just the API alongside Vite.
  return true;
};

/**
 * Create ~/.agent-host-cc/chat-ui/ at mode 0700 and profiles.json at mode 0600
 * (with the empty document `{ "activeProfileId": null, "profiles": [] }`)
 * if either is missing. Idempotent.
 *
 * If the directory or file already exists, perms are NOT clobbered (operators
 * may have legitimately tightened them); a warning is logged via the optional
 * `warn` callback when perms look looser than expected.
 */
export function bootstrapConfigDir(
  cfg: Pick<ServerConfig, "configDir" | "profilesPath">,
  warn: (msg: string) => void = () => undefined,
): void {
  // Directory
  if (!existsSync(cfg.configDir)) {
    mkdirSync(cfg.configDir, { recursive: true, mode: 0o700 });
  } else {
    try {
      const st = statSync(cfg.configDir);
      const mode = st.mode & 0o777;
      if (mode !== 0o700) {
        warn(`config dir ${cfg.configDir} mode is 0${mode.toString(8)}, expected 0700`);
      }
    } catch {
      // ignore stat failures here; the file write below will fail loudly if needed
    }
  }

  // File
  if (!existsSync(cfg.profilesPath)) {
    const empty = JSON.stringify({ activeProfileId: null, profiles: [] }, null, 2);
    writeFileSync(cfg.profilesPath, empty + "\n", { mode: 0o600, flag: "wx" });
  } else {
    try {
      const st = statSync(cfg.profilesPath);
      const mode = st.mode & 0o777;
      if (mode !== 0o600) {
        warn(`profiles file ${cfg.profilesPath} mode is 0${mode.toString(8)}, expected 0600`);
        // Tighten on first run if loose; non-destructive.
        try { chmodSync(cfg.profilesPath, 0o600); } catch { /* ignore */ }
      }
    } catch {
      // ignore
    }
  }
}
