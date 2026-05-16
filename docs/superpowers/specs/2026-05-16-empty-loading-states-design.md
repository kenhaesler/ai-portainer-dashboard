# Empty / Loading / Error States — Design Spec

**Date:** 2026-05-16
**Scope:** Sub-project #1 of the UI consistency program. Standardize the three "non-data" states (empty, error, not-configured) and the loading state that precedes them.
**Status:** Design — ready for implementation planning.

## Problem

Audit of `frontend/src/` found:

- **17+ empty-state variants** — dashed borders, solid cards, plain text, centered icon+text, three-line CTA blocks. No two pages render "no data yet" the same way.
- **25+ loading-state files** — `Loader2` spinners, `<p>Loading...</p>` text, ad-hoc skeleton boxes, no skeletons at all (blank pane until data arrives).
- **15+ error-state variants** — red borders, alert icons, raw error strings, toast-only.

The result: every page negotiates its own "what does nothing-here look like" decision, and the answers conflict visually. This sub-project gives every page one set of primitives so the chrome is decided once.

## Decisions

Selected via brainstorming session 2026-05-16:

1. **Empty-state chrome — Hybrid** (canonical card + iconchip + muted text). Same outer shell as a populated data pane (`bg-card`, `border`, `shadow-sm`, `rounded-lg`), so the pane does not change shape when data arrives. Distinguished only by content: a circular muted iconchip, slightly reduced text opacity, no chart/table inside.
2. **Component structure — Single `<EmptyState>` with variants.** One component, `variant="empty" | "error" | "not-configured"`. One place to change chrome; variant prop drives the (small) differences in iconchip tint and default copy color.
3. **Loading — skeletons matching content shape.** No spinners inside panes. Skeleton primitives mimic the eventual content (KPI tile shape, table rows, chart bars, list rows). No layout shift when data arrives.
4. **No action affordances inside `<EmptyState>`.** The component is purely informational — chrome + iconchip + title + body. Any retry buttons, settings links, or other CTAs are the caller's responsibility and live outside the component (typically in the parent pane's header).

## Component API

### `<EmptyState>`

Lives at `frontend/src/shared/components/feedback/empty-state.tsx`.

```tsx
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  /** Visual variant — drives iconchip tint and minor color shifts. */
  variant?: 'empty' | 'error' | 'not-configured';
  /** Lucide icon rendered inside the muted circular chip. */
  icon: LucideIcon;
  /** Primary line — short, sentence case. e.g. "No traces yet". */
  title: string;
  /** Optional supporting copy. One sentence, ends with a period. */
  description?: string;
  /** Optional extra Tailwind classes on the outer card. */
  className?: string;
}
```

Renders:

```tsx
<SpotlightCard className={className}>
  <div className="flex flex-col items-center justify-center rounded-lg border bg-card p-8 shadow-sm text-center">
    <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
      <Icon className={cn('h-6 w-6', iconColorFor(variant))} />
    </div>
    <p className="text-sm font-semibold text-foreground/80">{title}</p>
    {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
  </div>
</SpotlightCard>
```

Variant tints (`iconColorFor`):

| Variant | Icon tint | Rationale |
|---|---|---|
| `empty` (default) | `text-muted-foreground` | Neutral — "nothing yet" is not a problem. |
| `error` | `text-destructive/80` | Subdued red — visible without alarming. |
| `not-configured` | `text-amber-500/80` | Amber — "action needed, not broken". |

No action slot. No `children`. If a page needs a retry button, it renders the button in its pane header alongside the title — not inside the state component.

### Skeleton primitives

Live at `frontend/src/shared/components/feedback/skeleton.tsx` (extends the existing pattern if any). All use a single shared pulse animation (`animate-pulse bg-muted/40 rounded`).

| Primitive | Use for |
|---|---|
| `<SkeletonText lines={n} />` | Body copy, descriptions, multi-line content. Lines vary slightly in width for natural feel. |
| `<SkeletonKpi />` | A single KPI tile's label + big-number + sublabel. Matches `KpiCard` internal shape. |
| `<SkeletonTableRow columns={n} />` | One table row with `n` cells. Caller renders N of them inside the real `<TableBody>`. |
| `<SkeletonChart height="md" \| "lg" />` | Block matching a chart's footprint. Caller wraps in their own pane chrome. |
| `<SkeletonList rows={n} />` | List of rows (avatar + text), e.g. for log lists, audit lists. |

**Important:** skeletons do **not** wrap themselves in pane chrome. The caller renders skeletons inside the same `<SpotlightCard><div className="rounded-lg border bg-card p-6 shadow-sm">…</div></SpotlightCard>` shell it would use for real content. This is what makes the transition seamless.

Example KPI loading row:

```tsx
{isLoading ? (
  <>
    <TiltCard><SkeletonKpi /></TiltCard>
    <TiltCard><SkeletonKpi /></TiltCard>
    <TiltCard><SkeletonKpi /></TiltCard>
    <TiltCard><SkeletonKpi /></TiltCard>
  </>
) : (
  <>
    <TiltCard><KpiCard ... /></TiltCard>
    ...
  </>
)}
```

## Usage patterns

### Pane with no data

```tsx
<SpotlightCard>
  <div className="rounded-lg border bg-card p-6 shadow-sm">
    <h3 className="mb-4 text-sm font-medium text-muted-foreground">Recent traces</h3>
    {traces.length === 0 ? (
      <EmptyState
        icon={Activity}
        title="No traces yet"
        description="Run a workload to start capturing distributed traces."
      />
    ) : (
      <TracesTable rows={traces} />
    )}
  </div>
</SpotlightCard>
```

