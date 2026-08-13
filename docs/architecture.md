# Architecture

This project's architecture documentation is maintained in [docs/ai-instructions/architecture.md](ai-instructions/architecture.md).

For detailed diagrams and data flow, see:
- **[Visual architecture map](architecture/ARCHITECTURE.md)** — component & data-flow diagrams (Mermaid, renders on GitHub)
- **[Interactive architecture diagram](architecture/architecture.html)** — open in a browser for hover-to-trace edges, package deps, data flows & deployment views
- [Architecture Overview](ai-instructions/architecture.md) — monorepo structure, dependency graph, and key patterns
- [Database Schema](ai-instructions/architecture.md#database-schema) — app (PostgreSQL) + metrics (TimescaleDB) tables
- [Data Flows](ai-instructions/architecture.md#data-flows) — metrics, monitoring/anomaly, remediation, and LLM chat paths
- [Background Scheduler](ai-instructions/architecture.md#background-scheduler) — interval jobs and cadences
- [Security Checklist](ai-instructions/security-checklist.md)
- [UI Design System](ai-instructions/ui-design-system.md)

## Dependency baseline and shared table architecture (2026-08-13)

The npm workspace is kept on one root `package-lock.json`; after dependency roll-ups, run
`npm dedupe`, `npm ls --all --workspaces --include-workspace-root --omit=optional`, `npm outdated
--workspaces --include-workspace-root`, and the full test/build gates. The August 2026 baseline has
no outdated direct workspace dependency and no `npm audit` finding. `loadtests/` remains a separate
lockfile with its own documented security overrides and is not part of this workspace baseline.

TanStack Table 9 makes features part of the table's type. The shared
`frontend/src/shared/components/tables/data-table.tsx` wrapper therefore owns the explicit feature
registry for filtering, sorting, pagination, row selection, column sizing, and visibility. It also
exports the feature-aware `ColumnDef` used by every caller. Do not import `ColumnDef` directly from
`@tanstack/react-table` for a `DataTable`: doing so loses the wrapper's feature type. Pagination is
always registered, while `manualPagination` bypasses the client row model for server-paginated,
virtual, and window-scroll tables.

Fastify 5.12 distinguishes HTTP/1 (`http2?: false`) and HTTP/2 (`http2: true`) factory overloads.
`packages/server/src/app.ts` narrows the validated TLS/HTTP2 options before calling Fastify, then
passes either instance to the protocol-generic `finishBuild()` registration path. This preserves
the optional HTTP/2 runtime behavior without weakening types or duplicating plugin wiring. The
same baseline replaces Fastify's deprecated top-level `disableRequestLogging` flag with a
`LogController`; the custom request-logging plugin and its route exclusions are unchanged.

## Portainer Integration & Live Data Source

All per-endpoint container counts, host CPU/memory, and stack totals are obtained by calling the Docker API directly via live `/docker/info` requests — Portainer's per-endpoint `Snapshots[]` array is **no longer read**. The pipeline is implemented in `packages/core/src/portainer/live-fleet.ts` and exposes four functions used by foundation routes and the scheduler:

- `enrichEndpointsWithLiveDockerInfo` — fans out `/docker/info` calls across all eligible endpoints and annotates each with live counts; endpoints that fail or are unreachable are marked `unavailable`.
- `attachStackCounts` — overlays live stack counts (from Portainer's stacks list) onto each endpoint.
- `computeFleetTotals` — derives fleet-wide KPIs (running/stopped/healthy/unhealthy/stacks) from the enriched endpoints and live containers.
- `collectFleetOverview` — orchestrates the full pipeline for dashboard aggregation.

**Source states:** Docker endpoints that respond to `/docker/info` are `live`; all others (down, non-Docker, or Edge Async / Type 7) are `unavailable`. Our `kpi_snapshots` and `monitoring_snapshots` history tables are unchanged — only their inputs are now live rather than snapshot-derived.

**Kill-switch:** Setting `EDGE_LIVE_QUERY_ENABLED=false` disables all live queries; affected endpoints remain `unavailable` with no snapshot fallback.

## Portainer cache (L1 memory + L2 Redis, SWR)

`packages/core/src/portainer/portainer-cache.ts` provides a two-layer cache (`HybridCache`: in-memory `TtlCache` L1 + optional Redis L2) with `cachedFetch` (blocking, stampede-deduplicated via a shared `inFlight` map) and `cachedFetchSWR` (stale-while-revalidate). Key semantics (#1495, #1499):

- **Freshness follows the caller's TTL.** Entries become stale at 80% of their TTL (`STALE_FRACTION`) and expire at 100%. L2 values are stored in a staleness envelope (`{ __swrEnvelope: 1, staleAt, data }`), so an L2 hit inside its fresh window is served without a background origin fetch; legacy bare-JSON entries are treated as stale and revalidated. In multi-layer mode L1 remains a 30s hot layer but carries the full-TTL `staleAt`; in memory-only mode (no `REDIS_URL`, or Redis in failure backoff) L1 honors the full TTL instead of capping at 30s. Result: the `TTL` presets (ENDPOINTS 900s, CONTAINERS 300s, ...) bound Portainer load in both modes.
- **Background revalidations resolve to data.** SWR revalidation promises are registered in the same `inFlight` map that `cachedFetch` consults before any cache lookup, so they MUST resolve to the fetched value (`Promise<T>`, never `Promise<void>`); on fetch failure the cache entry is invalidated (next call retries) but the promise resolves to the previously-served stale value, so a concurrent `cachedFetch` sharing it never receives `undefined`.

**Hot-path staging (#1500):** Live enrichment mutates only counts/`totalCpu`/`totalMemory`/`snapshotSource` — never the `status`/`type` fields the downstream up/Docker filters read — so `/api/dashboard/full`, `/api/dashboard/summary`, `/api/dashboard/resources`, and `collectFleetOverview` run it **concurrently** (`Promise.all`) with the stacks fetch and the per-endpoint container fan-out instead of serializing ahead of them; wall-clock latency is bounded by the slowest stage rather than their sum. Failed `/docker/info` probes are also **negative-cached** for `EDGE_LIVE_NEGATIVE_TTL_SECONDS` (30s, distinct `edge-live-info-failed:<id>` cache keys — see `packages/core/src/portainer/edge-live-query.ts`), so an endpoint Portainer reports "up" but whose agent is unreachable fails fast on subsequent dashboard loads instead of re-paying the `EDGE_LIVE_QUERY_TIMEOUT_MS` timeout on every request. The marker respects `CACHE_ENABLED`, and the kill-switch still short-circuits before any cache or network access.

**Shared dashboard aggregation (#1543):** The container fan-out + TimescaleDB latest-metrics read + per-stack top-N aggregation used by `/api/dashboard/resources` and the `resources` section of `/api/dashboard/full` lives in a single `buildFleetResources()` helper in `packages/foundation/src/routes/dashboard.ts`, so the two routes return identical resource shapes and cannot drift. `/summary` intentionally stays container-free (#801) and sources healthy/unhealthy from the latest KPI snapshot. The standalone `/summary` and `/resources` endpoints remain public API; the frontend's unused `useDashboard()`/`useDashboardResources()` hooks are marked deprecated (the home page uses `useDashboardFull()` only).

**SWR-cache / Edge-heartbeat snapshot time (#1566):** `determineEdgeStatus()` in `packages/core/src/portainer/portainer-normalizers.ts` judges an Edge endpoint's heartbeat by comparing `LastCheckInDate` against a reference wall-clock instant. When the endpoints list is served from the cache (`TTL.ENDPOINTS` = 15 minutes), that reference instant must be *when the cached snapshot was fetched*, not the current time — otherwise a perfectly healthy endpoint whose check-in was fresh at fetch time appears to have gone silent as the cache ages, flipping the whole fleet to "down" and back as the SWR background refresh lands ("All Hosts Down" flapping). `portainer-cache.ts` stores `fetchedAt` on the same L1 entry and L2 Redis envelope as the data, so timestamp and payload share eviction and survive L1/L2 JSON round-trips together. Status-dependent consumers use `cachedFetchSnapshot()` or `cachedFetchSWRSnapshot()`, which return `{ data, fetchedAt }` from one selected cache entry; a separate `getSnapshotTimestamp()` read is diagnostic-only because a background revalidation could replace the entry between two caller operations. Callers pass the returned `fetchedAt` into `normalizeEndpointAsOf(ep, { referenceTimeMs })`. `normalizeEndpoint(ep)` itself deliberately keeps its original single-parameter signature — `endpoints.map(normalizeEndpoint)` is common, and `Array.prototype.map` supplies the element index as a second argument; a positional timestamp parameter would create the classic `["1","2"].map(parseInt)` footgun. Cached endpoint consumers whose behavior depends on `.status` use the snapshot-aware path, while genuinely live/uncached callers (for example `/api/endpoints/debug/edge-status`) and consumers of time-independent fields such as `.capabilities` keep `normalizeEndpoint()`.

## CI E2E Portainer fixture

The opt-in `e2e` CI job runs the production compose stack with a CI-only override (`docker/docker-compose.e2e.yml`) that adds a **WireMock `portainer-mock`** service serving canned fleet data from `docker/portainer-mock/{mappings,__files}`, with the backend's `PORTAINER_API_URL` pointed at it. This lets the data-dependent E2E specs (container list/detail, the #1310 dropdown-anchor regression guard) run against real data instead of timing out. The fixtures are contract-tested against the backend's actual Zod schemas + normalizers in `packages/core/src/portainer/portainer-mock-fixtures.test.ts`, so they fail loudly if a parser changes. See #1420.

### AI chat + remediation-approval E2E coverage (#1521)

The same override adds a deterministic **`llm-stub`** service — a zero-dependency Node script (`docker/llm-stub/server.mjs`) that answers the OpenAI-compatible `/v1/models` and streaming `/v1/chat/completions` (SSE) — with the backend pointed at it via `LLM_API_URL=http://llm-stub:8090/v1`. This lets `e2e/ai-chat.spec.ts` drive the **real** chat path (browser → Socket.IO `/llm` namespace → backend → LLM) offline: it asserts a streamed assistant reply renders, and that a prompt-injection attempt is refused by the guard. Because the chat call is server-side, a browser-level LLM mock would not exercise it — the stub sits at the backend's real HTTP boundary. Note the frontend does not yet surface the backend's `chat:blocked` event as a visible message, so the injection test asserts the block at the Socket.IO transport (WebSocket frame) boundary.

`e2e/remediation-approval.spec.ts` exercises the only container-mutating path against the real Fastify routes + real Postgres SQL guards (not the string-matching route mock the unit tests use): the approval state machine (pending → approved → execute), the execute-before-approve and double-approve gates, and RBAC (a non-admin viewer is 403 on list/approve/execute, and sees no approve controls in the UI). Since actions are AI-proposed and there is no create-action API, the override publishes the app Postgres on `127.0.0.1:5442` and the spec seeds a `pending` row via `pg`; if that DB is unreachable the seed-dependent tests skip (the RBAC test always runs). The execute path targets the WireMock Portainer, so the spec asserts execution is *authorized* and transitions out of `approved`, never mutating a real container. Both specs run under the existing opt-in `e2e` job (they are picked up by `npm run test:e2e`). See #1521.

## Metrics collection: unknown samples excluded from aggregates, never zero-filled (#1567)

`collectMetrics()` (`packages/observability/src/services/metrics-collector.ts`) computes per-container CPU%/memory% from a Docker stats snapshot. Both fields are `number | null`: `cpu` is `null` when `system_cpu_usage` is missing from either the current or previous snapshot (no valid `systemDelta`) or the delta is non-positive (counter reset); `memory` is `null` when `memory_stats.usage` is missing, or `memory_stats.limit` is missing/non-positive (no valid numerator or denominator). Previously missing inputs defaulted to `0` via `?? 0`, which was indistinguishable from a genuinely idle container and silently dragged fleet-wide averages down. `null` is deliberately **not** backed by a total-node-memory fallback for the missing-limit case: Docker already reports the host's total memory as `limit` when a container has no explicit `--memory` cap, so a limit still missing/non-positive by the time it reaches this code signals a malformed stats payload, not an unlimited container — guessing a divisor for data already known to be untrustworthy would just trade one silent wrong number for another.

The scheduler (`packages/server/src/scheduler.ts`, `collectEndpointMetrics`) skips writing a `metrics` row for a `cpu`/`memory` `metric_type` entirely when the value is `null`, rather than persisting a fabricated `0` — the `metrics.value` column stays `NOT NULL` (no migration needed) because the "unknown" state is represented by the row's *absence*, not a null cell. `getLatestMetrics`/`getLatestMetricsBatch` (`packages/observability/src/services/metrics-store.ts`) return only rows sharing each container's newest collection timestamp; otherwise an omitted CPU row would incorrectly carry the previous cycle's CPU forward for the whole 15-minute recency window. Readers treat a missing `cpu`/`memory` key as "unknown, exclude" rather than defaulting it to `0`. The fleet-wide aggregation in `buildFleetResources()` (`packages/foundation/src/routes/dashboard.ts`, shared by `/api/dashboard/resources` and `/api/dashboard/full`) tracks independent sample counts for CPU and memory — both for the fleet total and per-stack — so a container with a known memory reading but an unknown CPU reading contributes to the memory average without diluting the CPU average (and vice versa); a `memory_bytes`-only row still contributes its independently known raw usage to stack totals. Historical/report aggregations that already run `AVG(value)` in SQL (`packages/observability/src/routes/reports.ts`, `metrics_5min`/`metrics_1hour`/`metrics_1day` continuous aggregates) get the same correctness for free — `AVG()` already skips rows, and there are simply fewer `cpu`/`memory` rows for a container during cycles where that metric was unknown.

## Metrics Dashboard resource labels (#1429)

The Metrics Dashboard (`/metrics`) clarifies its per-container CPU% and memory% figures with denominator sub-labels. CPU% keeps the Docker `docker stats` convention (100% = one full core) and is annotated with the host's online-core count and cap (`of N cores (max N×100%)`); memory% shows `used / limit` and flags host-total when the container has no explicit limit. The limit and online-CPU count come from a read-only endpoint, `GET /api/metrics/:endpointId/:containerId/meta` (`packages/observability/src/routes/metrics.ts`), which projects the already-cached Docker container stats into `{ memoryLimitBytes, onlineCpus, usedBytes }` — no new persisted data, `authenticate`-only (observer-safe), and degrades to nulls when stats are unavailable (a Docker-reported `0` limit is treated as unset). The selected container name also appears in the global header via the ephemeral `useHeaderContextStore` slice (`frontend/src/stores/header-context-store.ts`), set by the page and cleared on unmount.

## Public status page (#1526, #1506)

`GET /api/status` (`packages/observability/src/routes/status-page.ts`) is unauthenticated and exempt from the global rate limit, so its DB cost is bounded server-side:

- **Payload cache:** the fully assembled response (including the disabled/404 state) is cached in memory for `STATUS_PAGE_CACHE_TTL_MS` (15s). Concurrent cold-cache requests share one in-flight load, failed loads are not cached, and invalidation is TTL-only — admin changes to `status.page.*` settings take effect within the TTL (the settings save path lives in `@dashboard/foundation` and has no hook into the observability route module).
- **Query batching:** `getStatusPageConfig` reads its five `status.page.*` settings with one `getSettingsByKeys` query (`packages/core/src/services/settings-store.ts`); the six 24h/7d/30d container+endpoint uptime SUMs are collapsed into a single scan of the 30-day superset window using `FILTER (WHERE created_at >= ...)` clauses (`getUptimeSummary` in `packages/observability/src/services/status-page-store.ts`); the remaining independent queries run under `Promise.all`. When the page is disabled only the config lookup runs.
- **Aggregate typing:** pg returns uncast `SUM()`/`COUNT()`/`AVG()` aggregates as strings, which made the `total === 0` guards miss and rendered NaN uptime on empty windows (#1526). The status-page and trace-store aggregate queries now cast to `::integer`/`::float`, and the uptime guards coerce with `Number()` defensively. Regression tests run the real queries against an empty table (`packages/observability/src/__tests__/status-page-store-db.test.ts`, `packages/core/src/tracing/trace-store-aggregates.test.ts`).

## API response schemas (#1545)

The app wires `fastify-type-provider-zod`'s `serializerCompiler` globally (`packages/core/src/plugins/swagger.ts`), so any route declaring a `response:` schema gets validated serialization, unknown-field pruning, and accurate OpenAPI output. Coverage is adopted incrementally. This batch added schemas to `GET /api/containers` (a permissive ordered union over its bare-array / partial-failure / paginated shapes, so the polymorphic contract is preserved with no wire change), `/api/containers/count`, `/api/containers/favorites`, `GET /api/monitoring/insights` (envelope strict; the raw `SELECT *` rows use a `.passthrough()` row schema because their column types — boolean `is_acknowledged`, present-null `metric_type`/`detection_method`/`dimensions` — diverge from the produced-shape `InsightSchema` and would otherwise fail serializer validation), and `GET /api/monitoring/insights/container/:containerId`. `NormalizedContainerSchema` (`@dashboard/contracts`) regained the `networkIPs` field it had drifted from the live normalizer, guarded by `packages/core/src/portainer/container-schema-drift.test.ts`. `GET /api/containers/:endpointId/:containerId` is intentionally left schema-less — it returns raw Portainer inspect JSON and needs a separate normalize+strip pass (tracked as a follow-up issue).

A second batch extended coverage across `packages/observability/src/routes/traces.ts` (`GET /api/traces/:traceId` — a `.passthrough()` row schema over the full `spans` table, which has grown via several migrations adding OTLP/Beyla attributes; `GET /api/traces/red`; `GET /api/traces/ingest-stats`), `packages/observability/src/routes/metrics.ts` (`GET /api/metrics/:endpointId/:containerId/meta`; both `/api/metrics/network-rates` routes — deliberately excluding the SSE-hijacked `/ai-summary` route, where a JSON response schema would be actively wrong), `packages/foundation/src/routes/settings.ts` (all 8 remaining registrations: preferences GET/PATCH, `/:key` PUT/DELETE, audit-log — a `.passthrough()` row schema over `audit_log`'s real columns, since the frontend's own `AuditLogEntry` type is unused dead code with the wrong shape — prompt-features, and prompt history/rollback), and `packages/security/src/routes/harbor-vulnerabilities.ts` (status, enabled, sync, and all three exceptions registrations — all backed by fixed-column tables, so strict schemas with `expectTypeOf` drift guards were safe, mirroring the file's existing `HarborVulnerabilityRecordSchema` convention). `GET /api/harbor/summary` and `/api/harbor/projects` were deliberately left schema-less: both proxy Harbor's live external API through TS interfaces explicitly modeled off a third-party swagger file, and a strict zod schema risks 500ing a working endpoint the day a real Harbor install returns a shape the interface doesn't anticipate. Three pre-existing frontend/backend envelope mismatches this issue also tracked (`useTraces` vs `{traces}`, `useAnomalies` vs `{anomalies}`, `useContainerCount` vs `{total, byState}`) were already resolved by prior work on this issue before this batch started.

**Container detail response schema and path stripping (#1564):** `GET /api/containers/:endpointId/:containerId` now normalizes its response through `normalizeContainer()` (`packages/core/src/portainer/portainer-normalizers.ts`) — the same projection the list/favorites endpoints use — and declares `response: { 200: NormalizedContainerSchema, 502: ErrorWithDetailsSchema }`, closing the follow-up noted above. Stripping happens in two independent layers: `portainer.getContainer()` already bridges the raw Docker *inspect* payload through `containerFromInspect()` (#1387), which drops `Mounts` entirely and maps only a fixed allow-list of `HostConfig` fields; `normalizeContainer()` then projects onto a fixed field set (`id`/`name`/`image`/`state`/`status`/`endpointId`/`endpointName`/`ports`/`created`/`labels`/`networks`/`networkIPs`/`healthStatus`), so `Mounts[].Source`, `LogPath`, and `HostConfig.Binds` cannot reach the wire even if a future regression reintroduced them onto the intermediate object. This also makes the detail route return the exact same shape the container-detail UI (`ContainerOverview`, fed via `useContainerDetail`) already consumes from the list endpoint, so no field the UI reads was dropped. Regression coverage: `backend/src/routes/containers.test.ts` (varied fixtures — running/stopped/no-mounts/no-health/unknown-endpoint) and `backend/src/routes/security-regression-data-exposure.test.ts` (asserts host paths are absent from the serialized response).

## Typecheck and lint coverage of frontend tests and configs (#1617)

The frontend twin of the gap #1586 closed for `packages/`. `frontend/tsconfig.json` excluded `src/**/*.test.ts(x)` and `frontend/package.json`'s `typecheck` script was a bare `tsc --noEmit`, with no sibling config adding the files back — so none of the 246 frontend test files was compiled by anything, locally or in CI's `Type Check` job. Two things this let through, both found while remediating #1616: `ParsedLogEntry` literals in `log-viewer.test.ts` had been missing the required `levelSource` field for as long as the field existed, and `container-state-vocabulary.test.ts` documented in prose that `Record<ContainerState, ...>` made an unhandled state "a *compile* error, caught by `npm run typecheck`" — a guarantee that did not exist.

**Three programs, all run.** `frontend/tsconfig.json` keeps the exclusion and stays the *browser* program — it is what `npm run build` compiles before `vite build`, and it has no `types: ["node"]`, so a stray `process.env` in a component is still a compile error. `frontend/tsconfig.test.json` extends it, adds `src/**/*.test.ts(x)`, `vitest.setup.ts` and `scripts/`, and names `@types/node` (legitimate there: several tests read the repo's own shipped configuration — `nginx.conf`, `index.css`, the ESLint config — and `scripts/check-bundle-size.ts` is a CLI). `frontend/tsconfig.node.json` is the third: the pure-Node build tooling, `vite.config.ts` and `vitest.config.ts`. `npm run typecheck -w frontend` runs all three, with separate `tsBuildInfoFile`s so none invalidates another's cache.

**The build-tooling program was the same gap, one directory up.** `tsconfig.node.json` already existed and already listed `vite.config.ts`, but nothing ran it: `tsconfig.json` names it under `references`, and a plain `tsc -p` does not follow references — only `tsc -b` does, and no script in this workspace runs one. `vitest.config.ts` was in no config's `include` at all. Putting them in the chain immediately surfaced a live bug: `configureServer` is a **plugin** hook and it sat under `server:`, a config section where vite silently discards unknown keys. The `/__commit` middleware had therefore never registered, and the dev-only `fetch('/__commit')` in `header.tsx` had been falling through to the SPA's `index.html` and failing its `res.json()` since the day it was written — so the dev build-ref badge silently showed the fallback. Moving the hook into a named inline plugin fixed it and cleared all six reported errors; the other five (`TS2321` excessive stack depth, `TS2769` on the plugin array, three `TS7006` implicit `any`s) were downstream of the rejected object literal, not a separate problem.

**2401 errors, of which 2289 were the config's own fault.** `@testing-library/jest-dom` was registered via `expect.extend(matchers)`, which types nothing — 2241 errors were `TS2339` on matchers that do exist. `vitest.setup.ts` now imports `@testing-library/jest-dom/vitest`, whose single side-effect import carries both the `expect.extend` and the `declare module 'vitest'` augmentation, so registration and typing can no longer drift apart. `vitest-axe` 0.1.0 predates vitest 2's move of the augmentation point (it declares the old `global.Vi.Assertion`, and its `extend-expect` JS half is an empty file), so `toHaveNoViolations` is registered and augmented explicitly in the same file; two test files that each called `expect.extend(axeMatchers)` locally no longer need to. Naming `@types/node` cleared the remaining 39 `TS2591`. The other 112 were real and are fixed in the same change.

**The gate.** `frontend/src/typecheck-gate.test.ts` follows the same "drive the shipped config, don't describe it" pattern as `backend/src/ci-audit-gate.test.ts` (#1578), `backend/src/packages-boundaries.test.ts` (#1585) and `backend/src/typecheck-gate.test.ts` (#1586). It parses the `typecheck` script for the `tsc` invocations it really performs, expands each named config with `tsc --noEmit --listFilesOnly -p <config>` (so an exclusion arriving via `extends`, or an `include` that misses a directory, is caught), and asserts that every file **vitest's own `test.include` patterns match on disk** appears in the union of those programs. Those patterns are read out of `vitest.config.ts` (imported as a value) rather than restated: a hardcoded glob in the gate would be free to drift from the one vitest actually runs, which is the same class of failure one level up. `test.setupFiles` is read the same way, and the workspace's root `*.config.ts` files are globbed rather than listed. It drives the `tsc` **binary** rather than importing the compiler API for two reasons: frontend pins TypeScript 7, the native port, where `import ts from 'typescript'` resolves to a version stub with no `ts.sys` or `getParsedCommandLineOfConfigFile` at all; and the binary is what the script actually runs, so a config the CLI expands differently from the API cannot hide between them. `--listFilesOnly` builds the program and stops before checking it, so each config costs ~0.2s. Discovery rather than a hardcoded list is the point: the file to catch is the next one added under a path some future `include` does not reach. It also asserts the setup files are in the program (drop `vitest.setup.ts` and the 2241 matcher errors return, disguised as the tests being wrong), that the root configs are, that no invocation emits, that the incremental invocations do not share a `tsBuildInfoFile`, and that the root script still chains `npm run typecheck -w frontend`. It deliberately does **not** assert that `tsconfig.json` keeps excluding tests — merging the programs is a legitimate alternative design, so the gate checks coverage, not layout.

**Lint had the identical hole, and it was load-bearing.** `frontend/package.json`'s script was `eslint --max-warnings=0 src/` and `eslint.config.js`'s block was gated on `files: ['src/**/*.{ts,tsx}']`, so `frontend/vitest.setup.ts` — loaded into all 246 test files — was linted by nothing. It carried two live `@typescript-eslint/no-empty-object-type` errors on the vitest augmentation interfaces (whose empty bodies are the point: only an `extends`-only interface merges) and an `eslint-disable` naming two rules this config disables globally, so the directive suppressed nothing and said otherwise. Both sides were widened together — the script now passes `src/ scripts/ vitest.setup.ts vite.config.ts vitest.config.ts` and `files:` matches — and `frontend/src/eslint-boundaries.test.ts` gained a check that fails in both directions: a file ESLint reports as governed (asked per file via `calculateConfigForFile`, not read off the `files:` array) that the CLI's arguments never reach, and a `files:` narrowed until it governs no non-`src` file at all. That check compares against the argument **strings** deliberately: ESLint treats `lintFiles([])` as "lint the cwd", so a first version that filtered its argument list down to empty reported every file as reached and survived its own mutation test.

**Shared test fixtures.** `frontend/src/test/` holds the three helpers that would otherwise be copy-pasted widenings: `endpoint-fixture.ts`'s `snapshotSourceFor` (mirrors `endpointSupportsLiveDockerInfo` on `status` + `type` only — an earlier version also required `edgeMode !== 'async'`, which made it *stricter* than production and would have handed an Edge Docker endpoint in async mode an `'unavailable'` production would really have filled), `query-fixture.ts`'s `mockQuery` (the single `as unknown as UseQueryResult` cast; each caller's `data` still typechecks against the real payload type, which is the axis drift shows up on), and `container-fixture.ts`'s `withNonContractState` (the single place a state outside `CONTAINER_STATES` can be constructed, so the negative-vocabulary regression tests keep their out-of-contract fixtures without any ordinary fixture being able to smuggle one in).

## Typecheck coverage of backend tests and config (#1645)

The third and final instance of the gap #1586 closed for `packages/` and #1617 closed for `frontend/`, and the barest of the three: both halves of the fix were already in the repo. `backend/tsconfig.json` already included the test files (`include: ["src/**/*"]`, excluding only `node_modules`/`dist`/`tests`), and `backend/package.json` already carried a working `"typecheck": "tsc --noEmit"`. The root `typecheck` script simply never said **`-w backend`**. With that missing, the only path that reached the workspace at all was `tsconfig.build.json`'s project reference to `backend/tsconfig.build.json`, which excludes `**/*.test.ts` — correctly, since tests must not ship to `dist/`. So every file under `backend/src/**/*.test.ts` was compiled by nothing, locally and in CI's `Type Check` job.

**What it hid.** Eight errors, all in `security-regression-*.test.ts` — the suite `CLAUDE.md` makes mandatory for every security fix. Six were dead config keys (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `LLM_OPENAI_ENDPOINT`, `LLM_BEARER_TOKEN`) still being handed to `setConfigForTest(partial: Partial<EnvConfig>)` long after the env schema dropped them, where the excess-property check catches them; two were implicitly-`any` Fastify plugin parameters in `security-regression-error-details.test.ts`. The same dead keys lingered in `backend/src/test/mocks.ts`, `backend/vitest.config.ts` and one `getConfig` mock in `packages/ai-intelligence/src/__tests__/investigation-service.test.ts` without erroring — `createMockConfig()` and the `vi.doMock` factory declare no return type, so no excess-property check applies to either, and vitest's `env` block is raw `process.env` strings. All three were cleaned so the keys cannot be copied into a new test. Removing them from `vitest.config.ts` is behaviour-neutral in both directions: `OLLAMA_BASE_URL`'s only reader is `backend/src/test-utils/test-ollama-helper.ts` via `process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'` — the identical value, and not pinning it means a developer's own export now takes effect instead of being clobbered — while `OLLAMA_MODEL` has no reader anywhere in backend, so the `'tinyllama'` it pinned was reaching nothing at all.

Worth knowing when fixing this class of error: **TS2353 reports only the first excess property in an object literal**, so deleting one dead key just reveals the next. Iterating on `tsc` output is O(keys) compile runs; checking the whole literal against the schema's key set at once is one pass.

**A second gap fell out of it.** `backend/vitest.config.ts` was in no program either. The base `tsconfig.json` carried `rootDir: "src"` and `composite: true`, and between them a file outside `src/` could not be in that program at all (TS6307 under composite, TS6059 under rootDir). Both are *emit* settings, and `tsconfig.build.json` — the config that actually emits — already re-declared `composite` alongside `outDir`, `declaration`, `declarationMap`, `sourceMap` and `tsBuildInfoFile`. So they moved down to it, leaving `tsconfig.json` as a pure typecheck program that names `vitest.config.ts` in its `include` (explicitly, rather than letting it arrive transitively through the gate test's import of it — a program a file enters only because some test imports it leaves again the moment that import does). `tsconfig.build.json` excludes it in turn, next to the test files. The emitted `dist/` is unchanged, verified by diffing a clean build before and after; note `backend/src` today holds only tests and test helpers, its production code having moved to `packages/`, and backend is not part of the root `build` script.

**The gate.** `backend/src/typecheck-gate.test.ts` gains a second half, mirroring `frontend/src/typecheck-gate.test.ts` (#1617): it parses backend's `typecheck` script for the `tsc` invocations it really performs, expands each with `tsc --noEmit --listFilesOnly -p <config>`, and asserts that every file **vitest's own `test.include` matches on disk** lands in the union of those programs — reading the patterns out of `backend/vitest.config.ts` by importing it, not restating them, since a hardcoded copy is free to drift exactly the way the thing it guards did. It also asserts the root-level `*.config.ts` files are covered (globbed, not listed), that no invocation emits, and that neither script hides a `|| true` escape hatch. Like the frontend gate it drives the `tsc` **binary** rather than the compiler API, because backend also pins TypeScript 7 — the native port, where `import ts from 'typescript'` yields a version stub with no `ts.sys`. And like the frontend gate it asserts **coverage, not layout**: whether backend keeps one program or splits into two is a design call it should survive. The `-w backend` half is asserted from the existing `#1586` block in the same file, beside `-w frontend`, so a workspace dropped from the chain fails there.

Both halves were verified by fault injection rather than by a passing run: removing `-w backend` from the root script fails the wiring assertion, and adding `src/**/*.test.ts` back to `backend/tsconfig.json`'s `exclude` fails the coverage assertion with "32 test file(s) are executed by vitest but compiled by nothing" — the original bug's exact shape.

## UI notes

- Global themed scrollbar styling lives in `frontend/src/index.css` (see the comment block `GLOBAL THEMED SCROLLBAR`). It applies to `html`/`body` and any element with the `.scrollbar-themed` opt-in class, reading `--color-foreground` via `color-mix` so all 16 themes share one rule. The sidebar (`aside nav`) keeps its hover-reveal behavior via cascade order.
- `.spotlight-card` in `frontend/src/index.css` deliberately omits `transform`. A transformed ancestor creates a containing block for `position: fixed` descendants, which breaks the placement of Radix popover/select portals (the dropdown ended up at viewport `0, 0` — see #1310). Use `isolation: isolate` or `will-change: transform` if a future change needs a stacking context or GPU layer on this card, never `transform`.
- The Network Topology graph (`frontend/src/features/containers/components/network/`) renders containers grouped into Docker Compose stacks with `@xyflow/react`, laid out by `elkjs`: the root packs the (mostly disconnected) stack boxes into a compact, deterministic grid via `rectpacking` + `SEPARATE_CHILDREN`, while each stack lays out its interior with `stress`. The canvas is **static** — pan / zoom / click-to-select only, no node dragging and no force simulation — so the layout is fully reproducible from elkjs. The viewport uses a low `minZoom` (0.1) with a capped `fitView` and `onlyRenderVisibleElements` so a large fleet (~200 containers) stays readable in one zoomed-out overview. Layout/viewport constants live in `topology-graph.tsx` (`ROOT_LAYOUT_OPTIONS`, `GROUP_LAYOUT_OPTIONS`, `FIT_VIEW_OPTIONS`); see the design spec under `docs/superpowers/specs/2026-05-30-topology-overview-scale-design.md`. elkjs runs in a **Web Worker** (`use-elk-layout.ts` uses `elkjs/lib/elk-api` + a `?worker` factory in `elk-worker-factory.ts`, #1508): the ~1.4MB GWT engine is a separate lazily-fetched asset and layout solves never block the main thread.
- **Page-level error isolation:** `AppLayout` (`frontend/src/features/core/components/layout/app-layout.tsx`) wraps the router `<Outlet>` in an `ErrorBoundary` (`PageBoundary`). A render error in one page degrades to an inline error card while the sidebar and header stay mounted, instead of bubbling to the `/` route's `errorElement` and replacing the whole shell. The boundary renders inside the route-keyed wrapper, so it resets on navigation. This also kept the CI E2E suite's authenticated shell alive on Portainer-backed routes when Portainer was unreachable. See #1420.
- Frontend bundle strategy (#1507): route pages are lazy (`router.tsx`), vendor chunking uses Rolldown's `output.codeSplitting` groups in `frontend/vite.config.ts` (react-vendor, query-vendor only — recharts and framer-motion are deliberately ungrouped so chart code stays out of the eager graph and the LazyMotion feature bundle can split). All animated components import `m` from framer-motion; the `domMax` featureset loads asynchronously via `frontend/src/lib/motion-features.ts` (regression-guarded by `frontend/src/lazy-motion-features.test.ts`). jsPDF loads via dynamic import on Export PDF click (`management-pdf-export.ts`); the Metrics Dashboard chat panel and its react-markdown/highlight.js payload load on first open. React Compiler is enabled through `@rolldown/plugin-babel` + `reactCompilerPreset` (#1524). `frontend/scripts/check-bundle-size.ts` fails if recharts code ever re-enters the entry's static-import closure.

## Design-critique remediation, round 2 (2026-07-27)

A second whole-application review, run specifically to hunt "AI slop", found that the prose was
already good and the **numbers** were not. Almost every finding had one shape: the system computed
a qualifier and then discarded it at the render boundary. The fixes are grouped by that cause.

**A number and its qualifier render together, or neither renders.** This is the rule the round-2
fixes encode, and the one to apply to any new figure:

- `getLlmStats` returns `errorRate` as a **percentage** (0-100); the tile multiplied by 100 again
  and a single failed call rendered as `10000.0%`. Token, latency and model-share aggregates now
  `FILTER (WHERE status <> 'error')`, and the payload carries `failedQueries`/`succeededQueries`
  so the tiles can state their own basis. Latency and tokens render an em dash, never `0`, when
  nothing succeeded.
- `/api/reports/utilization` returned `p95` above `max` on four live rows. Above 6h the aggregates
  come from a rollup (a continuous aggregate that refreshes on a policy, so it lags) while
  percentiles can only come from raw `metrics` — two populations printed as one row. Percentiles
  are now computed **only** when the aggregates also read raw metrics; otherwise they are `null`
  and `aggregateSource.percentileNote` explains why. `percentile_cont` over an empty set returns
  NULL, which `Number()` turned into a confident `0.00%`; null now reaches the client.
- Nothing reachable exercised that percentile branch before this issue. `ReportsQuerySchema`
  accepted `24h|7d|30d`, and `selectRollupTable` reads the raw `metrics` hypertable only at **6h
  and below**, so every range the querystring allowed was a rollup range: `p50`/`p95`/`p99` were
  always null and the two p95-keyed right-sizing rules could never fire — a percentile column and
  half a rule set that no reachable request could reach. `6h` was added to the schema and to
  `TIME_RANGES` in `reports.tsx` (which feeds the page's range selector and the PDF options panel
  alike), and `timeRangeToInterval` answers it with `6 hours` instead of falling through to
  `1 day`. The management PDF's `Period:` line derives its prose from the range token now, rather
  than from a three-entry lookup that fell behind the selector the moment `6h` joined it and
  printed `Period: 6h`.
- Right-sizing rules require `RIGHT_SIZING_MIN_SAMPLES` (10), counted from the raw samples backing
  a percentile rather than the rollup bucket count, and never fire on a null percentile. A
  container with two samples was being told to raise its CPU limits.
- What the chosen range costs is stated rather than left to an empty column: the utilization
  payload carries `rightSizingCoverage` (`{ totalRules, skippedRules, skippedReason }`) and
  `/reports` renders "2 of 4 rules could not be evaluated: CPU p95 below 10%, Memory p95 below
  20%", naming the unevaluated rules in the same words it uses for the ones that fired and taking
  the fraction from the payload so a fifth rule cannot make it a lie. The panel renders for that
  note alone, and its header count is labelled (`0 fired`) so an unlabelled `0` no longer sits
  above that sentence. The coverage is range-level only. **Known gap, not closed:**
  `evaluateRightSizingRules` also skips a rule for an individual container backed by fewer than 10
  samples, and no field reports that. If every container is below that floor, a rule is evaluated
  for no container while `skippedRules` stays empty. `/reports` gates the whole panel on
  `rightSizingGroups.length > 0 || unevaluatedRules.length > 0`, so in that case both are zero and
  the panel does not render at all — the operator sees no right-sizing section and nothing saying
  two rules went unevaluated. The gap is silent, not conservative.
  `RightSizingRangeCoverage`'s doc comment says the same, and
  `reports-route.test.ts` (`covers range-level skips only — a per-container sample floor is not
  one`) pins the boundary.
- Capacity-forecast ETAs are gated on `confidence !== 'low'` (`hasReportableEta`). The fleet's
  top-ranked risk was a container at **0.0% CPU** projected to breach within the hour. The risk
  score's two branches previously used incompatible scales, so every breach more than four hours
  out ranked below rows the same table labelled Healthy; the bands can no longer overlap.
- Anomaly descriptions no longer print `confidence: 1.00` (a clamped restatement of the z-score),
  no longer restate the z-score in words, and refuse to print a z-score above
  `Z_SCORE_REPORTABLE_MAX` — `z-score: 1116.00` beside `mean: 0.0%` is a collapsed denominator,
  not a distance.
- A capped list's *sentence* carries the real total too: `These 200 of 3982 traces`, not
  `All 200 traces`. This extends CLAUDE.md invariant 6 to the prose describing a capped array.

**One container-state vocabulary.** `CONTAINER_STATES` in `@dashboard/contracts` is the only list,
serialized through `ContainerStateSchema` and derived from by both `portainer-normalizers.ts` and
the frontend's `Container` type. The fleet-health tile compared against `'exited'` — Docker's word,
which the normalizer maps to `'stopped'` server-side — so the branch was unreachable and Home
reported "0 stopped" with containers down. Comparing a `ContainerState` against a Docker-native
word is now a compile error. Use `isDownState`/`containerStateTone` (`shared/lib/container-state.ts`)
rather than comparing literals inline.

**One detector-label map.** `frontend/src/features/ai-intelligence/lib/detection-method-labels.ts`
is the single source. `signature-meta.ts` labelled `ml-anomaly` "ML" while `insight-card.tsx`
labelled it "Metric anomaly" — both rendering on `/health` at once, over rows describing themselves
as `method: adaptive`. The reasoning had been written down in a comment and was lost anyway;
`detection-method-labels.test.ts` now fails if any consumer disagrees or if any label claims ML.

**Contrast is a checked invariant.** `--color-muted-foreground` is the most-used text colour in the
app and failed WCAG AA on three light themes (apple-light 4.31:1, catppuccin-latte 4.37:1,
retro-70s 4.26:1). `frontend/src/theme-contrast.test.ts` parses the shipped `index.css` and holds
**every** theme to 4.5:1, so a seventeenth theme with unreadable body text fails in CI.

**Keyboard access where the work happens.** The app shell has a skip link targeting
`<main id="main-content" tabIndex={-1}>` (22-29 Tab presses to content before). `DataTable` accepts
controlled `sorting`/`onSortingChange`, which let `/reports` drop its hand-rolled `<span onClick>`
headers — `aria-sort` was null on all eight and five were inert — and share one ordering across its
two tables. The topology graph is named and its ~70 unnamed node/edge tab stops are out of the tab
order. `/assistant` is `role="log"` + `aria-live="polite"`.

**An affordance is gated on its real precondition.** `GET /api/pcap/status` and
`GET /api/llm/status` exist so the UI can refuse before the click rather than after the error:
`PCAP_ENABLED` defaults to false and was enforced only inside `startCapture`, and the Assistant
offered four suggested questions on a deployment with no reachable LLM.

**A guess is labelled a guess.** `resolveLevel` in `features/observability/lib/log-viewer.ts`
prefers the level a log record declares (pino JSON, `LEVEL:` prefix) and falls back to the keyword
grep with `levelSource: 'guessed'`, rendered dimmed with a `?`. The grep badged
`module: "trace-store"` as DEBUG for containing the word "trace" — on the field operators triage on.

## Design-critique remediation (2026-07-26)

A whole-application design review produced 173 findings; the fixes are grouped below by the
structural cause rather than by page, because most of them shared one.

**One navigation manifest.** `frontend/src/features/core/lib/navigation-manifest.ts` is the single
source of truth for every destination (path, label, short label, group, icon, palette-only and
feature-gate flags) and for the `g`-chord assignments (`NAV_CHORDS`). The sidebar, the breadcrumb,
the command palette, the mobile bottom nav and the keyboard-shortcuts overlay all derive from it.
Before this there were **six** independently hand-maintained copies of the route list, and they had
drifted far enough to be user-visible: the breadcrumb fell through to a literal `'Dashboard'` on 7
of 20 routes (rendering "Dashboard / Dashboard"), the palette was missing 5 destinations including
Log Viewer and Packet Capture, and the shortcuts overlay still advertised labels the nav had
renamed. `navigation-manifest.test.ts` fails if a destination lacks a breadcrumb label or a palette
entry, so the drift cannot silently return.

Note the chords live in the manifest rather than in `app-layout.tsx`: the shortcuts overlay needs
them to label itself and `app-layout` renders that overlay, so declaring them there created an
import cycle in which `NAV_CHORDS` read as `undefined` at module-init time whenever the graph was
entered through the router.

**`useAutoRefresh` owns its timer.** The hook used to own only interval state and schedule nothing,
so every consumer had to remember its own `window.setInterval` effect. One page did (with a comment
naming the trap); six did not — and `refresh-controls.tsx` renders a pulsing "live" dot whenever
`interval > 0`, so those pages showed a live indicator over a dropdown that scheduled no fetch. The
hook now takes `{ onTick, storageKey }` and runs the timer itself. `storageKey` exists because a
single shared localStorage key meant a page requesting `useAutoRefresh(0)` could open *displaying*
an interval another page had stored. The returned setter is `setRefreshInterval`; `setInterval` is
kept as a deprecated alias because destructuring it shadows `window.setInterval` in the consuming
module, which is exactly what made hand-wiring the timer error-prone.

The hook also does **not** write to localStorage on mount. Persisting on mount recorded a default the
user never chose, and on the shared key that was not merely cosmetic: Image Footprint asks for 60s
while the dashboards ask for 30s, so opening that one page wrote 60 to the fleet-wide key and quietly
slowed every dashboard query elsewhere in the app. The mount-skip compares the state object by
*identity* against the value the hook mounted with, not by value — `setRefreshInterval` and `toggle`
always build a fresh object, so re-selecting the cadence already displayed still persists, and a ref
survives StrictMode's mount/cleanup/mount whereas a boolean first-run flag is spent on the first
invocation and lets the second write the default anyway.

A shared `DataFreshness` ("Updated Ns ago") component now sits beside the refresh control on the
polling pages, so a stalled poll is visible rather than inferred.

**Attributing LLM narratives to the thing they describe.** `parseInsightsResponse`
(`packages/ai-intelligence/src/routes/correlations.ts`) matches model narratives to container pairs
by list index, then by container names appearing in a block, then — weakest — positionally.

A block is used at most once, and a block that *overlaps* one already used counts as used. Exact
string matching is not enough: `paragraphs` entries are space-joins of the same lines held
individually in `lineBlocks`, so an equality test let one pair be handed a paragraph containing
another pair's sentence, putting overlapping claims about different containers on two cards while
reporting `ok`.

Positional attribution is accepted **only within an explicitly bulleted list** of exactly one item
per pair. Position is evidence only where the model asserted an order; a run of bare prose asserts
none, and reading it positionally is a guess dressed as an answer. An intermediate version did keep
prose and tried to screen out headings by testing for a trailing full stop — that was worse than the
problem it addressed, because it also deleted a bolded or unpunctuated narrative from the *middle* of
the list and silently shifted every later sentence onto the wrong pair, reporting `ok` where the
unfiltered code had correctly returned nothing. Prose that genuinely explains a pair almost always
names its containers, which the content pass already attributes on real evidence.

Under-attributing is the intended direction of failure: a null narrative costs the operator a
sentence, a misattributed one tells them something untrue about a container. `narrativeStatus`
reports which happened, once, rather than per row.

**Capped lists carry their real count.** `recommendationSummary` in `packages/observability/src/routes/reports.ts`
caps `container_names` at `RULE_CONTAINER_NAMES_CAP` (mirroring `ALL_NAMES_CAP` in
`incident-store.ts`) and sets `names_truncated`, but `container_count` stays uncapped and is what the
UI counts with. Counting the truncated array would report "500 containers" for a fleet of 525 — an
under-count presented as fact, on precisely the large fleet the cap exists for.

**Real anchors.** `DataTable` takes optional `rowHref` / `rowLabel`; when supplied, the first
non-selection cell renders inside a react-router `<Link>`, and `rowLabel` names that anchor. Sidebar
destinations are `<Link>` too. Nothing in the product was previously an anchor, so cmd-click,
middle-click, copy-link and open-in-background did not exist anywhere, and assistive tech announced
a focusable row rather than a link to a container. Note an `<a>` may not contain a `<button>`, which
is why the Workload Explorer's favourite star moved to its own column.

The `<tr>` itself carries **no** `role`. It briefly carried `role="link"`, which was a regression in
the behaviour this change set out to improve: an explicit role replaces the row's implicit `row`
role, which each `<td>`'s `cell` role requires as its ancestor and which the virtual scroll
container's `role="grid"` assumes — so screen-reader table navigation broke on exactly the fleet
tables that most need it. It also nested a link inside a link with the same accessible name, an axe
`nested-interactive` violation that announced the destination twice, while the row-level role
carried no `href` and so could not be middle-clicked anyway. The anchor is what makes a row a link.

**Port bind addresses.** Docker's host-side bind address is the most security-relevant fact about a
published port, and the only thing distinguishing the IPv4 and IPv6 bindings it emits for the same
mapping. `frontend/src/features/containers/lib/port-bindings.ts` holds the shared reading of it —
`UNSPECIFIED_BIND_ADDRESSES`, `isLoopbackBind`, `isPubliclyBound`, `formatPortMapping` — used by both
surfaces that render ports: the container detail table (which had hardcoded `0.0.0.0` for every row)
and the network-topology side panel (which omitted the address entirely, so a dual-stack publish
printed the same line twice and a loopback-only publish looked world-facing). `Container['ports']`
in `use-containers.ts` now declares `ip` itself, retiring the local intersection type that
`container-overview.tsx` had been carrying.

**`PageHeader`.** `frontend/src/shared/components/layout/page-header.tsx` renders the single `<h1>`,
an optional subtitle and an actions slot. It is deliberately without a gradient, icon-tile or
size-override prop: 20 pages previously hand-rolled the block, 11 of them writing the title string
twice (loading branch and loaded branch), and that absence is why one page's `<h1>` had drifted into
a blue-purple gradient while its 19 siblings were plain.

**Honest labelling of computed values.** Several surfaces described deterministic rules as
inference. `identifyPattern` (`packages/observability`) now returns a structured `MetricPatternMatch`
— pattern id, the triggering metrics and their z-scores, and the threshold crossed
(`PATTERN_Z_SCORE_THRESHOLD`) — instead of one of three fixed English sentences, so the UI can print
the rule that fired. `clampConfidenceScore` and `parseSeverity` return `null` rather than the
constants `0.5` / `'warning'`, so "the model did not supply this" is representable and the badge can
be omitted instead of showing a default dressed as a measurement.

Those two helpers live in `packages/core/src/utils/model-confidence.ts`. They started out beside the
remediation analyser, which meant the fix reached one of the three services that had the defect: the
investigation analyser (`packages/ai-intelligence`) still substituted `0.5` for a missing score,
`0.3` for unstructured output and `0.1` on the "insufficient evidence" abort — a confidence for an
analysis that never ran — and the PCAP analyser (`packages/security`) substituted `0.5` and `0.3`.
Those packages may not import one another, so a shared home in `core` is what makes the rule one rule
rather than three copies, two of which had already drifted. Renderers must guard on null: `null * 100`
is `0`, so an unguarded badge reads "Confidence: 0%" — a more confident claim than the default it
replaced. `investigation-detail.tsx` shows `N/A`, `insight-card.tsx` and the PCAP analysis panel omit
the badge entirely. `severity_assessment` deliberately keeps its `'unknown'` string: unlike a number,
it is honest about itself. Remediation payloads carry
`rationaleSource` ('pattern-match' | 'llm-analysis') so rule-derived seed text is distinguishable
from real LLM output, which previously shared identical chrome. **The underlying maths was always
sound and is unchanged** — z-scores, the RMS composite and the seasonal baselines are legitimate;
only the framing overclaimed.

The fleet health number is now `calculateHealthcheckPassRate` and states its exclusion inline. It
measures Docker healthcheck status and cannot see insights, so it used to render "100.0%" in green
beside "14 Critical" on the same card. The hero slot belongs to a "needs attention" count derived
from unhealthy/stopped containers plus unacknowledged critical and warning insights. Both are
derived internally from stats so no caller can pass a number that disagrees with them.

**Timestamps.** `getIncidentGroups` rendered its timestamps with `::text`, which drops the
`timestamptz` OID and so bypasses the global `pg.types` parser — the same class of pg-driver gotcha
documented above for `COUNT(*)` and `AVG()`. That is why `/health` rendered "Invalid date" ~20
times. `formatDate` also now falls back to an em dash rather than user-facing English prose.

**One product name.** `frontend/src/shared/lib/product.ts` exports `PRODUCT_NAME`. The product
answered to four names depending on the surface: `Docker Insights` (login and sidebar wordmarks),
`Docker Insight` (its own Settings → System Information), `Container Insights` (`PRODUCT.md`) and
`container-insights` (the compose project it displayed back to the operator in its own Workloads
table). `Container Insights` is canonical.
