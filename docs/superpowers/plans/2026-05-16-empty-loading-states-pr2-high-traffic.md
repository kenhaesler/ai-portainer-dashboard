# Empty / Loading / Error States — PR 2: High-Traffic Page Migrations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every ad-hoc empty / loading / error state on the seven highest-traffic pages to the primitives shipped in PR 1, so the canonical look becomes the default visible across the app.

**Architecture:** One commit per page, in order of growing complexity, so reviewer load stays bounded. No new components are introduced — all work consumes the existing `<EmptyState>`, `<SkeletonText>`, `<SkeletonKpi>`, `<SkeletonTableRow>`, `<SkeletonChart>`, `<SkeletonList>` exported from `frontend/src/shared/components/feedback/`. Legacy `SkeletonCard` usages on these seven pages are *also* migrated (they are loading states the spec asks PR 2 to convert); legacy `SkeletonCard` usages on long-tail pages stay until PR 3.

**Tech Stack:** React 19, TypeScript strict, Tailwind v4, Vitest + jsdom + `@testing-library/react`, `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-05-16-empty-loading-states-design.md`
**Predecessor:** PR 1 (`docs/superpowers/plans/2026-05-16-empty-loading-states-pr1-primitives.md`) — the primitives live in the branch this one is chained off.

**Scope (this PR):** Seven pages. Audited count: 13 empty states, 18 loading states, 8 error states, 2 not-configured states = **41 migrations**.

| # | Page | Empty | Loading | Error | Not-configured | Total |
|---|---|---|---|---|---|---|
| 1 | `home.tsx` | 0 | 3 | 1 | 0 | 4 |
| 2 | `workload-explorer.tsx` | 1 | 2 | 1 | 0 | 4 |
| 3 | `trace-explorer.tsx` | 1 | 1 | 1 | 0 | 3 |
| 4 | `llm-observability.tsx` | 2 | 2 | 0 | 0 | 4 |
| 5 | `ai-monitor.tsx` | 1 | 2 | 1 | 0 | 4 |
| 6 | `fleet-overview.tsx` | 3 | 3 | 1 | 1 | 8 |
| 7 | `metrics-dashboard.tsx` | 5 | 5 | 3 | 1 | 14 |

Order is light → heavy so reviewers warm up on simpler pages first.

**Out of scope:**
- Long-tail page migrations (PR 3).
- Removing the legacy `LoadingSkeleton` / `SkeletonCard` exports themselves (PR 3 — still 73 callers across the rest of the app even after this PR lands).
- Normalizing the `Loading…` vs `Loading...` sr-only text mismatch (PR 3).
- Aligning `bg-muted/40` vs `bg-muted/50` skeleton tint (PR 3).
- Any non-loading / non-empty / non-error UX changes on these pages.

---

## Conventions

- **Branch:** `feature/ui-empty-loading-pr2-high-traffic` off `feature/ui-empty-loading-primitives` (chain). When PR 1 merges, this branch rebases onto the new `dev`.
- **Commits:** One per task (= one per page). Prefix `refactor(ui):`. Subject ≤ 72 chars.
- **Imports:** Add `EmptyState` / skeleton primitives as needed. Remove now-dead imports (`LoadingSkeleton`, `SkeletonCard`, ad-hoc shimmer helpers) if they leave the file with zero uses.
- **Lucide icons:** Use the icon already imported on the page where possible. If a new icon is needed, add it to the existing `lucide-react` import line; if the page imports a Lucide identifier that clashes with another local name, alias with the `XxxIcon` suffix (e.g. `Webhook as WebhookIcon`) — matches the codebase pattern.
- **Tests:** After each migration, run the page's existing test file and update any assertions that depended on the old markup (e.g. asserting `.border-dashed` or `Loading...` text). Where a test gap is created (e.g. a new empty branch with no test), add a focused test using `useXxxMock` patterns where applicable; do not over-invest in interaction tests for Radix controls.
- **Skip list:** Captions below tables, status pills, count badges, pane subtitles, fleet-summary sub-components, and button spinners are **not** migrated.
- **No `--no-verify`, no `--amend` of previously-pushed commits.**

---

## Task 1 — home.tsx (4 migrations)

**Files:**
- Modify: `frontend/src/features/core/pages/home.tsx`
- Test: `frontend/src/features/core/pages/home.test.tsx` (update if assertions break)

### Migrations

**1.1 — KPI grid loading (line ~149–154)**

