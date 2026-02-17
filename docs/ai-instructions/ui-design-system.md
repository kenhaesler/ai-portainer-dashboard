# UI/UX Design System

Detailed design specifications for the AI Portainer Dashboard. Referenced from CLAUDE.md when doing UI work.

## Design Principles

1. **Visual hierarchy through layout** — Bento grids with varied card sizes guide the eye from hero KPIs to supporting data.
2. **Depth and dimension** — Glassmorphic cards: backdrop blur, subtle shadows, hover lift effects.
3. **Motion with purpose** — Page transitions orient, staggered entrances reveal hierarchy, micro-interactions confirm.
4. **Progressive disclosure** — Important info first, details on interaction. Skeleton loaders mirror component layout.
5. **Accessible beauty** — WCAG AA contrast on glass effects. Respect `prefers-reduced-motion` and `prefers-reduced-transparency`.

## Technology Stack

- **Tailwind CSS v4** — CSS variables for theming, container queries, 3D transforms, OKLCH gradients, `@starting-style` for entry animations.
- **Motion (Framer Motion)** — `AnimatePresence` for page transitions, spring physics, scroll-triggered reveals. Use `LazyMotion` for bundle size.
- **Recharts** — Area charts with gradient fills, glass-styled custom tooltips, CSS variable colors, animated transitions.
- **Radix UI** — Unstyled accessibility primitives for dialogs, dropdowns, tabs, tooltips.

## Theme System

9 themes via CSS custom properties in `index.css`:
- Default light/dark
- Apple Light/Dark (glassmorphism + gradient mesh backgrounds)
- Catppuccin Latte/Frappe/Macchiato/Mocha (warm pastels)

Each theme defines: semantic colors, sidebar colors, 5 chart colors, border radius, spacing tokens. Theme transitions: 300ms on color/background properties.

## Dashboard Background (Animated)

Three modes: `none`, `gradient-mesh`, `gradient-mesh-particles`. Configured in Settings > Appearance.

**Key files:**
- `frontend/src/components/layout/dashboard-background.tsx` — `fixed inset-0 z-0` gradient mesh + particles
- `frontend/src/stores/theme-store.ts` — `DashboardBackground` type, options, store state
- `frontend/src/index.css` — Glass override rules (search for `ANIMATED BACKGROUND`)

**Glass override pattern:** When background active, sidebar/header/cards become translucent via `data-animated-bg` HTML attributes and `color-mix(in srgb, var(...) 35%, transparent)` with `!important`. Override rules MUST come AFTER Apple theme rules in `index.css`. Apple theme `& nav` rules use `:not(aside nav)` to prevent double-background on sidebar inner nav.

## Layout Patterns

- **Bento grids** — `auto-rows-[minmax(180px,1fr)]`, 1-4 column responsive
- **Hero cards** — 2-column span for primary KPIs with animated counters + sparklines
- **Sidebar** — Collapsible (60px/16rem), glassmorphic, 4 nav groups, hidden scrollbar (thin on hover)
- **Header** — Fixed top: breadcrumbs, Ctrl+K command palette, theme toggle, user menu
- **Activity Feed** — Fixed bottom: real-time events, expandable (max-h-64), translucent with animated background

## Animation Standards

| Category | Duration | Use |
|----------|----------|-----|
| Micro-interactions | 150ms | Hovers, toggles, clicks |
| State changes | 250ms | Tab switches, expand/collapse |
| Page transitions | 400ms | Route changes, modal open/close |

- **Easing:** `cubic-bezier(0.32, 0.72, 0, 1)` for entrances, spring physics for interactive elements
- **Stagger:** 40-80ms between children in lists/grids
- **GPU-only:** Animate `transform` and `opacity` only for 60fps
- **Accessibility:** All animations wrapped in `reducedMotion="user"` via `MotionConfig`

## Status Colors (Industry Standard)

```
Green  (emerald-500): Healthy, running, success
Yellow (yellow-500):  Warning, degraded, high utilization
Orange (orange-500):  Critical warning, approaching limit
Red    (red-500):     Error, down, failed, anomaly
Blue   (blue-500):    Informational, deploying, processing
Gray   (gray-500):    Unknown, stopped, inactive
Purple (purple-500):  AI-generated insight, recommendation
```
