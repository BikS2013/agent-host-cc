---
status: deprecations_found
mode: fix
package_manager: npm@11.12.1
ecosystem: node
iterations_run: 1
deprecations_initial: 0
deprecations_final: 0
vulnerabilities_initial: 7
vulnerabilities_final: 7
target_path: /Users/giorgosmarinos/aiwork/agent-host-cc
validated_at: 2026-05-10T15:37:18Z
last_validated_commit: null
---

# Dependency Validation — agent-host-cc

## 1. Summary

The project uses npm with 191 installed packages (191 audited). No deprecation warnings were emitted during `npm install`. The security audit found **7 moderate-severity vulnerabilities** across two independent advisory chains — one rooted in a transitive `@anthropic-ai/sdk` advisory pulled via the direct `@anthropic-ai/claude-agent-sdk` dependency, and one rooted in `vite`/`esbuild` advisories pulled via the direct `vitest` dependency. Both fix paths require **major version migrations** and therefore cannot be auto-applied per the invariant rules of this agent. No replacements were applied; both chains are flagged for manual review.

---

## 2. Initial State

### 2a. Deprecation Warnings

None. `npm install` produced zero `npm warn deprecated` lines on this run.

### 2b. Outdated Packages (direct deps with major-version newer releases)

| Package | Current | Wanted (range) | Latest | Scope | Delta |
|---|---|---|---|---|---|
| `@types/node` | 22.19.18 | 22.19.18 | 25.6.2 | devDependency | +3 major |
| `pino` | 9.14.0 | 9.14.0 | 10.3.1 | dependency | +1 major |
| `typescript` | 5.9.3 | 5.9.3 | 6.0.3 | devDependency | +1 major |
| `undici` | 6.25.0 | 6.25.0 | 8.2.0 | dependency | +2 major |
| `vitest` | 2.1.9 | 2.1.9 | 4.1.5 | devDependency | +2 major |

All currently-installed versions are at the latest release within the declared semver range in `package.json`. No package is behind within its pinned major.

### 2c. Security Vulnerabilities (from `npm audit`)

| Package | Severity | Direct? | Advisory | Range Affected | Fixed In |
|---|---|---|---|---|---|
| `@anthropic-ai/sdk` | moderate | no (via `@anthropic-ai/claude-agent-sdk`) | GHSA-p7fg-763f-g4gf | `>=0.79.0 <0.91.1` | `>=0.91.1` |
| `@anthropic-ai/claude-agent-sdk` | moderate | **yes** | (aggregated from above) | `>=0.2.91` (per npm audit) | npm reports `0.2.90` (see §4) |
| `vitest` | moderate | **yes** | (aggregated from vite/esbuild) | `0.0.1 – 3.0.0-beta.4` incl 2.x | `4.1.5` |
| `vite` | moderate | no (via `vitest`) | GHSA-4w7w-66w2-5vf9 | `<=6.4.1` | `>=6.4.2` / `7.x` / `8.x` |
| `esbuild` | moderate | no (via `vite` via `vitest`) | GHSA-67mh-4wv8-2f99 | `<=0.24.2` | `>=0.25.0` |
| `vite-node` | moderate | no (via `vitest`) | (via vite) | `<=2.2.0-beta.2` | `>=3.x` with vite 7+ |
| `@vitest/mocker` | moderate | no (via `vitest`) | (via vite) | `<=3.0.0-beta.4` | `>=4.x` |

**Total initial vulnerabilities: 7 (all moderate; 0 high, 0 critical)**

---

## 3. Replacements Applied

No replacements were applied in this run. Both vulnerable chains require major-version migrations (see §4). The fix mode loop ran 1 iteration; the plan produced zero auto-applicable changes, so the loop terminated without modifying any file.

---

## 4. Manual Review Needed

### Item 1 — `@anthropic-ai/sdk` advisory GHSA-p7fg-763f-g4gf (via `@anthropic-ai/claude-agent-sdk`)