Note: `<EmptyState>` here is nested inside the pane — it renders its own inner card, and the visual effect is intentional. The outer pane keeps its title row; the inner card displays the empty marker centered. If the pane has no title row, `<EmptyState>` can stand alone as the pane content.

### Standalone empty pane

```tsx
{cards.length === 0 ? (
  <EmptyState icon={Inbox} title="Nothing here yet" />
) : (
  <CardGrid cards={cards} />
)}
```

### Error state (fetch failed)

```tsx
{error ? (
  <EmptyState
    variant="error"
    icon={AlertTriangle}
    title="Couldn't load metrics"
    description={error.message}
  />
) : ...}
```

If a retry control is needed:

```tsx
<SpotlightCard>
  <div className="rounded-lg border bg-card p-6 shadow-sm">
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-sm font-medium text-muted-foreground">Metrics</h3>
      {error && <Button size="sm" variant="ghost" onClick={refetch}>Retry</Button>}
    </div>
    {error ? <EmptyState variant="error" icon={AlertTriangle} title="Couldn't load metrics" /> : <Chart .../>}
  </div>
</SpotlightCard>
```

### Not-configured state

```tsx
<EmptyState
  variant="not-configured"
  icon={Settings}
  title="Harbor isn't configured"
  description="Add Harbor credentials in Settings to surface registry vulnerabilities here."
/>
```

The "open settings" link, if any, lives in the pane's header — not inside the state component.

### Loading state

```tsx
<SpotlightCard>
  <div className="rounded-lg border bg-card p-6 shadow-sm">
    <h3 className="mb-4 text-sm font-medium text-muted-foreground">Recent traces</h3>
    {isLoading ? (
      <SkeletonList rows={6} />
    ) : traces.length === 0 ? (
      <EmptyState icon={Activity} title="No traces yet" description="Run a workload to start capturing distributed traces." />
    ) : (
      <TracesTable rows={traces} />
    )}
  </div>
</SpotlightCard>
```

## Copy guidelines

Each state component instance must include:

- **Title** — short, sentence case, no period. ≤ 6 words. "No traces yet", not "No traces have been captured yet."
- **Description** (optional) — one sentence, ends with a period. Tells the user what action would change the state. "Run a workload to start capturing distributed traces." not "Empty list."

Anti-patterns to remove during migration:

- "Loading…" / "Loading..." text → replace with skeletons.
- "Error: <raw stack trace>" → replace with `<EmptyState variant="error">` and a user-readable message; raw error goes to console + telemetry.
- Plain centered `<p className="text-muted-foreground">No data</p>` → replace with `<EmptyState>`.

## Migration plan

The full sweep across 17+ empty-state and 25+ loading-state sites is large. Implement in three sequenced PRs to keep reviews tractable:

**PR 1 — Primitives + tests**
- Build `<EmptyState>` and the five skeleton primitives in `shared/components/feedback/`.
- Write Vitest tests covering each variant's tint, missing-description fallback, and skeleton row counts.
- Storybook-style smoke usage in a single page (pick a low-traffic page, e.g. `webhooks.tsx`) to validate visually.
- No other call-site migrations.

**PR 2 — High-traffic page migrations**
- Convert empty + loading + error states on: `home.tsx`, `workload-explorer.tsx`, `fleet-overview.tsx`, `metrics-dashboard.tsx`, `trace-explorer.tsx`, `llm-observability.tsx`, `ai-monitor.tsx`.
- Delete now-dead ad-hoc empty/loading components encountered along the way.
- Update existing tests that asserted the old markup.

**PR 3 — Long-tail migrations + cleanup**
- Remaining pages (audit, settings, users, webhooks already covered, packet-capture, edge-agent-logs, harbor, ebpf, status, log-viewer, reports, etc.).
- Run a `grep` pass for `Loading...`, dashed borders, `Loader2` inside panes, and `text-muted-foreground.*No ` patterns to catch stragglers.
- Add an ESLint custom rule or simple grep-based CI check to flag re-introduction of ad-hoc empty/loading markup (optional, defer if time-bound).

## Out of scope

- Skeleton design for animations (e.g., shimmer gradient) — deferred. Use plain pulse for now; revisit if it feels flat.
- Toast / inline error banners — separate concern from per-pane error states. Not touched here.
- Modal / dialog empty states — same `<EmptyState>` works inside dialogs but the migration sweep targets pages only.
- Mobile-specific layout adjustments — current breakpoints carry through; no responsive variants planned for the primitives.

## Open questions for plan phase

- Should we ship the primitives behind a feature flag? (Default: no — pure visual, low risk.)
- Snapshot tests for the primitives — useful or noise? Recommend: per-variant render assertion (icon present, title text, correct variant class), no DOM snapshots.
- Does `<EmptyState>` need a `size="sm" | "md"` prop for in-row vs full-pane use? (Default: no — start with one size, add later if a need surfaces.)

## Acceptance criteria

Sub-project #1 is complete when:

1. `<EmptyState>` and the five skeleton primitives exist in `shared/components/feedback/` with passing Vitest tests.
2. All 17 audited empty-state call sites use `<EmptyState>`.
3. All loading states inside pane chromes use skeleton primitives (spinners only remain in non-pane contexts like button loading states).
4. All error states inside pane chromes use `<EmptyState variant="error">`.
5. `grep -r "Loading\\.\\.\\." frontend/src --include="*.tsx"` returns no matches inside pane bodies.
6. No regression in existing UI tests; new tests cover the primitives.
