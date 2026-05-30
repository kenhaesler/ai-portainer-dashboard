# Home — Security Findings inside the Overall Health pane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Home "Security Findings" card *inside* the Overall Health pane as a small tile below the existing container-status tiles, and add a "Stopped" tile so the strip is an even 3×2 grid.

**Architecture:** Extend the shared `FleetHealthSummary` with two optional, backward-compatible props (`statusColumns`, `extraTiles`) and an optional `onClick` on the internal `HealthStatTile`. Home passes `statusColumns={3}` + a 2-element `extraTiles` array (Stopped, Security Findings); the AI Monitor page passes neither, so its render is byte-identical (the regression guard). Home's outer 4:1 grid and standalone Security `KpiCard` are removed; the pane goes full-width.

**Tech Stack:** React 19, TypeScript (strict), Vite, Tailwind, lucide-react, Vitest + jsdom + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-05-30-home-security-inside-health-design.md`

---

## Working directory & conventions

Active worktree: `.claude/worktrees/feature+home-security-inside-health` on branch
`feature/home-security-inside-health` (based on `origin/dev` @ `f14488a8`, which
contains #1352's `FleetHealthSummary` hero).

- **Run frontend tests from the `frontend/` directory**, not the worktree root:
  `cd frontend && npx vitest run <path>`. Add `--pool=threads` if the sandbox
  can't spawn fork workers.
- **Never `git add -A`/`-u`** — `node_modules` are symlinks. Always
  `git add <explicit paths>`.
- **Never `--no-verify`** (project rule).
- Gates: `cd frontend && npx tsc --noEmit` and `npm run lint -w frontend`
  (lint runs at `--max-warnings=0`, so unused imports fail CI).

## File Structure

- **`frontend/src/features/ai-intelligence/components/fleet-health-summary.tsx`**
  (modify) — add `onClick` to `HealthStatTile`; add `ExtraTile` type,
  `statusColumns` + `extraTiles` props to `FleetHealthSummary`; make the status
  grid column count dynamic and append `extraTiles` into the same grid.
- **`frontend/src/features/ai-intelligence/components/fleet-health-summary.test.tsx`**
  (create) — unit tests for the new props + clickable tile + backward compat.
- **`frontend/src/features/core/pages/home.tsx`** (modify) — drop the 4:1 grid
  and the standalone Security `KpiCard`; render the pane full-width; build and
  pass `extraTiles` (Stopped + Security Findings); remove now-unused imports.
- **`frontend/src/features/core/pages/home.test.tsx`** (modify) — rewrite the two
  layout-coupled tests; add a Security-tile click test; keep the rest.

---

## Task 1: Add opt-in props to the shared `FleetHealthSummary`

Extend the shared component so a caller can render a 3-column status grid with
extra (optionally clickable) tiles appended — without affecting existing callers.

**Files:**
- Modify: `frontend/src/features/ai-intelligence/components/fleet-health-summary.tsx`
- Test: `frontend/src/features/ai-intelligence/components/fleet-health-summary.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/ai-intelligence/components/fleet-health-summary.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { ShieldAlert, PackageOpen } from 'lucide-react';
import { FleetHealthSummary } from './fleet-health-summary';
import type { HealthStats } from '@/shared/lib/health-score';

const stats: HealthStats = {
  total: 10,
  running: 8,
  stopped: 2,
  paused: 0,
  unhealthy: 1,
  healthy: 7,
  unknown: 0,
  noHealthcheck: 0,
};

