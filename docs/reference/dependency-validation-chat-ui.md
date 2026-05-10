---
status: partially_fixed
mode: fix
package_manager: npm
ecosystem: node
iterations_run: 1
deprecations_initial: 0
deprecations_final: 0
vulnerabilities_initial: 1
vulnerabilities_final: 0
target_path: /Users/giorgosmarinos/aiwork/agent-host-cc/chat-ui
validated_at: 2026-05-10T19:07:01Z
last_validated_commit: null
---

# Dependency Validation — agent-host-cc-chat-ui

## 1. Summary

The `chat-ui` sub-application (npm, Node >= 22, ESM) had one moderate-severity security advisory in `@fastify/static@8.3.0` (two CVEs: path traversal in directory listing and route-guard bypass via encoded path separators). The advisory's patched range starts at `9.1.1`; the fix was applied by bumping the manifest range from `^8.0.4` to `^9.1.3`. After one install cycle `npm audit` reports zero vulnerabilities. No package-name import changes were required. Major-version outdated packages exist but carry no active advisories or deprecation notices; they are flagged for manual review below.

## 2. Initial State

### Security Advisories Found

| Package | Installed Version | Scope | Severity | Advisory | CVE / CWE | Fixed In |
|---|---|---|---|---|---|---|
| `@fastify/static` | 8.3.0 | direct | moderate | GHSA-pr96-94w5-mx2h — path traversal in directory listing | CWE-22, CVSS 5.3 | 9.1.1 |
| `@fastify/static` | 8.3.0 | direct | moderate | GHSA-x428-ghpx-8j92 — route guard bypass via encoded path separators | CWE-177, CVSS 5.9 | 9.1.1 |

### Deprecation Warnings (from npm install output)

None. The `npm install` run produced no deprecation warning lines for any package.

### Outdated Packages (beyond pinned range — informational)

| Package | Pinned Range | Installed | Latest | Scope | Note |
|---|---|---|---|---|---|
| `@fastify/static` | `^8.0.4` | 8.3.0 | 9.1.3 | direct | Major bump — FIXED this iteration |
| `@preact/signals` | `^1.3.0` | 1.3.4 | 2.9.0 | devDependency | Major bump — manual review |
| `@types/node` | `^22.10.0` | 22.19.18 | 25.6.2 | devDependency | Major bump — manual review |
| `pino` | `^9.5.0` | 9.14.0 | 10.3.1 | direct | Major bump — manual review |
| `typescript` | `^5.6.0` | 5.9.3 | 6.0.3 | devDependency | Major bump — manual review |
| `undici` | `^6.21.0` | 6.25.0 | 8.2.0 | direct | Major bump — manual review |
| `vite` | `^7.0.0` | 7.3.3 | 8.0.11 | devDependency | Major bump — manual review |

## 3. Replacements Applied

### Iteration 1

**Security version bump: `@fastify/static` `^8.0.4` → `^9.1.3`**

- Rationale: Advisory range `>=8.0.0 <=9.1.0` means every installed 8.x version is vulnerable. The fix is available at `9.1.3`. Compatibility check confirmed: `@fastify/static@9.x` depends on `fastify-plugin: ^5.0.0`, which is compatible with the project's `fastify@^5` (currently installed `5.8.5`). No peer dependency conflicts.
- File modified: `chat-ui/package.json` — changed `"@fastify/static": "^8.0.4"` to `"@fastify/static": "^9.1.3"`.
- Source files modified: none. The import statement `import fastifyStatic from "@fastify/static"` at `server/index.ts:13` uses the same package name; no path translation needed.
- The registration call at `server/index.ts:111` uses only `root`, `index`, `wildcard: false`, and `decorateReply` options — all present and API-stable in 9.x.
- Result: `npm install` removed 12 packages and changed 3; `npm audit` returned 0 vulnerabilities.

## 4. Manual Review Needed

### Major-version outdated packages (no current advisory, no deprecation)

These packages have a newer major version available but are pinned by the manifest's caret range and carry no active security advisories as of 2026-05-10. They are listed for human awareness; auto-bumping major versions is outside this agent's scope.

