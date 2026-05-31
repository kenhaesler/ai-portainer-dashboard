# Infrastructure: slim per-tab status KPI

**Date:** 2026-05-31
**Branch:** `feature/infra-tab-status-kpi`

## Problem

The Infrastructure page (`frontend/src/features/containers/pages/fleet-overview.tsx`)
renders a combined endpoint + stack status card (`FleetStatusSummary`, wrapped in a
`SpotlightCard`) directly below the page title. This card duplicates information that
belongs with each tab's data, and the status pills it exposes are detached from the
search/filter row of the tab they affect.

## Goal

Remove the title-level status card. Surface status inline on each tab's search row as a
slim, clickable KPI, and move the existing Status/Type dropdowns to a second row beneath
the search bar. Apply the same treatment to both **Fleet Overview** (endpoints) and
**Stack Overview** (stacks). The Kubernetes tab is unchanged.

## Decisions (confirmed with user)

- **KPI is a clickable filter**, preserving the old pill behavior. Clicking a pill toggles
  the same URL-backed status filter the Status dropdown drives; the dropdown and pills stay
  in sync. The Status dropdown is retained.
- **Layout:** the grid/table view toggle stays on the search row (right of the KPI); the
  `N of M` filtered-count text moves to the lower (dropdown) row.

## Design

### Remove
- The `SpotlightCard` + `FleetStatusSummary` block below the page title.
- `frontend/src/features/containers/components/fleet/fleet-status-summary.tsx` and its test
  `fleet-status-summary.test.tsx` (behavior moves into the new slim KPI).

### Add — `StatusKpi` (presentational)
`frontend/src/features/containers/components/fleet/status-kpi.tsx`

- Renders only a row of clickable status pills (e.g. `● 5 Up   ● 1 Down`). No total label,
  no progress bar, no card chrome — slim enough to sit inline on the search row.
- Reuses the existing animated pill styling: status dot + colored capitalized label +
  muted count, `ring-2 ring-primary` when active, `opacity-50` at count 0, respects
  `prefers-reduced-motion`.
- Purely presentational. Props:
  ```ts
  interface StatusKpiPill {
    key: string;
    label: string;            // "Up" / "Down" / "Active" / "Inactive"
    count: number;
    isActive: boolean;
    colors: { dot: string; text: string };
    onClick: () => void;
  }
  interface StatusKpiProps {
    pills: StatusKpiPill[];
    ariaLabel: string;        // e.g. "Endpoint status" / "Stack status"
  }
  ```
- The page wires `onClick` / `isActive` to the **existing** handlers/state already in
  `fleet-overview.tsx`: `handleEndpointStatusPillChange` + `activeEndpointStatusPill`
  (endpoints) and `handleStackStatusPillChange` + `activeStackStatusPill` (stacks).
- Counts are computed from the **unfiltered** endpoint / stack lists (matching the old
  summary-bar semantics).

### Layout — Fleet Overview and Stack Overview tabs (two rows)
- **Row 1:** `[ FleetSearch (flex-1) ]  [ StatusKpi pills ]  [ grid/table toggle ]`
- **Row 2:** `[ Status ▾ ]  [ Type/Endpoint ▾ ]  [ "N of M …" count ]`

Color maps (Up/Down, Active/Inactive) move from `fleet-status-summary.tsx` into the page or
the new component as needed.

## Testing

- New `status-kpi.test.tsx`: renders pills with counts, fires `onClick`, reflects
  `isActive` (ring), dims zero counts, exposes `ariaLabel`.
- Update `fleet-overview.test.tsx` / `fleet-overview-cards.test.tsx` where they assert the
  old `summary-bar` markup; assert dropdowns now render below the search bar. The Stacks tab
  is driven via the initial route (`?tab=stacks`), not click, per the URL-driven-tab pattern.

## Out of scope
- Kubernetes tab layout.
- Any change to filtering logic / URL params beyond moving the controls.