Replace:
```tsx
{Array.from({ length: 5 }).map((_, i) => (
  <SkeletonCard key={i} />
))}
```
With:
```tsx
{Array.from({ length: 5 }).map((_, i) => (
  <SkeletonKpi key={i} />
))}
```

**1.2 — Endpoint health pane loading (line ~270–271)**

Replace:
```tsx
<SkeletonCard className="h-[300px]" />
```
With:
```tsx
<SkeletonChart size="lg" />
```

**1.3 — Workloads + Fleet Summary grid loading (line ~288–292)**

Replace each of the two `<SkeletonCard className="h-[XXXpx]" />` blocks with `<SkeletonChart size="lg" />`.

**1.4 — Top-level error (line ~106–129)**

Replace the `<div>` containing `AlertTriangle` + "Failed to load dashboard" + retry button with:
```tsx
<EmptyState
  variant="error"
  icon={AlertTriangle}
  title="Failed to load dashboard"
  description={errorMessage}
/>
```
The retry button is the existing `refetch()` action — keep it visible by leaving it OUTSIDE the `<EmptyState>` (e.g., in the section header or as a sibling block). If the current layout wraps retry inside the error block, move it to a sibling position in the same flex/grid container.

### Steps

- [ ] **1.a** Read the current file fully; confirm the four locations match the audit (line numbers may have drifted ±5).
- [ ] **1.b** Add imports: `EmptyState`, `SkeletonKpi`, `SkeletonChart` from their feedback paths. Confirm `AlertTriangle` is already imported (it is, per the audit).
- [ ] **1.c** Apply the four replacements in order 1.1 → 1.4. Drop the `SkeletonCard` import if no longer used; same for any imports left dangling.
- [ ] **1.d** Run the page tests:
  ```bash
  cd frontend && npx vitest run src/features/core/pages/home.test.tsx
  ```
  Fix any assertions that depend on the old markup (most likely none — assertions usually target visible text).
- [ ] **1.e** Run typecheck + lint:
  ```bash
  cd frontend && npx tsc --noEmit && npm run lint
  ```
- [ ] **1.f** Commit:
  ```bash
  git add frontend/src/features/core/pages/home.tsx frontend/src/features/core/pages/home.test.tsx
  git commit -m "refactor(ui): migrate home page to EmptyState + skeleton primitives"
  ```

---

## Task 2 — workload-explorer.tsx (4 migrations)

**Files:**
- Modify: `frontend/src/features/containers/pages/workload-explorer.tsx`
- Test: `frontend/src/features/containers/pages/workload-explorer.test.tsx`

### Migrations

**2.1 — Compare-mode empty (line ~678–689)**

