# Home — move Security Findings inside the Overall Health pane

**Date:** 2026-05-30
**Branch:** `feature/home-security-inside-health`
**Base:** `origin/dev` @ `f14488a8` (contains #1352/#1353)

## Problem

On Home, the hero row is a 4:1 grid: the Overall Health pane
(`FleetHealthSummary`, with 4 inner stat tiles — Running / Healthy /
Unhealthy / No Healthcheck) on the left, and a standalone **Security Findings**
`KpiCard` on the right. The user wants Security Findings pulled *inside* the
health pane, below the existing small tiles. That leaves an awkward **5 tiles**
(odd count) in the strip, so we add one more — **Stopped** — for an even
**3 columns × 2 rows** layout.

```
Before:                              After:
┌──────────────────────┬─────────┐  ┌────────────────────────────────────┐
│ Health pane (4 fr)   │Security │  │ ◯ 92%  [Running ][Healthy ][Unhealthy]│
│ ◯ + 4 tiles          │ (1 fr)  │  │ Score  [No HC  ][Stopped ][Security ]│
└──────────────────────┴─────────┘  └────────────────────────────────────┘
```

## Goals

1. Security Findings renders as a small tile **inside** the Overall Health
   pane, in the bottom tile row, after the container-status tiles.
2. Add a **Stopped** tile so the strip is an even 3×2 grid (6 tiles).
3. The health pane becomes **full-width** (the outer 4:1 grid is removed).
4. **No change to the Health & Monitoring (AI Monitor) page**, which renders
   the same shared `FleetHealthSummary`.

## Non-goals

- No backend / data-source changes. All values already exist:
  `stats.stopped` (from `calculateHealthStats`) and `data.security.flagged`
  (from `useDashboardFull().summary`).
- No change to the insight second-row tiles (Total/Critical/Warning/Info) —
  that path is AI-Monitor-only and untouched.

## Approach (decided)

Extend the **shared** `FleetHealthSummary` with opt-in props, keeping it the
single source of truth for the hero (the drift-prevention goal of #1352).
Rejected alternatives: composing tiles directly on Home (re-introduces
Home/AI-Monitor drift); forking a Home-only variant (more code, same drift).

### `FleetHealthSummary` API additions

```ts
interface ExtraTile {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  percentage?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;          // makes the tile a button (e.g. navigate)
}

export function FleetHealthSummary({
  stats,
  isLoading,
  insightStats,
  statusColumns = 4,             // NEW — grid columns for the container-status row
  extraTiles,                    // NEW — tiles appended after the 4 status tiles
}: {
  stats: HealthStats | null;
  isLoading: boolean;
  insightStats?: InsightStats;
  statusColumns?: 3 | 4;
  extraTiles?: ExtraTile[];
})
```

- The container-status tile row's grid becomes
  `grid-cols-2 sm:grid-cols-{statusColumns}` (was hard-coded `sm:grid-cols-4`).
- `extraTiles` are rendered with `HealthStatTile` immediately after the 4
  container tiles, **in the same grid**, so 4 + 2 = 6 tiles flow into 2 rows
  of 3 when `statusColumns={3}`.
- `HealthStatTile` gains an optional `onClick`. When present, the tile's root
  becomes a `<button type="button">` with focus ring + `cursor-pointer`;
  otherwise it stays a `<div>` (unchanged markup for existing callers).

**Backward compatibility:** both new props are optional with defaults that
reproduce today's behavior exactly. AI Monitor passes neither →
`statusColumns` defaults to 4, `extraTiles` is undefined → byte-identical
render. This is the regression guard.

### Home changes (`home.tsx`)

- Remove the outer `lg:grid-cols-5` wrapper and the right-hand
  `col-span-1` Security `KpiCard` block entirely.
- Render the health pane full-width:
  ```tsx
  <MotionStagger stagger={0.05}>
    <MotionReveal>
      {isContainersError ? (
        <EmptyState … />               // unchanged error branch
      ) : (
        <SpotlightCard>
          <FleetHealthSummary
            stats={healthStats}
            isLoading={isLoadingContainers}
            statusColumns={3}
            extraTiles={extraTiles}
          />
        </SpotlightCard>
      )}
    </MotionReveal>
  </MotionStagger>
  ```
- Build `extraTiles` in Home:
  - **Stopped** — `icon=PackageOpen`, `value=healthStats.stopped`,
    `percentage` of `stats.total`, `variant='default'` (stopped ≠ error).
  - **Security Findings** — `icon=ShieldAlert`, `value=data?.security.flagged ?? 0`,
    `variant` = `'danger'` when `> 0` else `'default'`,
    `onClick={() => navigate('/security/audit')}`.
- Imports no longer needed on Home after the Security `KpiCard` is gone:
  `KpiCard`, `TiltCard`. (`ShieldAlert`, `PackageOpen` are now used by
  `extraTiles`; `SkeletonKpi` is still used elsewhere — verify before removing.)
  Lint runs at `--max-warnings=0`, so any newly-unused import fails CI and will
  be caught.

## Behavior changes (accepted)

1. **"X ignored" subtext is dropped.** The old Security card showed
   `trendValue={"{ignored} ignored"}`; the tile format is value + label only.
   Accepted per brainstorming. (If wanted later, a tooltip could restore it.)
2. **Security tile shows `0` during the brief window** where containers have
   loaded (pane visible) but `useDashboardFull` summary hasn't resolved yet.
   In practice the summary is the primary page query and resolves with/before
   containers; the `?? 0` fallback keeps the 6-tile grid even rather than
   flickering tile count. Re-renders to the real value on data arrival.
3. **Click-through preserved** — Security tile still navigates to
   `/security/audit` (now via tile `onClick` instead of a wrapping button).

## Testing (TDD)

**`fleet-health-summary.test.tsx` (new file):**
- Default render (no new props) shows exactly the 4 container tiles in a
  4-col grid and no extra tiles — pins backward compatibility.
- `statusColumns={3}` puts `sm:grid-cols-3` on the status grid.
- `extraTiles` render after the 4 container tiles with their labels/values.
- An `extraTile` with `onClick` renders a button and fires the handler on click.

**`home.test.tsx` (update):**
- Rewrite the two layout-coupled tests:
  - "renders inner stat tiles" → now also asserts **Stopped** and
    **Security Findings** render *inside* `fleet-health-hero` (6 tiles total).
  - "lays out … in a 4:1 grid" → **replace** with a test asserting the hero is
    full-width and there is no longer a separate `col-span-1` Security column;
    Security Findings lives inside `fleet-health-hero`.
- Add: clicking the Security Findings tile calls `navigate('/security/audit')`.
- Keep unchanged: error state, loading (no removed KPI cards), green-band
  score, subtitle, no Recent Containers (#801).
- Note: the existing test mocks `FleetHealthSummary`'s children as real (it is
  not mocked), so the tiles render through the real component — good.

**`ai-monitor.test.tsx`:** must still pass unchanged — the regression guard
proving the shared-component extension didn't alter AI Monitor.

**Gates:** `npx vitest run` (home + fleet-health-summary + ai-monitor),
`tsc --noEmit`, `eslint --max-warnings=0`.

## Docs

Update `docs/ai-instructions/ui-design-system.md` if it documents the Home
hero layout (verify; the sidebar entry there is unrelated).
