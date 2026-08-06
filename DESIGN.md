---
name: Container Insights
description: Glassmorphic real-time container operations and monitoring dashboard
colors:
  primary: "hsl(240 5.9% 10%)"
  primary-dark: "hsl(0 0% 98%)"
  neutral-bg: "hsl(0 0% 100%)"
  neutral-bg-dark: "hsl(240 10% 3.9%)"
  card: "hsl(0 0% 100%)"
  card-dark: "hsl(240 10% 3.9%)"
  destructive: "hsl(0 84.2% 60.2%)"
  destructive-dark: "hsl(0 62.8% 30.6%)"
typography:
  display:
    fontFamily: "system stack — see Typography; no webfont is shipped"
    fontSize: "clamp(2rem, 5vw, 3.5rem)"
    fontWeight: 700
    lineHeight: "1.1"
    letterSpacing: "-0.02em"
  body:
    fontFamily: "system stack — see Typography; no webfont is shipped"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5"
    letterSpacing: "normal"
rounded:
  sm: "0.75rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-bg}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.primary} at 90% — `hover:bg-primary/90`"
---

# Design System: Container Insights

## Overview

**Creative North Star: "The Apple Glass Control Deck"**

Container Insights is a high-density, real-time observability station for DevOps engineers
and container operators. It blends glassmorphism — backdrop blurs, subtle borders, staggered
entry motion — with high-contrast telemetry indicators.

The product's name is **Container Insights**, and it comes from one place:
`frontend/src/shared/lib/product.ts`. Import `PRODUCT_NAME`; do not type the name again. That
constant exists because the product previously answered to four different names depending on
which surface you were looking at.

### Key characteristics

- Glassmorphic backdrop-blur surfaces with subtle borders.
- Bento-grid responsive layouts.
- Fully tokenized colour, switchable across 16 themes.
- Motion via Framer Motion, respecting `prefers-reduced-motion`.

### How to read this document

