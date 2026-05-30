# Empty / Loading / Error States — PR 1: Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `<EmptyState>` component (variants: empty / error / not-configured) and five skeleton primitives that match content shape, so subsequent PRs can migrate the ~17 ad-hoc empty-state and ~25 ad-hoc loading-state call sites to a single canonical set.

**Architecture:** Replace the dead-export `EmptyState` at `frontend/src/shared/components/feedback/empty-state.tsx` with the new hybrid-chrome design from the spec. Add a sibling `frontend/src/shared/components/feedback/skeleton.tsx` module exporting `SkeletonText`, `SkeletonKpi`, `SkeletonTableRow`, `SkeletonChart`, `SkeletonList`. Leave the existing `LoadingSkeleton` and `SkeletonCard` in `loading-skeleton.tsx` untouched — they have 73 active call sites and get retired in PR 3. Validate end-to-end by migrating one low-traffic page (`webhooks.tsx`) as a demo, which exercises both the empty state and a loading skeleton.

**Tech Stack:** React 19, TypeScript strict, Vite, Tailwind v4 (custom theme via CSS vars), Vitest + jsdom + `@testing-library/react`, `lucide-react` for icons, existing `cn` util at `@/shared/lib/utils`, existing `SpotlightCard` at `@/shared/components/data-display/spotlight-card`.

**Spec:** `docs/superpowers/specs/2026-05-16-empty-loading-states-design.md`

**Scope:** PR 1 only. Migrations of other call sites (high-traffic in PR 2, long-tail in PR 3) are out of scope here.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/shared/components/feedback/empty-state.tsx` | **Replace** | Single `<EmptyState>` component, three variants (empty / error / not-configured), no action slot, canonical card chrome with iconchip. |
| `frontend/src/shared/components/feedback/empty-state.test.tsx` | **Create** | Vitest tests covering variant tints, default variant, optional description, custom className. |
| `frontend/src/shared/components/feedback/skeleton.tsx` | **Create** | Five skeleton primitives: `SkeletonText`, `SkeletonKpi`, `SkeletonTableRow`, `SkeletonChart`, `SkeletonList`. No card chrome — callers wrap. |
| `frontend/src/shared/components/feedback/skeleton.test.tsx` | **Create** | Vitest tests asserting row counts, prop defaults, role="status" accessibility. |
| `frontend/src/features/core/pages/webhooks.tsx` | **Modify** | Demo migration — replace one ad-hoc loading block (~line 215) and one ad-hoc empty block (~line 220) with the new primitives. |

`LoadingSkeleton`, `SkeletonCard`, and any other file are **not touched** in this PR.

---

## Conventions to follow

- **Branch:** `feature/ui-empty-loading-primitives` off `dev`. PR target: `dev`.
- **Commits:** One commit per task (Task 1, Task 2, …). Conventional commit prefixes: `feat`, `test`, `refactor`, `style`, `docs`. Subject ≤ 72 chars. No `--no-verify`.
- **Tests:** TDD throughout — failing test first, then implementation, then green. Tests live next to the component (`*.test.tsx`).
- **Imports:** Use `@/shared/...` path alias (already configured). Lucide icons named-imported: `import { Activity } from 'lucide-react'`.
- **Styling:** Tailwind utility classes only. Use `cn()` from `@/shared/lib/utils` to merge. Match existing primitive style: `'rounded-lg'`, `'border'`, `'bg-card'`, `'shadow-sm'`, `'text-muted-foreground'`, `'animate-pulse'`, `'bg-muted/40'`.
- **No comments unless non-obvious why.** Don't restate what JSX already says.
- **No `action` prop, no `children` slot on `EmptyState`.** Spec decision: state component is purely informational.

---

## Task 1: Replace EmptyState — write the failing tests

**Files:**
- Create: `frontend/src/shared/components/feedback/empty-state.test.tsx`

The existing `empty-state.tsx` is a dead export (zero callers — verified via `grep -rn "<EmptyState" frontend/src --include="*.tsx"` returns 0). We rewrite both the component and the tests from scratch. Tests first.

- [ ] **Step 1: Write the test file**

```tsx
// frontend/src/shared/components/feedback/empty-state.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity, AlertTriangle, Settings } from 'lucide-react';
import { vi } from 'vitest';
import { EmptyState } from './empty-state';

vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (s: { potatoMode: boolean }) => boolean) =>
    selector({ potatoMode: false }),
}));

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState icon={Activity} title="No traces yet" />);
    expect(screen.getByText('No traces yet')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <EmptyState
        icon={Activity}
        title="No traces yet"
        description="Run a workload to start capturing distributed traces."
      />,
    );
    expect(
      screen.getByText('Run a workload to start capturing distributed traces.'),
    ).toBeInTheDocument();
  });

  it('omits description paragraph when not provided', () => {
    const { container } = render(<EmptyState icon={Activity} title="Empty" />);
    // Only one <p> — the title sits in a <p>, no description <p> follows.
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('uses neutral muted tint for default (empty) variant', () => {
    const { container } = render(<EmptyState icon={Activity} title="t" />);
    const iconEl = container.querySelector('svg');
    expect(iconEl).toHaveClass('text-muted-foreground');
  });

  it('uses destructive tint for error variant', () => {
    const { container } = render(
      <EmptyState variant="error" icon={AlertTriangle} title="Failed" />,
    );
    const iconEl = container.querySelector('svg');
    expect(iconEl?.className).toContain('text-destructive');
  });

  it('uses amber tint for not-configured variant', () => {
    const { container } = render(
      <EmptyState variant="not-configured" icon={Settings} title="Not set up" />,
    );
    const iconEl = container.querySelector('svg');
    expect(iconEl?.className).toContain('text-amber-500');
  });

  it('renders the canonical pane chrome (border + bg-card + shadow-sm + rounded-lg)', () => {
    const { container } = render(<EmptyState icon={Activity} title="t" />);
    // SpotlightCard is the outer wrapper; the inner div carries the chrome classes.
    const inner = container.querySelector('.spotlight-card > div');
    expect(inner).toHaveClass('rounded-lg');
    expect(inner).toHaveClass('border');
    expect(inner).toHaveClass('bg-card');
    expect(inner).toHaveClass('shadow-sm');
  });

  it('applies a custom className to the outer card', () => {
    const { container } = render(
      <EmptyState icon={Activity} title="t" className="h-64" />,
    );
    expect(container.firstChild).toHaveClass('h-64');
  });

  it('renders a circular iconchip around the icon', () => {
    const { container } = render(<EmptyState icon={Activity} title="t" />);
    const chip = container.querySelector('.rounded-full');
    expect(chip).toBeInTheDocument();
    expect(chip?.querySelector('svg')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/empty-state.test.tsx
```

Expected: tests fail because the old `EmptyState` doesn't accept `icon: LucideIcon`, doesn't have the new variant names, and has the old dashed-border chrome.

---

## Task 2: Replace EmptyState — implement the new component

**Files:**
- Modify: `frontend/src/shared/components/feedback/empty-state.tsx` (full rewrite)

- [ ] **Step 1: Rewrite the component**

Replace the entire file contents with:

```tsx
// frontend/src/shared/components/feedback/empty-state.tsx
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

export type EmptyStateVariant = 'empty' | 'error' | 'not-configured';

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

const iconTintByVariant: Record<EmptyStateVariant, string> = {
  empty: 'text-muted-foreground',
  error: 'text-destructive/80',
  'not-configured': 'text-amber-500/80',
};

export function EmptyState({
  variant = 'empty',
  icon: Icon,
  title,
  description,
  className,
}: EmptyStateProps) {
  return (
    <SpotlightCard className={className}>
      <div className="flex flex-col items-center justify-center rounded-lg border bg-card p-8 text-center shadow-sm">
        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
          <Icon className={cn('h-6 w-6', iconTintByVariant[variant])} />
        </div>
        <p className="text-sm font-semibold text-foreground/80">{title}</p>
        {description && (
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </SpotlightCard>
  );
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/empty-state.test.tsx
```

Expected: all 9 tests pass.

- [ ] **Step 3: Run typecheck and lint to verify no regressions**

Run:
```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/components/feedback/empty-state.tsx \
        frontend/src/shared/components/feedback/empty-state.test.tsx
git commit -m "feat(ui): rebuild EmptyState with canonical chrome + variants"
```

---

## Task 3: Add SkeletonText primitive

**Files:**
- Create: `frontend/src/shared/components/feedback/skeleton.tsx`
- Create: `frontend/src/shared/components/feedback/skeleton.test.tsx`

`SkeletonText` is the simplest primitive — N pulsing lines, last line shorter. We create the new `skeleton.tsx` file with `SkeletonText` and grow it with each subsequent task.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/shared/components/feedback/skeleton.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonText } from './skeleton';

describe('SkeletonText', () => {
  it('renders the default number of lines (3)', () => {
    const { container } = render(<SkeletonText />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders the requested number of lines', () => {
    const { container } = render(<SkeletonText lines={6} />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6);
  });

  it('marks the last line narrower than the others', () => {
    const { container } = render(<SkeletonText lines={4} />);
    const lines = container.querySelectorAll('.animate-pulse');
    expect(lines[lines.length - 1]).toHaveClass('w-2/3');
  });

  it('exposes a status role with a loading label', () => {
    render(<SkeletonText />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('applies a custom className to the wrapper', () => {
    const { container } = render(<SkeletonText className="mt-4" />);
    expect(container.firstChild).toHaveClass('mt-4');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx
```

Expected: fails — module `./skeleton` not found.

- [ ] **Step 3: Implement SkeletonText**

Create `frontend/src/shared/components/feedback/skeleton.tsx`:

```tsx
// frontend/src/shared/components/feedback/skeleton.tsx
import { cn } from '@/shared/lib/utils';

const PULSE = 'animate-pulse rounded bg-muted/40';

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div
      className={cn('space-y-2', className)}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(PULSE, 'h-3', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/feedback/skeleton.tsx \
        frontend/src/shared/components/feedback/skeleton.test.tsx
git commit -m "feat(ui): add SkeletonText primitive"
```

---

## Task 4: Add SkeletonKpi primitive

**Files:**
- Modify: `frontend/src/shared/components/feedback/skeleton.tsx`
- Modify: `frontend/src/shared/components/feedback/skeleton.test.tsx`

`SkeletonKpi` mimics the internal shape of `KpiCard`: small label row + big number + optional sublabel. It does not include card chrome (caller wraps in `<TiltCard>` or pane).

- [ ] **Step 1: Add the failing test**

Append to `skeleton.test.tsx`:

```tsx
import { SkeletonKpi } from './skeleton';

describe('SkeletonKpi', () => {
  it('renders three stacked bars (label, big number, sublabel)', () => {
    const { container } = render(<SkeletonKpi />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders the big number bar taller than the label bar', () => {
    const { container } = render(<SkeletonKpi />);
    const bars = container.querySelectorAll('.animate-pulse');
    // bars[0] = label, bars[1] = big number, bars[2] = sublabel
    expect(bars[1]).toHaveClass('h-8');
    expect(bars[0]).toHaveClass('h-3');
  });

  it('exposes status role with loading label', () => {
    render(<SkeletonKpi />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('applies a custom className', () => {
    const { container } = render(<SkeletonKpi className="h-full" />);
    expect(container.firstChild).toHaveClass('h-full');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx -t SkeletonKpi
```

Expected: fails — `SkeletonKpi` is not exported.

- [ ] **Step 3: Implement SkeletonKpi**

Append to `skeleton.tsx`:

```tsx
export interface SkeletonKpiProps {
  className?: string;
}

export function SkeletonKpi({ className }: SkeletonKpiProps) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      <div className={cn(PULSE, 'h-3 w-1/3')} />
      <div className={cn(PULSE, 'h-8 w-1/2')} />
      <div className={cn(PULSE, 'h-3 w-2/5')} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx
```

Expected: all SkeletonText + SkeletonKpi tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/feedback/skeleton.tsx \
        frontend/src/shared/components/feedback/skeleton.test.tsx
git commit -m "feat(ui): add SkeletonKpi primitive"
```

---

## Task 5: Add SkeletonTableRow primitive

**Files:**
- Modify: `frontend/src/shared/components/feedback/skeleton.tsx`
- Modify: `frontend/src/shared/components/feedback/skeleton.test.tsx`

One table row with N cells, intended to be rendered inside an actual `<TableBody>` so the cell widths track the real table. Renders a `<tr>` with N `<td>`s, each containing a pulsing bar.

- [ ] **Step 1: Add the failing test**

Append to `skeleton.test.tsx`:

```tsx
import { SkeletonTableRow } from './skeleton';

describe('SkeletonTableRow', () => {
  it('renders the requested number of cells', () => {
    // Render inside a <table><tbody> so the <tr> is valid HTML.
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow columns={5} />
        </tbody>
      </table>,
    );
    expect(container.querySelectorAll('tr > td')).toHaveLength(5);
  });

  it('puts a pulsing bar inside each cell', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow columns={3} />
        </tbody>
      </table>,
    );
    expect(container.querySelectorAll('td > .animate-pulse')).toHaveLength(3);
  });

  it('defaults to 4 columns when no count is provided', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow />
        </tbody>
      </table>,
    );
    expect(container.querySelectorAll('td')).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx -t SkeletonTableRow
```

Expected: fails — `SkeletonTableRow` is not exported.

- [ ] **Step 3: Implement SkeletonTableRow**

Append to `skeleton.tsx`:

```tsx
export interface SkeletonTableRowProps {
  columns?: number;
  className?: string;
}

export function SkeletonTableRow({ columns = 4, className }: SkeletonTableRowProps) {
  return (
    <tr className={className}>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-3 py-2">
          <div className={cn(PULSE, 'h-3 w-full')} />
        </td>
      ))}
    </tr>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx
```

Expected: all skeleton tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/feedback/skeleton.tsx \
        frontend/src/shared/components/feedback/skeleton.test.tsx
git commit -m "feat(ui): add SkeletonTableRow primitive"
```

---

## Task 6: Add SkeletonChart primitive

**Files:**
- Modify: `frontend/src/shared/components/feedback/skeleton.tsx`
- Modify: `frontend/src/shared/components/feedback/skeleton.test.tsx`

A rectangular pulsing block sized to fit a chart slot. Two heights: `md` (192px / `h-48`) for sparkline/area-chart panes, `lg` (320px / `h-80`) for full chart panes.

- [ ] **Step 1: Add the failing test**

Append to `skeleton.test.tsx`:

```tsx
import { SkeletonChart } from './skeleton';

describe('SkeletonChart', () => {
  it('renders a single pulsing block', () => {
    const { container } = render(<SkeletonChart />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1);
  });

  it('defaults to medium height (h-48)', () => {
    const { container } = render(<SkeletonChart />);
    expect(container.firstChild).toHaveClass('h-48');
  });

  it('uses h-80 for large size', () => {
    const { container } = render(<SkeletonChart size="lg" />);
    expect(container.firstChild).toHaveClass('h-80');
  });

  it('exposes status role with loading label', () => {
    render(<SkeletonChart />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('applies a custom className', () => {
    const { container } = render(<SkeletonChart className="mt-2" />);
    expect(container.firstChild).toHaveClass('mt-2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx -t SkeletonChart
```

Expected: fails — `SkeletonChart` is not exported.

- [ ] **Step 3: Implement SkeletonChart**

Append to `skeleton.tsx`:

```tsx
export interface SkeletonChartProps {
  size?: 'md' | 'lg';
  className?: string;
}

export function SkeletonChart({ size = 'md', className }: SkeletonChartProps) {
  return (
    <div
      className={cn(PULSE, 'w-full', size === 'lg' ? 'h-80' : 'h-48', className)}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx
```

Expected: all skeleton tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/feedback/skeleton.tsx \
        frontend/src/shared/components/feedback/skeleton.test.tsx
git commit -m "feat(ui): add SkeletonChart primitive"
```

---

## Task 7: Add SkeletonList primitive

**Files:**
- Modify: `frontend/src/shared/components/feedback/skeleton.tsx`
- Modify: `frontend/src/shared/components/feedback/skeleton.test.tsx`

N list rows, each with a circular avatar/icon placeholder on the left and two stacked text bars on the right. Used for log lists, audit lists, edge-agent lists.

- [ ] **Step 1: Add the failing test**

Append to `skeleton.test.tsx`:

```tsx
import { SkeletonList } from './skeleton';

describe('SkeletonList', () => {
  it('renders the default number of rows (4)', () => {
    const { container } = render(<SkeletonList />);
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(4);
  });

  it('renders the requested number of rows', () => {
    const { container } = render(<SkeletonList rows={7} />);
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(7);
  });

  it('renders an avatar circle plus two text bars per row', () => {
    const { container } = render(<SkeletonList rows={1} />);
    const row = container.querySelector('[data-skeleton-row]');
    expect(row?.querySelector('.rounded-full')).toBeInTheDocument();
    expect(row?.querySelectorAll('.animate-pulse')).toHaveLength(3); // 1 avatar + 2 text bars
  });

  it('exposes a status role with loading label', () => {
    render(<SkeletonList />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx -t SkeletonList
```

Expected: fails — `SkeletonList` is not exported.

- [ ] **Step 3: Implement SkeletonList**

Append to `skeleton.tsx`:

```tsx
export interface SkeletonListProps {
  rows?: number;
  className?: string;
}

export function SkeletonList({ rows = 4, className }: SkeletonListProps) {
  return (
    <div
      className={cn('space-y-3', className)}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} data-skeleton-row className="flex items-center gap-3">
          <div className={cn(PULSE, 'h-8 w-8 rounded-full')} />
          <div className="flex-1 space-y-2">
            <div className={cn(PULSE, 'h-3 w-1/2')} />
            <div className={cn(PULSE, 'h-3 w-1/3')} />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd frontend && npx vitest run src/shared/components/feedback/skeleton.test.tsx
```

Expected: all skeleton tests pass (SkeletonText + SkeletonKpi + SkeletonTableRow + SkeletonChart + SkeletonList).

- [ ] **Step 5: Run lint + typecheck on the whole frontend**

Run:
```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shared/components/feedback/skeleton.tsx \
        frontend/src/shared/components/feedback/skeleton.test.tsx
git commit -m "feat(ui): add SkeletonList primitive"
```

---

## Task 8: Demo migration — webhooks.tsx

**Files:**
- Modify: `frontend/src/features/core/pages/webhooks.tsx` (around lines 213–223 and 415–419)

This proves the primitives work end-to-end on a real page. We pick `webhooks.tsx` because it has both an ad-hoc loading skeleton (two `h-10 animate-pulse` bars) and two ad-hoc dashed-border empty states, in a low-traffic page where any visual issue is easy to catch.

- [ ] **Step 1: Find the exact current state**

Run:
```bash
grep -n "No webhooks configured yet\|No deliveries recorded yet\|h-10 animate-pulse" frontend/src/features/core/pages/webhooks.tsx
```

Expected output (line numbers may have shifted slightly):
```
216:              <div className="h-10 animate-pulse rounded bg-muted" />
217:              <div className="h-10 animate-pulse rounded bg-muted" />
220:              No webhooks configured yet.
417:                <p className="mt-2 text-xs text-muted-foreground">No deliveries recorded yet.</p>
```

- [ ] **Step 2: Add the imports**

Open `frontend/src/features/core/pages/webhooks.tsx`. Near the existing `lucide-react` import, add:

```tsx
import { Webhook, Inbox } from 'lucide-react';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { SkeletonList } from '@/shared/components/feedback/skeleton';
```

(If `Webhook` or `Inbox` is already imported from `lucide-react`, don't duplicate — just add the missing names to the existing import line. If `lucide-react` isn't yet imported, add the full line.)

- [ ] **Step 3: Replace the ad-hoc loading skeleton**

Find this block (around line 213–218):

```tsx
{isLoading ? (
  <div className="space-y-2">
    <div className="h-10 animate-pulse rounded bg-muted" />
    <div className="h-10 animate-pulse rounded bg-muted" />
  </div>
) : filteredWebhooks.length === 0 ? (
```

Replace with:

```tsx
{isLoading ? (
  <SkeletonList rows={3} />
) : filteredWebhooks.length === 0 ? (
```

- [ ] **Step 4: Replace the first dashed-border empty state**

Find this block (around line 219–222):

```tsx
) : filteredWebhooks.length === 0 ? (
  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
    No webhooks configured yet.
  </div>
) : (
```

Replace with:

```tsx
) : filteredWebhooks.length === 0 ? (
  <EmptyState
    icon={Webhook}
    title="No webhooks configured yet"
    description="Create a webhook to receive events for this dashboard."
  />
) : (
```

- [ ] **Step 5: Replace the second empty state**

Find this block (around line 415–419):

```tsx
<p className="mt-2 text-xs text-muted-foreground">No deliveries recorded yet.</p>
```

(Inspect the surrounding context first — read 8 lines above and below to understand whether this `<p>` lives alone or inside a wrapper. If it's a small caption inside a panel header rather than a full empty-state slot, **do not migrate it** — leave it as the panel's normal subtitle. Only migrate it if the surrounding markup is acting as an empty-state slot, e.g., it's the entire content of the panel body when there are no deliveries.)

If migrating, replace the surrounding block with:

```tsx
<EmptyState
  icon={Inbox}
  title="No deliveries recorded yet"
  description="Deliveries for this webhook will appear here after the first event fires."
/>
```

If not migrating, document why in the commit message.

- [ ] **Step 6: Run the page's existing tests (if any) and the full frontend test suite**

Run:
```bash
cd frontend && npx vitest run --reporter=dot 2>&1 | tail -20
```

Expected: all tests pass. If `webhooks.tsx` has a test file that asserted on the old ad-hoc markup (`.border-dashed`, "No webhooks configured yet" inside specific markup), update those assertions to match the new component output.

- [ ] **Step 7: Visual smoke check**

Start the dev server and verify the page renders correctly:

```bash
npm run dev
```

Open `http://localhost:5173` (or whichever port Vite picks), log in, navigate to `/webhooks`. Confirm:
- With no webhooks: the empty state shows a circular muted iconchip, the bold title "No webhooks configured yet", and the description below.
- The empty state lives inside the same outer pane card as the rest of the panel — no shape jump.
- While the page is loading, the skeleton list shows 3 placeholder rows with a circle and two text bars each.

Stop the dev server with Ctrl+C when done.

- [ ] **Step 8: Run lint and typecheck**

Run:
```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/core/pages/webhooks.tsx
git commit -m "refactor(ui): migrate webhooks page to new EmptyState + SkeletonList"
```

---

## Task 9: Update CLAUDE.md guidance + spec link

**Files:**
- Modify: `CLAUDE.md` (root) — add a one-liner under "UI/UX Design" pointing at the new primitives.

The project CLAUDE.md should tell future agents that empty/loading/error states have canonical primitives now. One sentence is enough; the spec doc holds the rest.

- [ ] **Step 1: Find the "UI/UX Design" section**

Run:
```bash
grep -n "## UI/UX Design" CLAUDE.md
```

Expected: one line, near the middle of the file.

- [ ] **Step 2: Append a sentence to the UI/UX paragraph**

Open `CLAUDE.md`. In the UI/UX Design section, append to the paragraph (after the "Status colors" line):

```markdown
**Empty / loading / error states:** Use `<EmptyState>` (variants: `empty` / `error` / `not-configured`) and the skeleton primitives (`SkeletonText`, `SkeletonKpi`, `SkeletonTableRow`, `SkeletonChart`, `SkeletonList`) in `frontend/src/shared/components/feedback/`. Skeletons live inside the caller's pane chrome — they do not wrap themselves in cards. EmptyState is purely informational; render any retry / settings action in the parent pane's header. See `docs/superpowers/specs/2026-05-16-empty-loading-states-design.md` for the full rationale.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note new EmptyState + skeleton primitives in CLAUDE.md"
```

---

## Task 10: Open the pull request

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin feature/ui-empty-loading-primitives
```

If the pre-push hook (Husky) runs the test suite and fails on an unrelated flaky test, re-run the push once. Do not use `--no-verify`.

- [ ] **Step 2: Create the PR**

Run:
```bash
gh pr create --base dev --title "feat(ui): empty-state + skeleton primitives (PR 1 of 3)" --body "$(cat <<'EOF'
## Summary
- Rebuilds the previously-dead `<EmptyState>` export with the hybrid canonical-card chrome from the design spec — variants `empty` / `error` / `not-configured`, no action slot.
- Adds five skeleton primitives (`SkeletonText`, `SkeletonKpi`, `SkeletonTableRow`, `SkeletonChart`, `SkeletonList`) at `frontend/src/shared/components/feedback/skeleton.tsx`. Each matches the shape of the content it stands in for; none wraps itself in card chrome (callers do that).
- Demo-migrates the webhooks page so the new primitives are exercised in a real page.
- Existing `LoadingSkeleton` and `SkeletonCard` are untouched — they have 73 active call sites and will be retired in PR 3.

## Out of scope
- The ~17 ad-hoc empty-state and ~25 ad-hoc loading-state call sites scattered across the app. Those migrate in PR 2 (high-traffic pages) and PR 3 (long tail + legacy cleanup).

## Test plan
- [x] `cd frontend && npx vitest run src/shared/components/feedback/` — all new tests pass
- [x] `cd frontend && npx tsc --noEmit` — clean
- [x] `cd frontend && npm run lint` — clean
- [x] Visual check on `/webhooks` — empty state renders with iconchip + canonical chrome; loading state renders three skeleton rows; no layout shift when data arrives.

Design spec: `docs/superpowers/specs/2026-05-16-empty-loading-states-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: the command returns a PR URL. Open it to confirm the description rendered correctly.

---

## Self-review notes

- **Spec coverage:** All four spec decisions are implemented — hybrid chrome (Task 2), single component with variants (Task 2), skeleton primitives matching content shape (Tasks 3–7), no action slot (Task 2 component signature). The migration sequence is staged across PR 1/2/3 as the spec called for; this plan is PR 1.
- **Placeholder scan:** No "TBD" / "TODO" / "implement later" steps. Every code-changing step includes the exact code or the exact `grep`/`find` command. Step 5 of Task 8 has a conditional ("inspect surrounding context") — that's a deliberate judgment point, not a placeholder, because the line in question may be a caption rather than an empty-state slot.
- **Type consistency:** `EmptyStateVariant` matches between the type export, the `iconTintByVariant` record key, and all test assertions. `SkeletonKpi` / `SkeletonText` / `SkeletonTableRow` / `SkeletonChart` / `SkeletonList` names match between definitions, tests, the demo migration, and the CLAUDE.md note.
- **Spec items not in plan:** "ESLint custom rule or grep-based CI check to flag re-introduction of ad-hoc empty/loading markup" — spec marks this optional and defer-able. Not in PR 1. Revisit after PR 3.