**Advisory:** Claude SDK for TypeScript has Insecure Default File Permissions in Local Filesystem Memory Tool.  
**CWE:** CWE-732 (Incorrect Permission Assignment for Critical Resource).  
**Affected range:** `@anthropic-ai/sdk` `>=0.79.0 <0.91.1`.  
**Currently installed:** `@anthropic-ai/sdk@0.81.0` (pinned by `@anthropic-ai/claude-agent-sdk@0.2.138` via `"@anthropic-ai/sdk": "^0.81.0"`).  
**Why it cannot be auto-fixed:**  
`@anthropic-ai/claude-agent-sdk` is a direct dependency pinned at `^0.2.138`. Its own `package.json` declares `"@anthropic-ai/sdk": "^0.81.0"`, which resolves to the vulnerable `0.81.0`. All published versions of `claude-agent-sdk` from `0.2.100` through `0.2.138` carry the same `^0.81.0` pin; no release yet ships `^0.91.1` or higher. `npm audit` reports the "fix" as downgrading to `claude-agent-sdk@0.2.90` (which pins `@anthropic-ai/sdk@^0.74.0`, outside the vulnerable range) — but `0.2.90` is an ancient version that predates the SDK features this project relies on. That downgrade would be a **major functional regression** and is not acceptable.

**Context on exploit surface:** The advisory specifically targets the "Local Filesystem Memory Tool" — a specific feature of the SDK that stores data in files with insecure permissions. This project uses the SDK's `query()` API with the `claude_code` preset and `permissionMode: "bypassPermissions"`. Whether the filesystem memory tool is activated in this configuration should be verified. If it is not activated, the practical risk is low until the upstream package publishes a fixed release.

**Recommended next steps:**
1. Monitor `@anthropic-ai/claude-agent-sdk` releases for one that bumps `@anthropic-ai/sdk` to `>=0.91.1`. As of 2026-05-10 no such release exists.
2. As a temporary mitigation, add an npm `overrides` field in `package.json` to force `@anthropic-ai/sdk` to `^0.91.1`. **This is a potentially breaking change** — the SDK API changed between 0.81.x and 0.91.x; verify the project still builds and tests pass before committing. Example:
   ```json
   "overrides": {
     "@anthropic-ai/sdk": "^0.91.1"
   }
   ```
   After adding the override, run `npm install` and `npm test` to verify.
3. If the override breaks the `claude-agent-sdk` internals, the only safe path is waiting for an upstream release.

---

### Item 2 — `vitest` advisory chain (GHSA-4w7w-66w2-5vf9 / GHSA-67mh-4wv8-2f99)

**Advisories:**
- `vite` GHSA-4w7w-66w2-5vf9: Path Traversal in Optimized Deps `.map` Handling (affects `vite <=6.4.1`).
- `esbuild` GHSA-67mh-4wv8-2f99: Development server accepts cross-origin requests (affects `esbuild <=0.24.2`).

**Currently installed:** `vitest@2.1.9` → `vite@5.4.21` → `esbuild@0.21.5`.

**Why it cannot be auto-fixed:**
The fix requires `vitest@4.1.5` (latest 4.x). This is a **two-major-version jump** from the current `^2.1.0` pin. Per the agent's invariant rules, major-version migrations must be flagged for human review rather than applied silently.

**Context on exploit surface:**
Both advisories affect vite acting as a **development server** (serving files to browsers). `vitest` uses vite internally only for code transformation (transpilation) and module loading during test runs — it does **not** start a vite dev server during `npm test`. The practical exploit surface in a CI/test-only context is negligible: no port is opened, no HTTP handler is exposed. However, the advisories stand and should be resolved.

**Important note on vitest 3.x:** Upgrading to `vitest@3.2.4` (latest 3.x stable) would **not** resolve the advisories — `vitest@3.x` still accepts `vite@^5.0.0` and the installed vite 5.4.21 falls squarely in the vulnerable range. Only `vitest@4.x` (which requires `vite@^6.0.0 || ^7.0.0 || ^8.0.0`) resolves the chain, because `vite@8.x` ships `rolldown` instead of `esbuild` (esbuild is gone from the dep tree entirely).