describe('FleetHealthSummary', () => {
  it('renders the four container-status tiles by default', () => {
    render(<FleetHealthSummary stats={stats} isLoading={false} />);
    const hero = screen.getByTestId('fleet-health-hero');
    expect(within(hero).getByText('Running')).toBeInTheDocument();
    expect(within(hero).getByText('Healthy')).toBeInTheDocument();
    expect(within(hero).getByText('Unhealthy')).toBeInTheDocument();
    expect(within(hero).getByText('No Healthcheck')).toBeInTheDocument();
  });

  it('does not render extra tiles when none are provided (backward compatible)', () => {
    render(<FleetHealthSummary stats={stats} isLoading={false} />);
    expect(screen.queryByText('Security Findings')).not.toBeInTheDocument();
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
  });

  it('renders provided extraTiles after the container tiles', () => {
    render(
      <FleetHealthSummary
        stats={stats}
        isLoading={false}
        statusColumns={3}
        extraTiles={[
          { icon: PackageOpen, label: 'Stopped', value: stats.stopped },
          { icon: ShieldAlert, label: 'Security Findings', value: 4, variant: 'danger' },
        ]}
      />,
    );
    const hero = screen.getByTestId('fleet-health-hero');
    expect(within(hero).getByText('Stopped')).toBeInTheDocument();
    expect(within(hero).getByText('Security Findings')).toBeInTheDocument();
    expect(within(hero).getByText('4')).toBeInTheDocument();
  });

  it('renders an extraTile with onClick as a button and fires the handler', () => {
    const onClick = vi.fn();
    render(
      <FleetHealthSummary
        stats={stats}
        isLoading={false}
        statusColumns={3}
        extraTiles={[
          { icon: ShieldAlert, label: 'Security Findings', value: 4, onClick },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Security Findings/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies the requested column count to the status grid', () => {
    render(<FleetHealthSummary stats={stats} isLoading={false} statusColumns={3} />);
    const running = screen.getByText('Running');
    expect(running.closest('[class*="sm:grid-cols-3"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/ai-intelligence/components/fleet-health-summary.test.tsx`
Expected: FAIL — `statusColumns`/`extraTiles` not accepted; clickable-tile test
finds no button; column-count test fails (grid is hard-coded `sm:grid-cols-4`).

- [ ] **Step 3: Add `onClick` to `HealthStatTile`**

In `fleet-health-summary.tsx`, replace the `HealthStatTile` definition
(lines 21–58) with this version (adds an optional `onClick`; renders a
`<button>` when present, else the original `<div>` markup unchanged):

```tsx
function HealthStatTile({
  icon: Icon,
  label,
  value,
  percentage,
  variant = 'default',
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  percentage?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
}) {
  const iconVariantClasses = {
    default: 'text-muted-foreground',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
  };

  const inner = (
    <>
      <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-background ${iconVariantClasses[variant]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums leading-none">{value}</span>
          {percentage !== undefined && value > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{percentage.toFixed(0)}%</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{label}</p>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
      {inner}
    </div>
  );
}
```

- [ ] **Step 4: Add the `ExtraTile` type and new props**

In `fleet-health-summary.tsx`, immediately after the `InsightStats` interface
(currently ends line 70), add the `ExtraTile` type:

```tsx
/**
 * Caller-supplied tile appended after the four container-status tiles (e.g.
 * Stopped, Security Findings on the Home page). Rendered with the same
 * `HealthStatTile`; an `onClick` turns it into a button.
 */
export interface ExtraTile {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  percentage?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
}
```

Then change the component signature (currently lines 72–76) to:

```tsx
export function FleetHealthSummary({ stats, isLoading, insightStats, statusColumns = 4, extraTiles }: {
  stats: HealthStats | null;
  isLoading: boolean;
  insightStats?: InsightStats;
  /** Column count for the container-status tile row (default 4). */
  statusColumns?: 3 | 4;
  /** Tiles appended after the four container-status tiles. */
  extraTiles?: ExtraTile[];
}) {
```

- [ ] **Step 5: Make the status grid dynamic and append `extraTiles`**

In the same file, replace the container-status grid opening tag
(currently line 93, `<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">`)
with a dynamic column count:

```tsx
          <div className={`grid grid-cols-2 gap-2 ${statusColumns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
```

Then, inside that same grid, immediately **after** the "No Healthcheck"
`HealthStatTile` (currently ends line 121, before the `</div>` on line 122),
insert the extra tiles:

```tsx
            {extraTiles?.map((tile) => (
              <HealthStatTile
                key={tile.label}
                icon={tile.icon}
                label={tile.label}
                value={tile.value}
                percentage={tile.percentage}
                variant={tile.variant}
                onClick={tile.onClick}
              />
            ))}
```

Note: `extraTiles` go in the **same** grid as the four container tiles, so with
`statusColumns={3}` the 4 + 2 = 6 tiles flow as two rows of three.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/ai-intelligence/components/fleet-health-summary.test.tsx`
Expected: PASS (all 5 cases).

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/ai-intelligence/components/fleet-health-summary.tsx frontend/src/features/ai-intelligence/components/fleet-health-summary.test.tsx
git commit -m "feat(health): opt-in statusColumns + extraTiles on FleetHealthSummary

Adds backward-compatible props so a caller can render a 3-column status grid
with extra (optionally clickable) tiles appended in the same grid. Existing
callers (AI Monitor) pass neither and render unchanged."
```

---

## Task 2: Verify AI Monitor is unaffected (regression guard)

The AI Monitor page renders `FleetHealthSummary` with only `stats`/`isLoading`/
`insightStats`. Confirm its tests still pass — this proves the shared-component
extension didn't change existing behavior.

**Files:**
- Verify only (no edits expected): `frontend/src/features/ai-intelligence/pages/ai-monitor.tsx` and its test.

- [ ] **Step 1: Run the AI Monitor test suite**

Run: `cd frontend && npx vitest run src/features/ai-intelligence`
Expected: PASS (no changes needed — defaults reproduce prior behavior).

If anything fails here, STOP — the Task 1 defaults are not backward-compatible;
fix Task 1 rather than editing AI Monitor.

- [ ] **Step 2: No commit** (verification-only task).

---

## Task 3: Rewire Home to nest Security Findings + add Stopped

Remove Home's outer 4:1 grid and the standalone Security `KpiCard`; render the
pane full-width and pass `extraTiles`.

**Files:**
- Modify: `frontend/src/features/core/pages/home.tsx`
- Test: `frontend/src/features/core/pages/home.test.tsx`

- [ ] **Step 1: Update the Home tests first (RED)**

In `frontend/src/features/core/pages/home.test.tsx`:

(a) **Replace** the test titled
`'renders the Overall Health hero with its inner stat tiles, not the removed KPI cards'`
(its body asserts the 4 tiles + Security present) — extend it to also require
**Stopped** and **Security Findings** *inside* the hero. Replace the block from
`const hero = screen.getByTestId('fleet-health-hero');` through the four
`No Healthcheck` assertion and the `Security Findings` assertion with:

```tsx
    const hero = screen.getByTestId('fleet-health-hero');
    expect(within(hero).getByText('Running')).toBeInTheDocument();
    expect(within(hero).getByText('Healthy')).toBeInTheDocument();
    expect(within(hero).getByText('Unhealthy')).toBeInTheDocument();
    expect(within(hero).getByText('No Healthcheck')).toBeInTheDocument();
    // Security Findings and Stopped now live INSIDE the health pane.
    expect(within(hero).getByText('Security Findings')).toBeInTheDocument();
    expect(within(hero).getByText('Stopped')).toBeInTheDocument();
```

(b) **Replace** the test titled
`'lays out Overall Health and Security Findings in a 4:1 grid'` entirely with a
full-width assertion (the 4:1 grid is gone):

```tsx
  it('renders the Overall Health pane full-width with Security Findings nested inside', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    const hero = screen.getByTestId('fleet-health-hero');
    // No more 4:1 split: the hero is not inside a col-span-4 column...
    expect(hero.closest('[class*="col-span-4"]')).toBeNull();
    // ...and Security Findings is no longer a separate col-span-1 card.
    const security = screen.getByText('Security Findings');
    expect(security.closest('[class*="col-span-1"]')).toBeNull();
    // Security Findings is nested inside the health hero.
    expect(within(hero).getByText('Security Findings')).toBeInTheDocument();
  });
```

(c) **Add** a click-through test (place after the test from (b)):

```tsx
  it('navigates to the security audit when the Security Findings tile is clicked', () => {
    mockUseDashboardFull.mockReturnValue({
      data: makeDashboardData(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Security Findings/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/security/audit');
  });
```

(d) Ensure `fireEvent` is imported. Change the testing-library import (line 2)
from `import { render, screen, within } from '@testing-library/react';` to:

```tsx
import { render, screen, within, fireEvent } from '@testing-library/react';
```

- [ ] **Step 2: Run the Home tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/core/pages/home.test.tsx`
Expected: FAIL — Stopped/Security not yet inside the hero; the old 4:1 column
classes still present; Security is still a wrapping `<button>` around a mocked
`KpiCard` (no role/name match) until Home is rewired.

- [ ] **Step 3: Replace the Home hero JSX**

In `frontend/src/features/core/pages/home.tsx`, replace the entire hero block
(currently lines 120–161, the comment through the closing `</MotionStagger>`)
with this full-width version that builds `extraTiles` inline:

```tsx
      {/* Overall Health Score — full-width hero. Security Findings and Stopped
          live INSIDE the pane as extra stat tiles (below the container-status
          tiles), reusing FleetHealthSummary so Home and Health & Monitoring
          never drift. */}
      <MotionStagger stagger={0.05}>
        <MotionReveal>
          {isContainersError ? (
            <EmptyState
              variant="error"
              icon={AlertTriangle}
              title="Failed to load fleet health"
              description="Could not compute the Overall Health Score from container data."
            />
          ) : (
            <SpotlightCard>
              <FleetHealthSummary
                stats={healthStats}
                isLoading={isLoadingContainers}
                statusColumns={3}
                extraTiles={[
                  {
                    icon: PackageOpen,
                    label: 'Stopped',
                    value: healthStats?.stopped ?? 0,
                    percentage:
                      healthStats && healthStats.total > 0
                        ? (healthStats.stopped / healthStats.total) * 100
                        : undefined,
                  },
                  {
                    icon: ShieldAlert,
                    label: 'Security Findings',
                    value: data?.security.flagged ?? 0,
                    variant: (data?.security.flagged ?? 0) > 0 ? 'danger' : 'default',
                    onClick: () => navigate('/security/audit'),
                  },
                ]}
              />
            </SpotlightCard>
          )}
        </MotionReveal>
      </MotionStagger>
```

- [ ] **Step 4: Fix imports on Home**

The standalone Security `KpiCard` and its `TiltCard` wrapper are gone, and
`SkeletonKpi` was only used by that block's loading branch. `PackageOpen` is now
needed for the Stopped tile. Update the imports:

(a) Line 3 — add `PackageOpen`:

```tsx
import { AlertTriangle, Star, ShieldAlert, PackageOpen } from 'lucide-react';
```

(b) Line 8 — remove the `KpiCard` import (delete the whole line):

```tsx
import { KpiCard } from '@/shared/components/data-display/kpi-card';
```

(c) Line 12 — drop `SkeletonKpi`, keep `SkeletonChart`:

```tsx
import { SkeletonChart } from '@/shared/components/feedback/skeleton';
```

(d) Line 18 — remove the `TiltCard` import (delete the whole line):

```tsx
import { TiltCard } from '@/shared/components/data-display/tilt-card';
```

Note: do NOT remove `SpotlightCard`, `MotionStagger`, `MotionReveal`,
`EmptyState`, `ShieldAlert` — all still used.

- [ ] **Step 5: Run the Home tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/core/pages/home.test.tsx`
Expected: PASS (all cases — updated layout tests, new click test, and the
untouched error/loading/score/subtitle/#801 tests).

- [ ] **Step 6: Typecheck and lint (catches any leftover unused import)**

Run: `cd frontend && npx tsc --noEmit && npm run lint -w frontend`
Expected: no errors. If lint flags an unused import (e.g. `SkeletonKpi`,
`KpiCard`, `TiltCard`), remove it; if it flags `PackageOpen` unused, re-check
Step 3 wired the Stopped tile.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/core/pages/home.tsx frontend/src/features/core/pages/home.test.tsx
git commit -m "feat(home): nest Security Findings inside Overall Health pane, add Stopped tile

Removes the 4:1 hero row and the standalone Security Findings KpiCard. The
Overall Health pane is now full-width and carries Security Findings + a new
Stopped tile as extra stat tiles below the container-status tiles (even 3x2
grid), via the shared FleetHealthSummary's new extraTiles/statusColumns props.
Security Findings keeps its click-through to /security/audit."
```

---

## Task 4: Update docs

Project rule: doc updates ship with the change.

**Files:**
- Modify: `docs/ai-instructions/ui-design-system.md` (only if it describes the Home hero layout)

- [ ] **Step 1: Check for a Home-hero reference**

Run: `grep -n -i "security findings\|overall health\|fleet.health\|home hero\|4:1" docs/ai-instructions/ui-design-system.md`

- [ ] **Step 2: Update if found**

If a line describes the Home Overall Health / Security Findings layout, edit it
to read that Security Findings (and Stopped) are tiles **inside** the full-width
Overall Health pane (3×2 status grid). If there is **no** such reference, no
change is needed — note that and move on (the spec file itself is the record).

- [ ] **Step 3: Commit (only if a doc changed)**

```bash
git add docs/ai-instructions/ui-design-system.md
git commit -m "docs(home): Security Findings now nested in the Overall Health pane"
```

---

## Task 5: Full verification

- [ ] **Step 1: Targeted suites**

Run: `cd frontend && npx vitest run src/features/core/pages/home.test.tsx src/features/ai-intelligence`
Expected: all pass (Home + AI Monitor regression guard).

- [ ] **Step 2: Full frontend gates**

Run: `cd frontend && npx tsc --noEmit && npm run lint -w frontend`
Expected: clean (0 type errors, 0 lint warnings).

- [ ] **Step 3: Finish the branch**

Use `superpowers:finishing-a-development-branch`: push
`feature/home-security-inside-health`, open a PR → `dev` (link the spec), let CI
run, then squash-merge once green and clean up the worktree/branch.

---

## Self-review notes

- **Spec coverage:** Security Findings nested below the tiles (Task 3) ✓;
  Stopped tile added for even 3×2 grid (Tasks 1+3) ✓; shared-component opt-in
  props so AI Monitor is unchanged (Task 1 defaults + Task 2 guard) ✓;
  click-through to `/security/audit` preserved (Task 3) ✓; "X ignored" subtext
  dropped — tile is value+label only (accepted in spec) ✓; full-width pane,
  4:1 grid removed (Task 3) ✓; unused-import cleanup (Task 3 Step 4 + lint) ✓;
  tests for new props/click/backward-compat (Task 1) and Home layout (Task 3) ✓.
- **Type consistency:** `ExtraTile` (Task 1) is the exact shape Home builds
  (Task 3); `statusColumns: 3 | 4` default 4; `HealthStatTile.onClick?: () =>
  void` matches `ExtraTile.onClick`. `healthStats` may be `null` while loading —
  Home uses `healthStats?.stopped ?? 0` and `data?.security.flagged ?? 0`.
- **Loading note:** Security tile shows `0` in the brief window where containers
  loaded but the dashboard summary hasn't; documented in the spec, keeps the
  6-tile grid even. Acceptable.