Everything below states what the app **ships**, verified against the source named beside it.
Where a direction has been discussed but not adopted, it is filed under
[Considered and not adopted](#considered-and-not-adopted) rather than written as fact. That
split is the point of the file: four source comments defer to this document for design
decisions, so a claim here is read as settled.

`frontend/src/design-doc.test.ts` holds the checkable claims — the product name, the radius
scale, and the font stack — against their real sources, so this file cannot quietly drift back.

## Colors

Colour is fully tokenized. `frontend/src/index.css` declares the base `@theme`, and each of the
16 themes overrides the same custom-property names. **No token's value is global** — quoting one
theme's hex is how this document previously misdescribed the chart ramp.

### Semantic tokens

Prefer these over palette classes. Base (light) values shown; every theme overrides them.

| Token | Base value | Use |
|---|---|---|
| `--color-background` / `--color-foreground` | `hsl(0 0% 100%)` / `hsl(240 10% 3.9%)` | Page surface and default text |
| `--color-card` / `--color-card-foreground` | `hsl(0 0% 100%)` / `hsl(240 10% 3.9%)` | Panel surface |
| `--color-primary` / `--color-primary-foreground` | `hsl(240 5.9% 10%)` / `hsl(0 0% 98%)` | Primary action |
| `--color-muted-foreground` | `hsl(240 3.8% 46.1%)` | Secondary text — held to 4.5:1 in every theme by `frontend/src/theme-contrast.test.ts` |
| `--color-border` | `hsl(240 5.9% 90%)` | Hairlines and card edges |
| `--color-destructive` | `hsl(0 84.2% 60.2%)` | Destructive action, error surface |
| `--color-chart-1` … `-5` | per theme | Series colour, in order |

### Status colour

There is **no** `--color-success` / `--color-warning` token. Status colour is assigned by hue in
`frontend/src/shared/components/feedback/status-badge.tsx`, which maps ~30 status strings onto
Tailwind palette classes and is the single place that mapping lives:

| Hue | Meaning | Statuses |
|---|---|---|
| Emerald | Healthy | `running`, `healthy`, `up`, `active`, `completed`, `succeeded`, `ok`, `deployed` |
| Red | Error / stopped | `stopped`, `down`, `unhealthy`, `failed`, `error`, `critical`, `rejected` |
| Amber | Warning / waiting | `paused`, `pending`, `warning` |
| Orange | Degraded reachability | `unreachable` |
| Blue | Informational | `info`, `approved`, `capturing`, `planned`, `not_deployed` |
| Purple | AI / in-flight analysis | `executing`, `processing` |
| Gray | Inactive / unknown | `unknown`, `inactive`, `excluded`, `incompatible` |

Reach for `<StatusBadge>` rather than re-deriving this. A new status string falls back to the
gray `unknown` treatment, which is the correct failure: it does not guess.

### Named rules

**The 10% accent rule.** Vibrant status and AI colours are reserved for high-signal indicators,
state badges and charts; neutral surfaces carry 90% of the screen.

**Purple means the model said it.** Purple is reserved for LLM output — summaries, root-cause
explanations, predictive narrative. A threshold rule or a memory series is not an AI insight and
must not borrow the treatment; see CLAUDE.md's design-critique invariant 3, which names
"a rule presented as ML" as the single most repeated finding of that review. Note the four
Catppuccin themes set `--color-primary` to Mauve, so on those themes purple is *also* the
primary action colour and cannot carry the distinction alone — pair it with an explicit label.

## Typography

**No webfont is shipped.** There is no `@font-face`, no font `<link>` in `index.html`, no font
asset in the repo, and `frontend/src/index.css` declares no `--font-*` token. Type therefore
resolves to Tailwind v4's defaults, and that is what to design against:

- **Sans** — `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
  "Noto Sans", Arial, sans-serif` plus the emoji fallbacks.
- **Mono** — `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
  "Courier New", monospace`.

This is a real constraint, not a placeholder: metrics differ per platform, so avoid layouts that
depend on a specific face's advance widths, and check dense tabular views on both macOS and
Windows. Use `tabular-nums` for any column of figures that updates in place, so digits do not
jitter as values change.

### Hierarchy

| Role | Weight | Size | Line height | Use |
|---|---|---|---|---|
| Display | 700 | 2.5–3.5rem | 1.1 | Hero numbers, KPI totals |
| Headline | 600 | 1.5–2rem | 1.2 | Section headers, bento block titles |
| Body | 400 | 0.875–1rem | 1.5 | Container labels, log output, narrative |
| Label | 500 | 0.75rem, uppercase, 0.05em | 1.2 | Status pills, table headers, KPI metadata |

One `<h1>` per page, from `frontend/src/shared/components/layout/page-header.tsx`. It has no
gradient, icon or size-override prop, deliberately.

## Shapes

The radius scale is overridden in `frontend/src/index.css` and **the utility names no longer
mean what Tailwind's defaults mean**:

| Utility | This app | Tailwind default |
|---|---|---|
| `rounded-sm` | 12px | 4px |
| `rounded-md` | 16px | 6px |
| `rounded-lg` | 20px | 8px |
| `rounded-xl` | 24px | 12px |
| `rounded-2xl` | 16px *(not overridden)* | 16px |
| `rounded-3xl` | 24px *(not overridden)* | 24px |

Only `sm`/`md`/`lg`/`xl` are overridden, so the scale is **not monotonic**: `rounded-2xl` (16px)
is smaller than `rounded-lg` (20px) and equal to `rounded-md`. Stay inside `sm`–`xl`, where the
tokens are ours and the order holds. `rounded-full` remains a pill.

Shipped usage, for calibration: `rounded-md` (~400 sites) and `rounded-lg` (~280) carry the app;
`rounded-full` (~200) is pills and dots.

**Form language:** rounded rectangles, subtle border stroke, 16px internal padding.

## Layout

Bento-grid topology (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`), adjusting density
between comfortable and compact modes.

Content must be reachable: the app shell provides a skip link to `<main id="main-content">`.
Before it existed, reaching content took 22–29 Tab presses on every route.

## Elevation & depth

Semi-transparent surfaces over the animated background, with a hairline border rather than a
heavy shadow. `backdrop-blur-sm` is the workhorse (~28 sites); `backdrop-blur-md`/`-lg`/`-xl` are
reserved for surfaces that must fully separate from busy content beneath, such as overlays.

Surface opacity is chosen per pane, not fixed: `bg-card/95` and `/90` for panes that must stay
readable over the gradient mesh, `/80` and lower only where the backdrop is calm.

### Named rules

**The glass blur rule.** Depth comes from translucency and border contrast, not from opaque drop
shadows. Adding a heavy shadow to a dark glass surface muddies it rather than lifting it.

## Components

### Cards

- **Surface:** `bg-card/90` + `backdrop-blur-sm` (raise opacity over busy backgrounds).
- **Border:** `border border-border/40`.
- **Radius:** `rounded-lg` (20px) or `rounded-xl` (24px) — see [Shapes](#shapes) before reaching
  for `rounded-2xl`.

### Buttons

- **Radius:** `rounded-md` (16px).
- **Primary:** `bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50`,
  with `px-4 py-2 text-sm font-medium`.
- **Secondary:** `bg-secondary text-secondary-foreground hover:bg-secondary/80`.

Every disabled control names its reason — a `title` that is `undefined` when the control is
enabled leaves an operator with no explanation in the state most installs start in. Gate an
affordance on its real precondition, including the feature flag, not only on the ones you
remembered.

### Status badges

`<StatusBadge>`. Pill shape (`rounded-full px-2.5 py-0.5 text-xs font-medium`), an optional
leading dot, and a pulse on active statuses. Colour comes from the table in
[Status colour](#status-colour) — for example healthy is
`bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400`, and error is
**red**, not rose.

### Empty, loading and error states

`<EmptyState>` (variants `empty` / `error` / `not-configured`) and the skeleton primitives
(`SkeletonText`, `SkeletonKpi`, `SkeletonTableRow`, `SkeletonChart`, `SkeletonList`) in
`frontend/src/shared/components/feedback/`. Skeletons live inside the caller's pane chrome; they
do not wrap themselves in cards. `EmptyState` is informational only — render any retry or
settings action in the parent pane's header.

### Tables

`DataTable`. A navigating row is an anchor, not a `role="link"` row: `rowHref` wraps the first
data cell in a real `<a>` and the `<tr>` keeps its implicit `row` role. Pass controlled
`sorting` / `onSortingChange` rather than hand-rolling `<span onClick>` headers, which is how a
page ended up with `aria-sort` null on all eight columns and five of them inert.

## Do's and don't's

### Do

- **Do** use semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`) so all 16
  themes follow.
- **Do** render a figure's qualifier alongside the figure, or render neither. Before shipping a
  number, ask what would let a reader discount it — sample count, `r²`, confidence, which table
  it came from — and show that too.
- **Do** send a capped list's real total alongside it, and count with the total. "These 200 of
  3982" is honest; "All 200" over a 3982-row match is not.
- **Do** wrap heavy data sections in the skeleton primitives.

### Don't

- **Don't** hardcode un-themed colour (`#ff0000`, `blue`) — use a token, or the `StatusBadge`
  mapping for status.
- **Don't** render a default as if it were a measurement. `clampConfidenceScore` and
  `parseSeverity` return `null` when the model supplied nothing; omit the badge rather than
  printing a fallback number. Guard on null — `null * 100` is `0`, which prints a confident
  "Confidence: 0%".
- **Don't** let a guess wear the same treatment as a fact. A keyword-derived log level is marked
  `guessed` and rendered dimmed with a `?`; the emitter's own level is not.
- **Don't** add heavy drop shadows on dark glass surfaces.
- **Don't** create container-mutating action buttons without the Remediation Approval workflow
  gating them. The product is observer-first.

## Considered and not adopted

Recorded so they are not mistaken for shipped decisions, and so the next person does not
re-litigate them from scratch.

- **Inter as the display and body face.** Earlier drafts of this document asserted
  `Inter, system-ui, …`, and design critiques flagged the gap. Adopting it is a real change, not
  a documentation fix: it needs a self-hosted subset (no third-party CDN — `frontend/nginx.conf`
  sets `script-src 'self'` and the app ships no external font origin), `font-display: swap`, and
  a check that dense tables still fit at Inter's advance widths. Until that lands, the system
  stack in [Typography](#typography) is what renders.
- **JetBrains Mono / Fira Code for code and log output.** Same constraint, same reasoning. Log
  views currently render in the platform mono face.
- **A `--color-success` / `--color-warning` token pair.** Would let status colour follow each
  theme instead of using fixed Tailwind palette classes, and would make Catppuccin's Mauve
  primary less of a collision with AI purple. Not done: it means restating ~30 status mappings
  across 16 themes, and `StatusBadge` already centralizes the mapping, so the present cost is
  low.