**Recommended next steps:**
1. Upgrade `vitest` from `^2.1.0` to `^4.1.5` in `package.json`.
2. Run `npm install` to pull `vitest@4.1.5` + `vite@8.x` (no esbuild).
3. Run `npm test` — `vitest@4.x` is largely API-compatible with `2.x` for basic usage. The project's `vitest.config.ts` only uses `defineConfig` with `test.include`, `test.environment`, `test.coverage`, and `test.testTimeout` — all of these settings are unchanged in `vitest@4.x`. Import paths (`from "vitest"`) remain the same.
4. Check the [vitest v3 migration guide](https://vitest.dev/guide/migration) and [v4 migration guide](https://vitest.dev/guide/migration#migrating-from-vitest-3) for any breaking changes that may apply.
5. After a green `npm test`, run `npm audit` to confirm the 5 vitest-chain advisories are cleared.

---

## 5. Security Audit

Security audit was run via `npm audit --json`. Report version: `auditReportVersion: 2` (npm 7+ format, parsed from `vulnerabilities` key).

| Advisory ID | Package | Severity | CWE | CVSS Score | Affected Range | Fixed Version | Direct? |
|---|---|---|---|---|---|---|---|
| GHSA-p7fg-763f-g4gf | `@anthropic-ai/sdk` | moderate | CWE-732 | 0 (not yet scored) | `>=0.79.0 <0.91.1` | `>=0.91.1` | no |
| GHSA-4w7w-66w2-5vf9 | `vite` | moderate | CWE-22, CWE-200 | 0 (not yet scored) | `<=6.4.1` | `>=6.4.2` | no |
| GHSA-67mh-4wv8-2f99 | `esbuild` | moderate | CWE-346 | 5.3 | `<=0.24.2` | `>=0.25.0` | no |

All 7 audit entries resolve to these 3 root advisories; the remaining 4 entries (`@anthropic-ai/claude-agent-sdk`, `vitest`, `vite-node`, `@vitest/mocker`) are aggregated vulnerability roll-ups — not independent advisories.

---

## 6. Final State

The dependency tree is **not clean**. No changes were made to `package.json` or any source file. Status is `deprecations_found` (used to cover security advisories found without auto-fixable replacements).

**Remaining issues after this run:**

| Issue | Chain root | Severity | Auto-fixable? | Reason |
|---|---|---|---|---|
| GHSA-p7fg-763f-g4gf | `@anthropic-ai/sdk@0.81.0` | moderate | No | No upstream release of `claude-agent-sdk` ships `@anthropic-ai/sdk>=0.91.1`; downgrade is not viable |
| GHSA-4w7w-66w2-5vf9 + GHSA-67mh-4wv8-2f99 | `vite@5.4.21` / `esbuild@0.21.5` | moderate | No | Fix requires vitest 2→4 major version bump |

**Packages at latest within their pinned major:** All direct dependencies are resolved to the newest release within their declared semver range. No stale-within-range issues found.

**No deprecation warnings** are present in the install output.

---

## 7. Commands Run

| # | Command | Exit Code | Notes |
|---|---|---|---|
| 1 | `npm install` (cwd: `/Users/giorgosmarinos/aiwork/agent-host-cc`) | 0 | "up to date, audited 191 packages in 2s"; 7 moderate vulnerabilities reported; no deprecated package warnings |
| 2 | `npm outdated --json` (cwd: `/Users/giorgosmarinos/aiwork/agent-host-cc`) | 1 | Exit 1 is normal when outdated packages exist; JSON parsed successfully |
| 3 | `npm audit --json` (cwd: `/Users/giorgosmarinos/aiwork/agent-host-cc`) | 1 | Exit 1 is normal when vulnerabilities exist; 7 moderate, 0 high, 0 critical |
| 4 | `npm ls @anthropic-ai/sdk` (cwd: `/Users/giorgosmarinos/aiwork/agent-host-cc`) | 0 | Confirmed parent chain: `agent-host-cc → @anthropic-ai/claude-agent-sdk@0.2.138 → @anthropic-ai/sdk@0.81.0` |
| 5 | `npm ls vite` + `npm ls esbuild` (cwd: `/Users/giorgosmarinos/aiwork/agent-host-cc`) | 0 | Confirmed parent chain: `agent-host-cc → vitest@2.1.9 → vite@5.4.21 → esbuild@0.21.5`; also `tsx@4.21.0 → esbuild@0.27.7` (clean — advisory only affects <=0.24.2) |
| 6 | `npm show @anthropic-ai/sdk versions --json` | 0 | Identified fixed versions start at `0.91.1`; latest is `0.95.1` |
| 7 | `npm show @anthropic-ai/claude-agent-sdk versions --json` | 0 | Latest is `0.2.138`; all recent versions pin `@anthropic-ai/sdk@^0.81.0` |
| 8 | `npm show @anthropic-ai/claude-agent-sdk@0.2.138 dependencies --json` | 0 | Confirmed `"@anthropic-ai/sdk": "^0.81.0"` |
| 9 | `npm show vitest versions --json` | 0 | Confirmed v2.x tops at 2.1.9; v3.x exists (3.2.4 latest); v4.x latest is 4.1.5 |
| 10 | `npm show vitest@4.1.5 dependencies --json` | 0 | Confirmed vitest 4.x requires `vite@^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0` |
| 11 | `npm show vite dist-tags --json` | 0 | Latest vite is `8.0.11`; vite 8.x does not include esbuild (uses rolldown instead) |

---

*Validated by dependency-validation-specialist agent on 2026-05-10T15:37:18Z.*