Replace the dashed-border block ("No containers to compare" + "Back to list" button) with:
```tsx
<EmptyState
  icon={Boxes}
  title="No containers to compare"
  description="Pick at least 2 containers from Workload Explorer to compare them."
/>
```
Move the "Back to list" button to a sibling position next to or above the EmptyState (it's an action, EmptyState is informational).

**2.2 — Compare-mode loading (line ~668)**

Replace `<SkeletonCard className="h-[300px]" />` with `<SkeletonChart size="md" />`.

**2.3 — Table pane loading (line ~803–804)**

Replace `<SkeletonCard className="h-[500px]" />` with `<SkeletonChart size="lg" />`.

**2.4 — Top-level error (line ~578–601)**

Replace the `<div>` containing `AlertTriangle` + "Failed to load containers" + retry button with:
```tsx
<EmptyState
  variant="error"
  icon={AlertTriangle}
  title="Failed to load containers"
  description={errorMessage}
/>
```
Keep the existing retry button outside the EmptyState.

### Steps

- [ ] **2.a** Verify the four locations match the audit.
- [ ] **2.b** Add imports (`EmptyState`, `SkeletonChart`); check `Boxes` icon — if not imported, add to the lucide line.
- [ ] **2.c** Apply migrations 2.1 → 2.4. Drop dead imports.
- [ ] **2.d** Run tests; fix assertions if any break.
- [ ] **2.e** Typecheck + lint clean.
- [ ] **2.f** Commit:
  ```bash
  git commit -m "refactor(ui): migrate workload-explorer to EmptyState + skeleton primitives"
  ```

---

## Task 3 — trace-explorer.tsx (3 migrations)

**Files:**
- Modify: `frontend/src/features/observability/pages/trace-explorer.tsx`
- Test: `frontend/src/features/observability/pages/trace-explorer.test.tsx`

### Migrations

**3.1 — Traces list empty (line ~1417–1425)**

Replace dashed-border "No traces found" block with:
```tsx
<EmptyState
  icon={GitBranch}
  title="No traces found"
  description={traces.length === 0 ? 'Run a workload to start capturing distributed traces.' : 'Adjust your filters to surface more spans.'}
/>
```
(Use whatever the existing conditional message variable is; inline ternary above is illustrative.)

**3.2 — Right-pane (trace detail) loading (line ~1409–1415)**

Replace the right-pane `<SkeletonCard className="h-[600px]" />` with `<SkeletonChart size="lg" />`. Leave the left pane skeleton as-is in this task — it's the list pane, see 3.2b.

**3.2b — Left-pane (traces list) loading** (same line range, the second `<SkeletonCard>`)

Replace the left-pane `<SkeletonCard ...>` with `<SkeletonList rows={4} />`.

**3.3 — Top-level error (line ~791–812)**

Replace dashed/red-bordered "Failed to load traces" + `AlertTriangle` + retry with:
```tsx
<EmptyState
  variant="error"
  icon={AlertTriangle}
  title="Failed to load traces"
  description={errorMessage}
/>
```
Keep retry button as a sibling.

### Steps

- [ ] **3.a** Verify locations.
- [ ] **3.b** Add imports (`EmptyState`, `SkeletonChart`, `SkeletonList`); `GitBranch` and `AlertTriangle` already imported per audit.
- [ ] **3.c** Apply 3.1 → 3.3 (covering both 3.2 and 3.2b).
- [ ] **3.d** Tests, typecheck, lint.
- [ ] **3.e** Commit:
  ```bash
  git commit -m "refactor(ui): migrate trace-explorer to EmptyState + skeleton primitives"
  ```

---

## Task 4 — llm-observability.tsx (4 migrations)

**Files:**
- Modify: `frontend/src/features/ai-intelligence/pages/llm-observability.tsx`
- Test: `frontend/src/features/ai-intelligence/pages/llm-observability.test.tsx`

### Migrations

**4.1 — Traces table empty (line ~57–66)**

Replace dashed-border "No LLM traces yet" block with:
```tsx
<EmptyState
  icon={MessageSquare}
  title="No LLM traces yet"
  description="LLM interactions will appear here once the assistant is used."
/>
```

**4.2 — Model breakdown table empty (line ~232–233)**

If the existing `"No model data available."` is wrapped in pane chrome (`<SpotlightCard>` or a panel `<section>`), migrate to:
```tsx
<EmptyState
  icon={BarChart3}
  title="No model data available"
  description="Once the assistant runs, per-model usage breakdowns will appear here."
/>
```
If it's a small inline caption (a single `<p>` inside an existing card with other content), **do not migrate** — leave it as a caption. Inspect the surrounding 10 lines before deciding.

**4.3 — KPI cards loading (line ~185–191)**

Replace `Array.from({ length: 4 }).map(...) => <SkeletonCard />` with `<SkeletonKpi />`.

**4.4 — Traces table loading (line ~47–54)**

Replace the 2-`SkeletonCard` grid loading state with:
```tsx
<SkeletonList rows={4} />
```

### Steps

- [ ] **4.a** Verify locations.
- [ ] **4.b** Add imports as needed (`EmptyState`, `SkeletonKpi`, `SkeletonList`). Confirm `MessageSquare`, `BarChart3` in lucide imports.
- [ ] **4.c** Apply 4.1 → 4.4. For 4.2, inspect the surrounding context and skip if it's a caption.
- [ ] **4.d** Tests, typecheck, lint.
- [ ] **4.e** Commit:
  ```bash
  git commit -m "refactor(ui): migrate llm-observability to EmptyState + skeleton primitives"
  ```

---

## Task 5 — ai-monitor.tsx (4 migrations)

**Files:**
- Modify: `frontend/src/features/ai-intelligence/pages/ai-monitor.tsx`
- Test: `frontend/src/features/ai-intelligence/pages/ai-monitor.test.tsx`

### Migrations

**5.1 — Insights feed empty (line ~612–623)**

Replace dashed-border "No insights" block with:
```tsx
<EmptyState
  icon={Activity}
  title="No insights"
  description={
    /* preserve the existing conditional message logic — e.g.,
       hasActiveFilters ? 'Adjust filters to surface more insights.' : 'AI-generated insights will appear here as your fleet runs.'
    */
  }
/>
```

**5.2 — Correlated anomalies grid loading (line ~564–569)**

Replace `Array.from({ length: 3 }).map(...) => <SkeletonCard className="h-[180px]" />` with `<SkeletonChart size="md" />`.

**5.3 — Insights feed loading (line ~610–611)**

Replace `<SkeletonCard className="h-[400px]" />` with `<SkeletonList rows={6} />`.

**5.4 — Top-level error (line ~381–404)**

Replace dashed "Failed to load insights" + retry with:
```tsx
<EmptyState
  variant="error"
  icon={AlertTriangle}
  title="Failed to load insights"
  description={errorMessage}
/>
```
Keep retry as sibling.

### Steps

- [ ] **5.a** Verify locations.
- [ ] **5.b** Add imports (`EmptyState`, `SkeletonChart`, `SkeletonList`). Confirm `Activity`, `AlertTriangle` imports.
- [ ] **5.c** Apply 5.1 → 5.4.
- [ ] **5.d** Tests, typecheck, lint.
- [ ] **5.e** Commit:
  ```bash
  git commit -m "refactor(ui): migrate ai-monitor to EmptyState + skeleton primitives"
  ```

---

## Task 6 — fleet-overview.tsx (8 migrations)

**Files:**
- Modify: `frontend/src/features/containers/pages/fleet-overview.tsx`
- Test: `frontend/src/features/containers/pages/fleet-overview.test.tsx`

### Migrations

**6.1 — Endpoints filter-empty (line ~980–989)**

Replace dashed-border "No endpoints match filters" with:
```tsx
<EmptyState
  icon={Server}
  title="No endpoints match filters"
  description="Adjust your filters to see endpoints."
/>
```

**6.2 — Endpoints search-empty (line ~992–1001)**

Replace dashed-border "No endpoints match your search" with:
```tsx
<EmptyState
  icon={Search}
  title="No endpoints match your search"
  description="Try a different query or clear the search."
/>
```

**6.3 — Stacks empty (line ~1163–1200, multi-branch)**

This block currently renders one of several messages via inline conditionals (filtered, searched, not configured on a specific endpoint). Split into one of:
```tsx
{stacksFilteredOnly ? (
  <EmptyState icon={Layers} title="No stacks match filters" description="Adjust your filters to see stacks." />
) : stacksSearchOnly ? (
  <EmptyState icon={Search} title="No stacks match your search" description="Try a different query or clear the search." />
) : (
  <EmptyState
    variant="not-configured"
    icon={Layers}
    title="No stacks or compose projects detected"
    description="There are no Docker Stacks or Compose projects deployed across your endpoints."
  />
)}
```
Preserve the exact condition variable names from the existing code.

**6.4 — Top-level error (line ~852–865)**

Replace dashed "Failed to load infrastructure data" + retry with:
```tsx
<EmptyState
  variant="error"
  icon={AlertTriangle}
  title="Failed to load infrastructure data"
  description={errorMessage}
/>
```

**6.5 — Endpoints grid loading (line ~974–979)**

Replace `Array.from({ length: 6 }).map(...) => <SkeletonCard className="h-[120px]" />` with `<SkeletonText lines={2} />` (six instances inside the grid).

**6.6 — Stacks grid loading (line ~1157–1162)**

Replace 6× `<SkeletonCard className="h-[100px]" />` with 6× `<SkeletonText lines={1} />`.

**6.7 — Kubernetes pods loading (line ~1258–1263)**

Replace 6× `<SkeletonCard />` with 6× `<SkeletonChart size="md" />`.

**6.8 — Same as 6.3's not-configured branch** — already covered in 6.3, no separate work.

### Steps

- [ ] **6.a** Verify locations (line drift expected on this file).
- [ ] **6.b** Add imports (`EmptyState`, `SkeletonText`, `SkeletonChart`). Confirm `Server`, `Search`, `Layers`, `AlertTriangle` in lucide imports.
- [ ] **6.c** Apply 6.1 → 6.7 in order.
- [ ] **6.d** Tests, typecheck, lint.
- [ ] **6.e** Commit:
  ```bash
  git commit -m "refactor(ui): migrate fleet-overview to EmptyState + skeleton primitives"
  ```

---

## Task 7 — metrics-dashboard.tsx (14 migrations)

**Files:**
- Modify: `frontend/src/features/observability/pages/metrics-dashboard.tsx`
- Test: `frontend/src/features/observability/pages/metrics-dashboard.test.tsx`

This is the heaviest page. The audit identified 14 distinct migrations. If during execution this commit becomes unwieldy, the implementer is authorized to split it into two commits along the boundary of "empty/error/not-configured states" vs "loading skeletons" — but only if a single commit feels unreviewable. Default is one commit.

### Migrations — empty / error / not-configured

**7.1 — No selection empty (line ~579–587)**

Replace dashed "Select a Container" block with:
```tsx
<EmptyState
  icon={Server}
  title="Select a container"
  description="Choose an endpoint and container to view metrics."
/>
```

**7.2 — Network data empty (line ~521–529)**

Replace dashed "No connected networks found for this container" with:
```tsx
<EmptyState
  icon={Network}
  title="No connected networks found"
  description="Select a different container or check container network attachments."
/>
```

**7.3 — Metrics empty in time range (line ~654–670)**

Replace dashed "No Metrics Data Available" + bullet-list explanation with:
```tsx
<EmptyState
  icon={Clock}
  title="No metrics data available"
  description="No metrics have been recorded for this container in the selected time range. Containers record metrics every 60 seconds — try a wider time range or wait for collection."
/>
```

**7.4 — Forecast collecting (line ~791–803)**

Replace "Collecting Metrics Data" block with:
```tsx
<EmptyState
  variant="not-configured"
  icon={Clock}
  title="Collecting metrics data"
  description="Capacity forecasts require at least 5 minutes of metrics history. For higher confidence predictions, keep the container running for 20+ minutes."
/>
```
(Use `not-configured` variant — this is a "waiting for setup completion" state.)

**7.5 — Forecast overview empty (line ~878–884)**

Replace dashed "No forecast data available" with:
```tsx
<EmptyState
  icon={Clock}
  title="No forecast data available"
  description="Keep metrics collection running to build cross-container forecast insights."
/>
```

**7.6 — CPU metrics error (line ~698–703)**

Audit reports this is an inline red alert sized to be a small pane state. Replace with:
```tsx
<EmptyState
  variant="error"
  icon={AlertTriangle}
  title="Failed to load CPU metrics"
  description={cpuError?.message ?? 'Try refreshing the dashboard.'}
/>
```
Use the existing error variable name from the file. If the block is genuinely tiny (e.g., a single `<p>` overlay), leave as caption.

**7.7 — Memory metrics error (line ~732–737)**

Same pattern as 7.6 with "Failed to load memory metrics".

**7.8 — Forecast overview error (line ~871–877)**

Replace dashed/destructive-bg "Failed to load forecast overview" block with:
```tsx
<EmptyState
  variant="error"
  icon={AlertTriangle}
  title="Failed to load forecast overview"
  description={forecastError?.message ?? 'Try again in a moment.'}
/>
```

### Migrations — loading

**7.9 — Top-level loading (line ~571–576)**

Replace two `<SkeletonCard className="h-[350px]" />` with two `<SkeletonChart size="lg" />`.

**7.10 — AI summary pane loading (line ~637–646)**

Replace `<SkeletonCard className="h-[120px]" />` with `<SkeletonText lines={2} />`.

**7.11 — Metrics charts loading (line ~649–653)**

Replace two `<SkeletonCard className="h-[350px]" />` with two `<SkeletonChart size="lg" />`.

**7.12 — Correlation insights loading (line ~836–840)**

Replace `<SkeletonCard className="h-[260px]" />` with `<SkeletonChart size="md" />`.

**7.13 — Forecast overview table loading (line ~865–870)**

Replace three ad-hoc `<div className="h-10 animate-pulse rounded bg-muted" />` rows with three `<SkeletonTableRow columns={8} />` placed inside the existing `<tbody>`. Confirm the actual column count from the rendered table header and adjust `columns={N}` to match.

### Steps

- [ ] **7.a** Verify locations — this file is the longest of the seven; expect ±10 line drift.
- [ ] **7.b** Add imports (`EmptyState`, `SkeletonText`, `SkeletonChart`, `SkeletonTableRow`). Confirm `Server`, `Network`, `Clock`, `AlertTriangle` in lucide imports.
- [ ] **7.c** Apply 7.1 → 7.13. Recommended order: empties first (7.1–7.5), errors (7.6–7.8), not-configured (7.4), then loadings (7.9–7.13).
- [ ] **7.d** Run the page test file. This page has the most assertions on visible text and structure — expect some test changes.
- [ ] **7.e** Run typecheck + lint clean.
- [ ] **7.f** Commit:
  ```bash
  git commit -m "refactor(ui): migrate metrics-dashboard to EmptyState + skeleton primitives"
  ```

---

## Task 8 — Final pass + visual smoke + PR

- [ ] **8.a** Confirm no legacy `SkeletonCard` or ad-hoc `border-dashed` / `Loader2.*Loading` patterns remain on these seven files:
  ```bash
  grep -nE 'SkeletonCard|border-dashed|Loading\.\.\.' \
    frontend/src/features/core/pages/home.tsx \
    frontend/src/features/containers/pages/workload-explorer.tsx \
    frontend/src/features/containers/pages/fleet-overview.tsx \
    frontend/src/features/observability/pages/metrics-dashboard.tsx \
    frontend/src/features/observability/pages/trace-explorer.tsx \
    frontend/src/features/ai-intelligence/pages/llm-observability.tsx \
    frontend/src/features/ai-intelligence/pages/ai-monitor.tsx
  ```
  Expected: empty output (or only well-justified hits documented inline).

- [ ] **8.b** Run the full frontend test suite:
  ```bash
  cd frontend && npx vitest run
  ```
  All 1912+ tests must pass.

- [ ] **8.c** Start the dev server and visually check each of the seven pages renders correctly in at least:
  - Default state (data loaded)
  - Empty state (where reachable without complex setup — at minimum: log out / freshly cleared DB / new endpoint with no resources)
  - Loading state (briefly visible on first navigation)
  
  Spend less than 60s per page. The goal is "no obvious visual regression" — not exhaustive QA.

- [ ] **8.d** Push the branch:
  ```bash
  git push -u origin feature/ui-empty-loading-pr2-high-traffic
  ```

- [ ] **8.e** Open the PR. If PR 1 has merged by now, base is `dev`; otherwise base is `feature/ui-empty-loading-primitives` and the PR description notes that this stacks on PR 1.
  ```bash
  gh pr create --base <dev|feature/ui-empty-loading-primitives> --title "feat(ui): migrate high-traffic pages to EmptyState + skeletons (PR 2 of 3)" --body "$(cat <<'EOF'
  ## Summary
  Migrates every ad-hoc empty / loading / error state on the seven highest-traffic pages to the primitives shipped in PR 1:
  - home, workload-explorer, trace-explorer, llm-observability, ai-monitor — light-touch pages
  - fleet-overview — endpoints / stacks / k8s state branches
  - metrics-dashboard — heaviest page, 14 migrations across empties / errors / loadings / forecast not-configured
  
  Net effect: zero ad-hoc `border-dashed bg-muted/20` empty states and zero raw `<SkeletonCard>` calls on these seven pages.
  
  ## Out of scope
  - Long-tail migrations (~15 pages remaining) — PR 3.
  - Removing the `LoadingSkeleton` / `SkeletonCard` exports themselves — PR 3, after all callers are gone.
  
  ## Test plan
  - [x] Frontend test suite green (1912+ tests).
  - [x] `tsc --noEmit` clean.
  - [x] `npm run lint` clean.
  - [ ] Manual smoke pass on each page — please verify the empty / loading / error states render with canonical chrome and no layout shift.
  
  Spec: `docs/superpowers/specs/2026-05-16-empty-loading-states-design.md`
  Plan: `docs/superpowers/plans/2026-05-16-empty-loading-states-pr2-high-traffic.md`
  
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

---

## Self-review notes

- **Spec coverage:** All 41 audited migrations are mapped to tasks 1–7. The skip rules from the spec (captions stay; primitives don't carry chrome; no action slots) are preserved.
- **Type/identifier consistency:** Component names match PR 1 exports verbatim (`EmptyState`, `SkeletonText`, `SkeletonKpi`, `SkeletonTableRow`, `SkeletonChart`, `SkeletonList`). Variant strings (`'empty'`, `'error'`, `'not-configured'`) match the union exported from PR 1.
- **Open question deferred to execution:** The exact condition variables for branched empty states (especially 6.3 fleet-stacks and 5.1 ai-monitor insights) need to be read directly from the source — the audit captured the locations but not the exact variable names. Implementer reads the current code, preserves the conditions, swaps only the rendered output.
- **Risk areas:** `metrics-dashboard.tsx` is large enough that a single commit is borderline reviewable. The task allows splitting it in two if the implementer judges it necessary, with a documented rationale in the second commit message.