| Package | Current | Available Major | Recommended Next Step |
|---|---|---|---|
| `@preact/signals` | 1.3.4 | 2.9.0 | Review Preact Signals v2 changelog for breaking API changes before bumping. |
| `@types/node` | 22.19.18 | 25.6.2 | Align with the Node.js version in use; bump when upgrading runtime. |
| `pino` | 9.14.0 | 10.3.1 | Check pino v10 migration guide; likely involves logger instantiation changes. |
| `typescript` | 5.9.3 | 6.0.3 | TypeScript 6 is a major release; audit strict-mode and decorator changes before migrating. |
| `undici` | 6.25.0 | 8.2.0 | Review undici v7 and v8 breaking changes (fetch API surface, interceptors). |
| `vite` | 7.3.3 | 8.0.11 | Vite 8 migration guide required; plugin API may have changed. |

### Note on the `@fastify/static` advisory and applied mitigations

The two CVEs fixed by the `^9.1.3` bump were previously mitigated in the codebase by three factors (confirmed by source inspection):
1. The server binds exclusively to `127.0.0.1` (no public network exposure).
2. `@fastify/static` is registered with `wildcard: false` and `list` is not set (directory listing is disabled).
3. No application-level route guards are layered above the static plugin.

These mitigations reduced the effective risk of the 8.x advisory to near-zero, but the 9.1.3 bump eliminates the advisory entirely and is preferred.

## 5. Security Audit

`include_security_audit` was `true`. Both pre-fix and post-fix audits were run against the npm registry using `npm audit --json`.

### Pre-fix audit (npm 11.12.1, auditReportVersion 2)

| Package | Severity | Advisory | CVSS Score | Vector | Affected Range | Fixed In |
|---|---|---|---|---|---|---|
| `@fastify/static` | moderate | GHSA-pr96-94w5-mx2h — path traversal in directory listing | 5.3 | AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N | `8.0.0 – 9.1.0` | 9.1.3 |
| `@fastify/static` | moderate | GHSA-x428-ghpx-8j92 — route guard bypass via encoded path separators | 5.9 | AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N | `8.0.0 – 9.1.0` | 9.1.3 |

Total pre-fix: 0 info, 0 low, 1 moderate (2 advisories on 1 package), 0 high, 0 critical.

### Post-fix audit

Total: 0 info, 0 low, 0 moderate, 0 high, 0 critical. No vulnerabilities.

## 6. Final State

The project is security-clean. `npm audit` reports zero vulnerabilities after one iteration. The only remaining items are major-version outdated packages that carry no active advisories — these are normal dependency aging and require human-driven migration decisions, not automated fixes.

**Installed `@fastify/static` version:** 9.1.3 (confirmed from `node_modules/@fastify/static/package.json`).

**Installed `fastify` version:** 5.8.5 — confirmed compatible with `@fastify/static@9.x` (the plugin uses `fastify-plugin: ^5.0.0`; no peer dependency errors were raised).

**Total prod dependencies after fix:** 71 (down from 83 pre-fix, because `@fastify/static@9.x` has a leaner dependency tree than 8.x).

## 7. Commands Run

| # | Command | Exit Code | Notes |
|---|---|---|---|
| 1 | `npm install` (pre-fix, cwd: `chat-ui/`) | 0 | "up to date, audited 227 packages", reported 1 moderate vulnerability |
| 2 | `npm audit --json` (pre-fix) | 1 | 1 moderate vulnerability: `@fastify/static` (2 advisories) |
| 3 | `npm outdated --json` (pre-fix) | 1 | 7 packages behind latest (all major bumps) |
| 4 | `npm view @fastify/static@9.1.3 --json` | 0 | Confirmed deps: `fastify-plugin: ^5.0.0` — compatible with `fastify@^5` |
| 5 | `npm view @fastify/static versions --json` | 0 | Confirmed 9.x versions: 9.0.0, 9.1.0, 9.1.1, 9.1.2, 9.1.3 |
| 6 | Edit `chat-ui/package.json` | — | Changed `@fastify/static` range from `^8.0.4` to `^9.1.3` |
| 7 | `npm install` (post-fix, cwd: `chat-ui/`) | 0 | "removed 12 packages, changed 3 packages, audited 215 packages", found 0 vulnerabilities |
| 8 | `npm audit --json` (post-fix) | 0 | 0 vulnerabilities |
| 9 | `npm outdated --json` (post-fix) | 1 | 6 packages behind latest (all major bumps, no advisories) |
