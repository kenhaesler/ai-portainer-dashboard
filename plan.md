# Implementation Plan: Merge Container Health + AI Monitor (Issue #1004)

## Overview

Merge Container Health (`/health`, 354 lines) and AI Monitor (`/ai-monitor`, 1086 lines) into a single unified page at `/health`. Fix a pre-existing backend bug where `healthStatus` is incorrectly mapped. The AI Monitor page is the "survivor" — health stats are added as a top section.

**4 phases, ordered by dependency.** Each phase is independently testable.

---

## Phase 1: Backend Bug Fix — Correct `healthStatus` Mapping

Fix the root cause before building features that depend on correct data.

### 1.1 Fix normalizer (`packages/core/src/portainer/portainer-normalizers.ts`)

**Line 208** — Replace:
```ts
healthStatus: c.Labels?.['com.docker.compose.service'],
```
With health parsing from the Docker `Status` string (e.g. `"Up 2 hours (healthy)"`):
```ts
healthStatus: (() => {
  const s = c.Status || '';
  if (s.includes('(healthy)')) return 'healthy';
  if (s.includes('(unhealthy)')) return 'unhealthy';
  if (s.includes('(health:')) return 'starting';
  return undefined;
})(),
```
Pattern already exists in `packages/security/src/services/security-scanner.ts:125-129`. No interface or schema changes needed — `healthStatus` is already typed `string | undefined`.

### 1.2 Add normalizer test (NEW: `packages/core/src/portainer/__tests__/portainer-normalizers.test.ts`)

Test cases:
- `Status: "Up 2 hours (healthy)"` → `healthStatus: 'healthy'`
- `Status: "Up 10 minutes (unhealthy)"` → `healthStatus: 'unhealthy'`
- `Status: "Up 5 minutes (health: starting)"` → `healthStatus: 'starting'`
- `Status: "Up 1 hour"` (no health check) → `healthStatus: undefined`
- `Status: ""` (empty) → `healthStatus: undefined`

### Phase 1 verification
```bash
npm run test -w backend  # Verify normalizer tests pass
npm run typecheck        # Verify no type errors
```

---

## Phase 2: Merge Pages — Add Health Summary to AI Monitor

The core work. AI Monitor absorbs health stats as a top section.

### 2.1 Add Fleet Health Summary to AI Monitor (`frontend/src/features/ai-intelligence/pages/ai-monitor.tsx`)

**New imports:**
- `useContainers` from `@/features/containers/hooks/use-containers`
- `useForceRefresh` from `@/shared/hooks/use-force-refresh`
- Icons: `HeartPulse`, `Pause` from `lucide-react`

**Add internal components** (ported from `container-health.tsx`):
- `calculateHealthStats()` function (lines 32-57) — pure utility, no deps
- `StatCard` component (lines 59-98) — self-contained presentational component

**In `AiMonitorPage` component:**
- Add `useContainers()` hook call alongside existing hooks
- Add `useForceRefresh('containers', containerRefetch)`
- Compute `stats`, `healthPercentage`, `unhealthyContainers` via `useMemo`

**New page layout (top → bottom):**
1. Header: **"Health & Monitoring"** + auto-refresh + refresh button
2. **NEW: Overall Health Score** hero card (gradient bg, percentage, circle icon)
3. **NEW: StatCard grid** (4 cols: Running, Healthy, Unhealthy, Stopped)
4. Insight stats row (Total/Critical/Warning/Info) + severity subscription toggles *(existing)*
5. Correlated Anomalies section *(existing)*
6. Active Incidents section *(existing)*
7. Insights feed with filters *(existing)*

**Consider extracting** the health summary as `frontend/src/features/ai-intelligence/components/health-summary.tsx` to keep the page under ~1200 lines. This component would own `calculateHealthStats`, `StatCard`, the hero card, and the stats grid.

### 2.2 Delete Container Health page

- Delete `frontend/src/features/containers/pages/container-health.tsx`

**What is NOT ported** (intentionally dropped):
- Static hardcoded "AI Health Assessment" panel — replaced by real AI investigations
- "Ask AI" button linking to `/assistant` — investigations provide this natively
- `UnhealthyContainerRow` component — unhealthy containers surface through insights/anomalies

### Phase 2 verification
```bash
npm run typecheck
npm run dev              # Visual check: /health shows health stats + AI monitor content
```

---

