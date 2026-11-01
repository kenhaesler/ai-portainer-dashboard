# Dependencies and Code Quality

Moved verbatim from `CLAUDE.md`. Paths are relative to the repository root.

## Dependency Management

- **Always run `npm install` from the repo root** — never from `backend/` or `frontend/` directories. npm workspaces requires a single root lock file.
- **Dependabot** creates weekly PRs for npm, monthly for Docker and GitHub Actions. Triage these PRs weekly.
- **React is pinned to exact version** (no caret) since React 19 is a new major version. Update deliberately.
- `pino-pretty` is a devDependency (not shipped to production Docker images).
- **CVE/vulnerability scanning is not enforced in CI** (removed in #1623; originally added by #1578). `npm run audit:prod` / `audit:all` / `audit:loadtests` still exist as local, on-demand scripts — run them manually when reviewing a Dependabot PR or before a release — but nothing in CI runs them. This was a deliberate trade-off: `npm audit` gates on the *installed version* of a package, not on whether this app's code path can reach the vulnerable function, and with no suppression allowlist the only way to clear a red one was an immediate migration/override. That blocked every open Dependabot PR at once on advisories that turned out unreachable here — #1618's react-router advisory is scoped to RSC mode, which this app doesn't use; #1621's hono advisory only backs an MCP *server* transport this app never imports (client-only usage). Known consequence, accepted rather than overlooked: a High or moderate production CVE can now reach `dev` without CI failing.
- **If a manual audit check turns up something:** prefer a lockfile refresh (`npm update <pkg>`) or a root `overrides` entry — both remove the vulnerable code rather than hiding it. Every production High this repo has hit was fixable that way, including one npm reported as `fixAvailable: false` (that field is not a reliable signal).
- **`npm ci` exits 0 on a lockfile that cannot fully install.** A dependency a package declares but the lockfile carries no entry for is skipped silently; `npm audit` and `npm ls --package-lock-only` do not see it either. Only **`npm ls --all`** against the installed tree catches it (this repo has been bitten twice: #1573 range drift, and `@reduxjs/toolkit` → `@standard-schema/utils`). This is the one dependency check still enforced in CI, in the `lockfile-integrity` job right after `npm ci`. **`--all` is load-bearing:** bare `npm ls` validates only to depth 0 and exits 0 on precisely such a tree — a silent no-op in the same family as `npm audit --offline`. `backend/src/ci-audit-gate.test.ts` asserts the flag is present. The check cannot cover `loadtests/` — `npm ls` needs an installed tree and CI deliberately does not install there.
- `loadtests/package.json` carries three `overrides` (`@opentelemetry/core`, `uuid`, `brace-expansion`) pinning transitive deps past advisories that `artillery` / `autocannon` had not yet picked up. npm's suggested "fix" for the first two was a **major downgrade** (`artillery` 2.x→1.7.9, `autocannon` 8.x→2.0.1) — do not take it. Drop each override once the upstream range moves past it; verify with `npm audit` plus an autocannon smoke run, since `hyperid` (autocannon's ID generator) is the `uuid` consumer. Note an override also pins **forward**: `@opentelemetry/core: ^2.9.0` will block a future `artillery` that needs otel core 3.x, and surfaces as a confusing resolution failure rather than an obvious stale override — check these three entries first when a `loadtests/` upgrade refuses to resolve.
- **Raising an override floor is two edits, and the lockfile is the one that counts (CVE-2026-69152).** `brace-expansion` was pinned `^5.0.8` for CVE-2026-14257; the follow-up advisory found that mitigation incomplete and moved the patched floor to **5.0.9**. Nothing in CI notices: CI does not install `loadtests/` (so the `lockfile-integrity` job cannot reach it) and runs no `npm audit` at all since #1623 — the only signal was a GitHub Dependabot alert. Bump the manifest range **and** run `npm install --package-lock-only` in `loadtests/`, then commit both; a manifest that reads as fixed over a lockfile still resolving the vulnerable version is the exact shape a security bump fails in. `backend/src/dependency-overrides.test.ts` now guards all three loadtests overrides in both directions — the lockfile must satisfy the declared range (the check that catches the failure above), and each override must still be *needed* (some declared range must still reject the resolved version). Know what the second one reaches: it is a real drop signal for a **same-major** pin like `@opentelemetry/core` (`2.7.1`/`2.9.0` declared), but close to inert for a **cross-major** one — `brace-expansion`'s consumers declare `^1.1.7`/`^2.0.1` against a 5.x pin and can never accept it, so that override is forcing a major upgrade rather than breaking a tie. Dropping those still takes `npm audit` plus an autocannon smoke run; the test will not tell you.
- **The load-test lockfile guards advisory ranges per release line (Dependabot alert IDs 238/241).** Artillery currently resolves `js-yaml@3.15.1` and `nanoid@3.3.18`, and its existing `^3.14.1` / `^3.3.4` ranges accept those patches, so refresh the lockfile rather than adding overrides that would pin the tree forward. Do not turn those current versions into global semver floors: `js-yaml@4.3.0` is newer than 3.15.1 but remains vulnerable. `backend/src/routes/security-regression-dependencies.test.ts` therefore rejects the published intervals for js-yaml 3.x, 4.x, and the related 5.x advisory, plus Nano ID's pre-3.3.18 and 4.0.0–5.1.5 intervals, across every copy in `loadtests/package-lock.json`. The vulnerable functions are not exposed by the dashboard runtime: `js-yaml` parses developer-supplied load-test configuration, while no repository load-test path calls Nano ID's custom generator with an externally supplied size. Still remove the vulnerable packages; reachability limits impact, not whether known-vulnerable code belongs in the toolchain.
- **The root `lightningcss` override exists to keep the tree single-copy (#1631).** vite 8.2.1 wants `lightningcss ^1.33.0`; `@tailwindcss/node` pins it at exactly `1.32.0`. With both installed, the lockfile-integrity job fails — and not for an obvious reason: lightningcss **1.33.0 added `libc` metadata** to its platform bindings while 1.32.0 has none, so on a glibc runner the hoisted `lightningcss-linux-x64-musl@1.32.0` installs (nothing filters it) while the nested `@1.33.0` musl binding is correctly skipped; `npm ls --all` then resolves the nested copy's binding up to the hoisted 1.32.0 and reports `invalid` on a package neither version would ever load there. The override collapses the tree to one copy, deliberately overriding tailwind's exact pin — a minor bump of a **build-time-only** transformer (`dev: true`, absent from the runtime image), verified with `npm run build -w frontend`. Drop it once `@tailwindcss/node`'s pin reaches a version vite's range accepts; `backend/src/dependency-overrides.test.ts` fails when that happens, so the override cannot quietly outlive its conflict. `npm dedupe` now unifies the root and frontend vite copies at 8.2.1; keep running the full frontend tests after vite changes so that shared copy exercises both vitest and production builds.
- **Dependency baseline (2026-08-13).** The root workspace lockfile is resolved to the registry's latest direct versions (`npm outdated --workspaces --include-workspace-root` returns empty) and `npm audit` reports zero findings. The supported local Node ranges are `^22.22.2 || ^24.15.0 || >=26.0.0`: direct tooling dependencies do not support early Node 22 or Node 25, so keep `package.json`, README, `docker/.env.example`, and `backend/src/node-version-contract.test.ts` aligned when that intersection changes. TanStack Table 9 is an architectural migration, not a manifest-only bump: the shared `DataTable` owns one explicit `tableFeatures()` registry (filtering, sorting, pagination, selection, sizing, and visibility), exports its feature-aware `ColumnDef`, and uses `useTable`; callers must import that column type from the wrapper, not directly from TanStack. Fastify 5.12's HTTP/1 overload declares `http2?: false`, so the composition root must narrow `getHttp2Options()` before invoking the HTTP/1 or HTTP/2 factory overload; `finishBuild()` keeps plugin registration protocol-generic without casts. Its deprecated top-level `disableRequestLogging` option has also been replaced by `new LogController({ disableRequestLogging: true })` in production and the request-logging tests.
- Run `npm outdated` monthly to review stale packages.

## Code Quality

- Readability first. Explicit over clever.
- Every PR must include doc updates: `docs/architecture.md`, `docker/.env.example`, and this file.
- ESLint in each workspace. TypeScript strict mode. No over-engineering.
- **Package boundaries are machine-enforced (#1585).** `packages/` dependency directions are
  checked by `eslint-plugin-boundaries` in `eslint.packages.config.mjs`; the root `npm run lint`
  covers it via the `lint:packages` script (CI runs a bare `npm run lint`). A cross-package import
  in a forbidden direction, or a package barrel re-exporting from `routes/`, **fails lint**. The
  authoritative allowed-import table is in `packages/core/src/CLAUDE.md`. Adding a package requires
  both an element descriptor and a policy entry in `eslint.packages.config.mjs` — without both its
  imports are denied by default. `tsconfig.eslint.json` exists solely to pin lint resolution of
  `@dashboard/*` to `packages/<dir>/src`: `dist/` is gitignored, so a dist-resolved config would
  pass vacuously on a fresh clone or pre-build CI run. Do not weaken either file — no blanket
  `boundaries/ignore` for tests (an over-broad ignore is what made the old `backend` rules a no-op).
  Cross-domain behaviour obtained via DI (`LLMInterface`, `MetricsInterface`, … from
  `@dashboard/contracts`, wired in `packages/server/src/wiring.ts`) is not an import and needs no
  exception.
- **`frontend/` -> `@dashboard/*` imports are machine-enforced too (#1587).** A sibling
  `eslint-plugin-boundaries` block in `frontend/eslint.config.js` allows only
  `frontend -> @dashboard/contracts`; any other `@dashboard/*` import (`core`, a domain package,
  `server`, …) **fails lint**, since only `frontend` and `contracts` are declared elements and an
  import of an undeclared package is caught by the `boundaries/no-unknown-dependencies` backstop.
  Today's only real usage is 6 `import type { ... } from '@dashboard/contracts'` sites; this keeps
  that a checked invariant instead of a convention. The root `npm run lint` reaches it via
  `npm run lint -w frontend`, and `-w <workspace>` sets that child process's cwd to `frontend/` —
  **different** from `lint:packages`, which is invoked directly from the repo root — so both
  cwd-sensitive settings (`boundaries/root-path`, the resolver's `project` path) are pinned to
  absolute paths computed from the config file's own location rather than written relative to
  either cwd; the `files:` glob that gates the whole block, however, is unavoidably cwd-relative
  (an ESLint flat-config constraint, not fixable with an absolute pattern — verified), so this
  config still has a real "must be invoked with cwd = frontend/" precondition, exactly like
  `lint:packages` has one for the repo root. Tests in `frontend/src/eslint-boundaries.test.ts`
  drive the actual shipped config through ESLint's Node API with `cwd` forced to match the real
  `npm run lint -w frontend` invocation.
- **`npm run typecheck` covers packages/ test files too (#1586).** Every `packages/*/tsconfig.build.json`
  excludes `**/*.test.ts` and `**/__tests__/**` — correctly, tests must not ship to `dist/` — but the
  root `typecheck` script used to run only `tsc --build tsconfig.build.json`, so those excluded test
  files were never typechecked by anything, hiding 49 errors across 5 packages from both local
  `npm run typecheck` and CI's `Type Check` job. Each package already had its own non-build
  `tsconfig.json` (no test exclusion) and its own `"typecheck": "tsc --noEmit"` script; the root
  script now also chains `npm run typecheck -w <pkg>` for all 9 packages before typechecking
  frontend. `backend/src/typecheck-gate.test.ts` guards both halves of the wiring — that the root
  script still invokes every package's script, and that no package's plain `tsconfig.json` regains a
  test-file exclusion — following the same "drive the actual shipped config, don't describe it"
  pattern as `ci-audit-gate.test.ts` (#1578) and `packages-boundaries.test.ts` (#1585).
- **`npm run typecheck` covers frontend test files too (#1617).** The frontend twin of #1586, and
  worse: `frontend/tsconfig.json` excluded `src/**/*.test.ts(x)` and `frontend/package.json`'s
  `typecheck` was a bare `tsc --noEmit`, with **no** sibling config adding them back, so all 246
  frontend test files were compiled by nothing. `frontend/tsconfig.test.json` is that sibling —
  same base config plus the tests, `vitest.setup.ts`, `scripts/`, and `types: ["node"]`. Keep
  them separate programs: the base one stays the *browser* program (`npm run build` runs it, it
  has no node types, so `process.env` in a component is still an error). A **third**,
  `tsconfig.node.json`, holds `vite.config.ts` + `vitest.config.ts`; it existed but was reachable
  only through `tsconfig.json`'s `references`, which a plain `tsc -p` does not follow and no
  script here runs `tsc -b`, so those were compiled by nothing either — and that hid a live bug:
  `configureServer`, a **plugin** hook, sat under `server:`, where vite silently ignores unknown
  keys, so the `/__commit` middleware never registered and the dev build-ref fetch in
  `header.tsx` had never once succeeded. `typecheck` now runs all three.
  **Matcher types belong with matcher registration:** `expect.extend(matchers)` types
  nothing, which is why 2241 of the 2401 surfaced errors were `TS2339` on jest-dom matchers that
  do exist; `vitest.setup.ts` now uses `@testing-library/jest-dom/vitest` (one import, both
  halves) and declares vitest-axe's `toHaveNoViolations` beside its `expect.extend`, since
  vitest-axe 0.1.0 still augments the pre-vitest-2 `global.Vi` namespace. `frontend/src/typecheck-gate.test.ts`
  asserts every file **vitest's own `test.include` matches on disk** lands in a program the
  `typecheck` script actually runs — it reads the patterns out of `vitest.config.ts` rather than
  restating them, since a hardcoded copy would drift exactly the way the thing it guards did —
  and expands each config with `tsc --listFilesOnly` so an exclusion inherited via `extends`
  cannot hide. It shells out to the **binary** rather than importing the compiler API
  because frontend pins TypeScript 7, the native port, which ships no compiler API —
  `import ts from 'typescript'` there yields a version stub, not `ts.sys`. It does not assert the
  two-program layout — merging them is a legitimate design; coverage is the invariant.
- **`npm run typecheck` covers backend test files too (#1645).** Third and last instance of the
  same bug, and the barest: `backend/tsconfig.json` already included the tests and
  `backend/package.json` already had a working `"typecheck": "tsc --noEmit"`. Both halves existed.
  The root script simply never said **`-w backend`** — so the only path reaching the workspace was
  `tsconfig.build.json`'s reference to `backend/tsconfig.build.json`, which excludes
  `**/*.test.ts`. Eight real errors sat behind it, all in `security-regression-*.test.ts`: dead
  config keys (`OLLAMA_*`, `LLM_OPENAI_ENDPOINT`, `LLM_BEARER_TOKEN`) still being passed to
  `setConfigForTest(partial: Partial<EnvConfig>)` long after the schema dropped them, and two
  implicitly-`any` plugin parameters. **When adding a workspace, add it to the `typecheck` chain**
  — `backend/src/typecheck-gate.test.ts` now fails if `-w backend` or `-w frontend` leaves it.
  Note TS2353 reports only the *first* excess property per object literal, so removing one dead key
  reveals the next: check the whole literal against the schema rather than iterating on `tsc`.
  `rootDir` and `composite` moved from `backend/tsconfig.json` down to `tsconfig.build.json`, where
  the emit they constrain happens. In the base config they made it impossible for the typecheck
  program to hold any file outside `src/` (TS6307 / TS6059), which is why `backend/vitest.config.ts`
  was compiled by nothing — the same gap that hid frontend's misplaced `configureServer`. The
  build's emit is unchanged, verified by diffing a clean `dist/` before and after.
- **The frontend lint script and `eslint.config.js`'s `files:` glob must stay in step (#1617).**
  They are independent lists, and a file in the config's `files:` but not in the CLI's path
  arguments is linted by *nothing* — no error, just never visited. `frontend/vitest.setup.ts`
  sat in that hole: loaded into all 246 test files, and carrying two live `no-empty-object-type`
  violations plus a stale `eslint-disable` naming rules this config turns off globally. `lint`
  now passes `src/ scripts/ vitest.setup.ts vite.config.ts vitest.config.ts` and `files:` covers
  the same set; `eslint-boundaries.test.ts` fails in **both** directions (a governed file the CLI
  never reaches, and a `files:` narrowed until it governs no non-`src` file at all). Note
  `lintFiles([])` means "lint the cwd" to ESLint, so a reachability check that filters its
  argument list down to empty passes vacuously — that check compares against the argument strings.
- **Shared frontend test fixtures live in `frontend/src/test/`** — `endpoint-fixture.ts`
  (`snapshotSourceFor`, mirroring `endpointSupportsLiveDockerInfo` on `status` + `type` **only**;
  it must not be *stricter* than production either), `query-fixture.ts` (`mockQuery`, the one
  place a `UseQueryResult` cast lives), `container-fixture.ts` (`withNonContractState`, the one
  place a state outside `CONTAINER_STATES` can be built). One copy each, on purpose: a widening
  cast duplicated across files is a widening cast nobody is counting.
