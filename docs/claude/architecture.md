# Architecture

Moved verbatim from `CLAUDE.md`. Paths are relative to the repository root.

## Architecture

**Portainer 2.45 compatibility:** Endpoint reads exclude unused snapshots (list:
`excludeSnapshots=true`; inspect: `excludeSnapshot=true`). Omitted endpoint `Status`
is Portainer's zero/unknown value, not an up signal. Docker nil collections are
normalized at the Zod boundary. Live `/docker/info` uses the shared TLS dispatcher.
Stack lifecycle vocabulary lives in `@dashboard/contracts` (`STACK_STATUSES`):
1/2/3/4 map to active/inactive/deploying/error; unknown values remain unknown.
See `docs/portainer-2.45-compatibility.md` for upstream evidence and verification.

Backend uses npm workspaces under `packages/` with a `core/` kernel (`@dashboard/core`). See `@docs/ai-instructions/architecture.md` for complete directory structure. See `@packages/core/src/CLAUDE.md` for kernel boundaries and security-critical files.

**Portainer data source:** All endpoint container counts, host CPU/memory, and stack totals come from live `/docker/info` calls — Portainer's per-endpoint `Snapshots[]` is **not read**. The pipeline lives in `packages/core/src/portainer/live-fleet.ts` (`enrichEndpointsWithLiveDockerInfo`, `attachStackCounts`, `computeFleetTotals`, `collectFleetOverview`). Up Docker endpoints are `live`; Edge Async (Type 7) and any down or non-Docker endpoint are `unavailable`. `EDGE_LIVE_QUERY_ENABLED=false` is a hard kill-switch — all endpoints become `unavailable` with no fallback. Our `kpi_snapshots`/`monitoring_snapshots` history tables are unchanged; only their inputs are now live.