## Phase 3: Routing, Navigation, and Reference Updates

### 3.1 Router (`frontend/src/router.tsx`)

| Line | Change |
|------|--------|
| 14 | Remove `const ContainerHealth = lazy(...)` import |
| 80 | Replace ContainerHealth route → `{ path: 'health', element: <LazyPage><AiMonitor /></LazyPage> }` |
| 84 | Replace AiMonitor route → `{ path: 'ai-monitor', element: <Navigate to="/health" replace /> }` |

Add `import { Navigate } from 'react-router-dom'` if not already imported.

### 3.2 Sidebar (`frontend/src/features/core/components/layout/sidebar.tsx`)

| Line | Change |
|------|--------|
| 67 | Change label: `'Container Health'` → `'Health & Monitoring'` (keep `HeartPulse` icon, keep in Containers group) |
| 77 | **Remove** `{ label: 'Monitor', to: '/ai-monitor', icon: Brain }` from Intelligence group |

### 3.3 Mobile nav (`frontend/src/features/core/components/layout/mobile-bottom-nav.tsx`)

| Line | Change |
|------|--------|
| 33 | Keep `{ label: 'Health', to: '/health', icon: HeartPulse }` (already correct) |
| 42 | **Remove** `{ label: 'Monitor', to: '/ai-monitor', icon: Brain }` from secondaryNav |

### 3.4 Command palette (`frontend/src/features/core/components/layout/command-palette.tsx`)

| Line | Change |
|------|--------|
| 54 | Change label: `'Container Health'` → `'Health & Monitoring'` |
| 58 | **Remove** `{ label: 'Monitor', to: '/ai-monitor', icon: Brain }` |
| ~204 | Update filter if it references the old label |

### 3.5 Header breadcrumbs (`frontend/src/features/core/components/layout/header.tsx`)

| Line | Change |
|------|--------|
| 14 | Change `'/health': 'Container Health'` → `'/health': 'Health & Monitoring'` |
| 17 | **Remove** `'/ai-monitor': 'AI Monitor'` |

### 3.6 Keyboard shortcuts (`frontend/src/features/core/components/layout/app-layout.tsx`)

| Line | Change |
|------|--------|
| 82 | Update label: `'Go to Health'` → `'Go to Health & Monitoring'` |
| 85 | **Remove** `{ keys: 'ga', action: () => navigate('/ai-monitor'), label: 'Go to AI Monitor' }` |

### 3.7 Keyboard shortcuts overlay (`frontend/src/shared/components/ui/keyboard-shortcuts-overlay.tsx`)

| Line | Change |
|------|--------|
| 21 | Update label: `'Go to Health'` → `'Go to Health & Monitoring'` |
| 24 | **Remove** `{ keys: ['g', 'a'], label: 'Go to AI Monitor' }` |

### 3.8 Investigation detail (`frontend/src/features/ai-intelligence/pages/investigation-detail.tsx`)

| Line | Change |
|------|--------|
| 56, 89 | Change `to="/ai-monitor"` → `to="/health"` |
| 60 | Change `"Back to AI Monitor"` → `"Back to Health & Monitoring"` |

### 3.9 Leave as-is (no changes needed)

- `remediation.tsx:214` — `suggested_by: 'AI Monitor'` is backend data, not a nav label
- `remediation.test.tsx:39` — same, backend fixture data

### Phase 3 verification
```bash
npm run typecheck
npm run dev              # Test: sidebar, mobile nav, command palette, shortcuts, /ai-monitor redirect
```

---

## Phase 4: Test Updates

### 4.1 Update AI Monitor tests (`frontend/src/features/ai-intelligence/pages/ai-monitor.test.tsx`)

**Add mocks:**
```ts
vi.mock('@/features/containers/hooks/use-containers', () => ({
  useContainers: vi.fn().mockReturnValue({
    data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false,
  }),
}));

vi.mock('@/shared/hooks/use-force-refresh', () => ({
  useForceRefresh: vi.fn().mockReturnValue({
    forceRefresh: vi.fn(), isForceRefreshing: false,
  }),
}));
```

**Update existing tests:**
- Line 139: Change title assertion from `'AI Monitor'` to `'Health & Monitoring'`

**Add new tests:**
- Health stat cards render with container data (running/healthy/unhealthy/stopped counts)
- Health percentage displays correctly (e.g., 4 healthy of 5 total = 80.0%)
- Health score icon: green CheckCircle2 for ≥80%, amber AlertCircle for ≥50%, red XCircle for <50%
- Loading state: health section shows skeletons while containers load, insights section independent
- Empty state: no containers → health score shows 0%

### 4.2 Update login test (`frontend/src/features/core/pages/login.test.tsx`)

- **Line 105:** Change `defaultLandingPage: '/ai-monitor'` → `'/health'`
- Check if backend has stored `/ai-monitor` as default landing page for any users — if so, the `/ai-monitor` redirect in router handles this gracefully

### 4.3 Update mobile nav test (`frontend/src/features/core/components/layout/mobile-bottom-nav.test.tsx`)

- Remove or update the assertion that checks for `"Monitor"` text in secondary nav (since the Monitor entry is removed)

### 4.4 Update E2E test (`e2e/navigation.spec.ts`)

- **Line 19:** Change `{ label: /container health/i, urlPattern: /\/health/ }` to `{ label: /health & monitoring/i, urlPattern: /\/health/ }`
- **Add test:** Navigate to `/ai-monitor`, verify redirect to `/health`

### Phase 4 verification
```bash
npm run test -w frontend   # All unit tests pass
npm run test -w backend    # Backend tests still pass
npm run lint               # No lint errors
npm run typecheck          # No type errors
npx playwright test        # E2E tests pass (if environment supports it)
```

---

## Dependency Graph

```
Phase 1 (Backend bug fix)
    │
    ▼
Phase 2 (Page merge) ← depends on correct healthStatus data
    │
    ├──► Phase 3 (Routing/nav) ← depends on deleted page
    │
    └──► Phase 4 (Tests) ← depends on all prior phases
```

Phases 3 and 4 can be partially interleaved since many nav changes are independent of test updates.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Merged page too large (>1200 lines) | Extract `HealthSummarySection` as separate component |
| Stale `/ai-monitor` bookmarks/links | Router redirect handles this |
| Users with `/ai-monitor` as default landing page | Redirect works transparently; no migration needed |
| `ga` keyboard shortcut freed up | Verify no other feature claims it before removing |
| Data loading waterfall | Both `useContainers` and `useMonitoring` fire on mount in parallel — no serial dependency |
| Backend `/health` API route conflict | Frontend `/health` is on a different port — no actual conflict |

---

## Files Summary (16 files + 1 new)

| # | File | Action |
|---|------|--------|
| 1 | `packages/core/src/portainer/portainer-normalizers.ts` | Fix healthStatus (line 208) |
| 2 | `packages/core/src/portainer/__tests__/portainer-normalizers.test.ts` | **NEW** — normalizer tests |
| 3 | `frontend/src/features/ai-intelligence/pages/ai-monitor.tsx` | Major refactor — add health summary |
| 4 | `frontend/src/features/containers/pages/container-health.tsx` | **DELETE** |
| 5 | `frontend/src/router.tsx` | Route consolidation + redirect |
| 6 | `frontend/src/features/core/components/layout/sidebar.tsx` | Merge nav items |
| 7 | `frontend/src/features/core/components/layout/mobile-bottom-nav.tsx` | Remove Monitor entry |
| 8 | `frontend/src/features/core/components/layout/command-palette.tsx` | Merge entries |
| 9 | `frontend/src/features/core/components/layout/header.tsx` | Merge breadcrumb labels |
| 10 | `frontend/src/features/core/components/layout/app-layout.tsx` | Remove `ga` shortcut |
| 11 | `frontend/src/shared/components/ui/keyboard-shortcuts-overlay.tsx` | Remove `ga` label |
| 12 | `frontend/src/features/ai-intelligence/pages/investigation-detail.tsx` | Update "Back" links |
| 13 | `frontend/src/features/ai-intelligence/pages/ai-monitor.test.tsx` | Add health section tests |
| 14 | `frontend/src/features/core/pages/login.test.tsx` | Update landing page ref |
| 15 | `frontend/src/features/core/components/layout/mobile-bottom-nav.test.tsx` | Remove Monitor assertion |
| 16 | `e2e/navigation.spec.ts` | Update nav test + add redirect test |
| 17 | `frontend/src/features/operations/pages/remediation.tsx` | No change (backend data) |
| 18 | `frontend/src/features/operations/pages/remediation.test.tsx` | No change (backend data) |