**Metrics Dashboard resource labels (#1429):** The Metrics Dashboard (`/metrics`) surfaces per-container CPU%/memory% **denominators**. CPU% keeps the Docker `docker stats` convention (100% = one core) with an "of N cores (max N×100%)" sub-label; memory% shows `used / limit` and flags host-total when no limit is set. The limit + online-CPU count come from a read-only `GET /api/metrics/:endpointId/:containerId/meta` endpoint (`packages/observability/src/routes/metrics.ts`) that projects the already-cached Docker stats into `{ memoryLimitBytes, onlineCpus, usedBytes }` — no schema change, no persisted data, `authenticate`-only, and degrades to nulls when stats are unavailable (a `0` limit is treated as unset). Containers are filtered with a `FleetSearch` box above the selector. The selected container name appears in the global header via the ephemeral `useHeaderContextStore` slice (`frontend/src/stores/header-context-store.ts`), set by the page and cleared on unmount.

**Unknown metric samples are excluded, never zero-filled (#1567):** `collectMetrics()` (`packages/observability/src/services/metrics-collector.ts`) returns `cpu`/`memory` as `number | null` — `null` when `system_cpu_usage` (CPU), `memory_stats.usage`, or `memory_stats.limit` (memory) is missing/non-positive in the Docker stats payload, i.e. the percentage genuinely cannot be computed this cycle. The scheduler (`packages/server/src/scheduler.ts`) skips writing that `metric_type` row entirely rather than persisting a fabricated `0` (the `metrics.value` column stays `NOT NULL` — no migration; "unknown" is the row's absence, not a null cell). Latest reads return only rows sharing each container's newest collection timestamp, so an omitted metric is not silently carried forward from an older cycle. `buildFleetResources()` (`packages/foundation/src/routes/dashboard.ts`) tracks independent CPU/memory sample counts so a container with a known memory reading but unknown CPU doesn't dilute the fleet CPU average (and vice versa), while independently known `memory_bytes` still contributes to per-stack totals. No total-node-memory fallback is used for a missing memory limit: Docker already reports host-total memory as `limit` when a container has no explicit cap, so a still-missing limit signals a malformed payload, not an unlimited container.

**Design-critique remediation (2026-07-26):** a whole-app review produced 173 findings; see
`@docs/architecture.md` ("Design-critique remediation") for the full rationale. Six invariants
worth knowing before touching UI:

1. **Navigation comes from one manifest.** `frontend/src/features/core/lib/navigation-manifest.ts`
   feeds the sidebar, breadcrumb, command palette, mobile nav and shortcuts overlay. There were
   previously six hand-maintained copies and they had drifted (breadcrumb read "Dashboard /
   Dashboard" on 7 of 20 routes; Cmd-K was missing 5 destinations). Do not add a seventh — add to
   the manifest. `navigation-manifest.test.ts` fails if an entry lacks a breadcrumb label or a
   palette entry. `NAV_CHORDS` lives there too, not in `app-layout.tsx`, because the shortcuts
   overlay needs it and `app-layout` renders that overlay (the cycle left it `undefined` at
   module-init).
2. **`useAutoRefresh` owns the timer.** Pass `{ onTick }`; never hand-roll a `window.setInterval`
   at the call site. Six pages previously showed a pulsing "live" dot over a dropdown that
   scheduled nothing. Pass a page-specific `storageKey` unless the page should share the global
   cadence. Prefer `setRefreshInterval` over the deprecated `setInterval` alias — destructuring the
   latter shadows `window.setInterval` in the consuming module. The hook **does not persist on
   mount**: only a cadence the user actually picked is written, because a page that merely stored
   its own default to the *shared* key changed every other page's cadence (opening Image Footprint,
   which asks for 60s, slowed every dashboard query). The mount-skip compares the state object by
   identity — a boolean first-run flag is spent by StrictMode's mount/cleanup/mount and writes anyway.
3. **Never render a default as if it were a measurement.** `clampConfidenceScore` and
   `parseSeverity` live in `packages/core/src/utils/model-confidence.ts` and return `null` when the
   model supplied nothing; omit the badge rather than showing a fallback number. They are in `core`
   because all three analysers need them — remediation (`@dashboard/operations`), investigation
   (`@dashboard/ai`) and PCAP (`@dashboard/security`) — and those packages may not import one
   another, so the previous single-package fix left the other two still defaulting to `0.5`. Use the
   shared helpers; do not re-add a local copy. A view that renders confidence must guard on null
   (`null * 100` is `0`, which prints a confident "Confidence: 0%" — worse than the default it
   replaced). Likewise, label rule-derived text as such (`rationaleSource`) — a threshold rule
   presented under a Brain icon as "ML-Detected" is the failure this review named most often. The
   maths is sound; it is the framing that must not overclaim.
4. **Use `PageHeader` and `PRODUCT_NAME`.** One `<h1>` per page from
   `shared/components/layout/page-header.tsx` (no gradient/icon/size-override prop, deliberately);
   the product's name comes from `shared/lib/product.ts` and is **Container Insights**.
5. **A navigating table row is an anchor, not a `role="link"` row.** `DataTable`'s `rowHref` wraps
   the first data cell in a real `<a>`; the `<tr>` deliberately keeps its implicit `row` role. An
   explicit role on the `<tr>` replaces `row` — which each `<td>`'s `cell` role requires as an
   ancestor, and the virtual scroll container declares `role="grid"` — collapsing table navigation
   for assistive tech, and nesting a link inside a link announces the destination twice.
6. **A capped list travels with its real count.** When a payload caps an array (`ALL_NAMES_CAP` in
   `incident-store.ts`, `RULE_CONTAINER_NAMES_CAP` in `reports.ts`), send the uncapped total
   alongside it and have the UI count with that. Counting the truncated array under-reports exactly
   the large fleet the cap exists for. This applies to the *sentence* describing a capped list
   too: `/traces` read "All 200 traces: … container: unknown" while 3982 matched, and an operator
   concluded the fleet had no container attribution. Say "These 200 of 3982".

**Design-critique remediation round 2 (2026-07-27):** a second review, hunting "AI slop", found
the prose was already good and the numbers were not. See `@docs/architecture.md`
("Design-critique remediation, round 2"). Five more invariants:

7. **A number and its qualifier render together, or neither renders.** Almost every round-2
   finding was one shape: the system computed the qualifier — `status='error'`, `r_squared`,
   `confidence`, the sample count, which table a value came from — and dropped it at the render
   boundary while keeping the figure it qualifies. That produced `Error Rate 10000.0%`, `p95`
   above `max`, a breach ETA for a container at 0.0% CPU, `confidence: 1.00` on every anomaly,
   and "13.8 GB total disk usage" that double-counted every shared layer. Before rendering a
   figure, ask what would let a reader discount it, and render that too — or render neither.
   Never coerce a null statistic to `0`: `percentile_cont` over an empty set and a 0/0
   satisfaction rate both printed confident zeroes.
8. **Detector and state vocabularies have exactly one definition.** `CONTAINER_STATES` lives in
   `@dashboard/contracts`; detector labels live in
   `frontend/src/features/ai-intelligence/lib/detection-method-labels.ts`. Both existed twice and
   both drifted — the fleet tile compared against Docker's `'exited'`, which the normalizer never
   emits, so Home reported "0 stopped" with six containers down; and one detector rendered as
   "ML" and "Metric anomaly" simultaneously on `/health`. Comparing a `ContainerState` against a
   Docker-native word is now a compile error. **Record an honesty rule as a test, not a comment**
   — `insight-card.tsx` had twelve lines explaining why the badge must not say "ML" and the rule
   was lost anyway.
9. **Gate an affordance on its real precondition, not on the ones you remembered.**
   `startDisabledReason` on `/packet-capture` handled three preconditions and not `PCAP_ENABLED`,
   which defaults to false — so a stock install offered a live Start Capture and answered the
   click with a server error. `GET /api/pcap/status` and `GET /api/llm/status` exist for this.
   Every disabled control names its reason; `title={canMutate ? undefined : NOT_ADMIN}` left an
   admin with no explanation at all in the state most installs start in.
10. **A guess must not wear the same treatment as a fact.** The log level column was a keyword
   grep presented as the emitter's own level — `module: "trace-store"` badged DEBUG for containing
   "trace", on the field operators triage on. `resolveLevel` prefers what the record declares and
   marks the fallback `levelSource: 'guessed'`, rendered dimmed with a `?`.
11. **Contrast and keyboard access are checked, not assumed.** `frontend/src/theme-contrast.test.ts`
   holds every theme's `--color-muted-foreground` to 4.5:1 against its own background (three light
   themes failed). The app shell has a skip link to `<main id="main-content">`; before it, reaching
   content took 22-29 Tab presses on every route. `DataTable` takes controlled
   `sorting`/`onSortingChange` — reach for that rather than hand-rolling `<span onClick>` headers,
   which is how `/reports` ended up with `aria-sort` null on all eight columns and five inert.
