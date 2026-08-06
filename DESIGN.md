---
name: Container Insights Dashboard
description: Modern glassmorphic real-time container operations and monitoring platform
colors:
  primary: "hsl(240 5.9% 10%)"
  primary-dark: "hsl(0 0% 98%)"
  neutral-bg: "hsl(0 0% 100%)"
  neutral-bg-dark: "hsl(240 10% 3.9%)"
  card: "hsl(0 0% 100%)"
  card-dark: "hsl(240 10% 3.9%)"
  accent-blue: "#1e66f5"
  accent-mauve: "#8839ef"
  chart-1: "hsl(220 70% 50%)"
  chart-2: "hsl(160 60% 45%)"
  chart-3: "hsl(30 80% 55%)"
  chart-4: "hsl(280 65% 60%)"
  chart-5: "hsl(340 75% 55%)"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2rem, 5vw, 3.5rem)"
    fontWeight: 700
    lineHeight: "1.1"
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
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
    padding: "0.75rem 1.5rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-blue}"
---

# Design System: Container Insights Dashboard

## Overview

**Creative North Star: "The Apple Glass Control Deck"**

The Container Insights Dashboard is a high-density, real-time observability station designed for DevOps engineers and container operators. It blends modern glassmorphism—smooth backdrop blurs, subtle glowing borders, and staggered entry motion—with crisp typography and high-contrast telemetry indicators.

### Key Characteristics
- Glassmorphic backdrop blur cards with subtle borders (`backdrop-blur-md`, `border-white/10`).
- Bento-grid responsive layouts designed for scanability and high visual hierarchy.
- Rich HSL color palette with 16 switchable themes (Glass Light/Dark, Obsidian, Catppuccin, Nordic Frost, etc.).
- Animated micro-interactions using Framer Motion with strictly respected `prefers-reduced-motion`.

## Colors

The system uses HSL tokenized colors mapped across 16 thematic palettes.

### Primary
- **Primary Text & Accent** (`hsl(240 5.9% 10%)` / dark `hsl(0 0% 98%)`): Dominant surface contrast and high-priority action targets.

### Status Indicators
- **Healthy Green** (`hsl(160 60% 45%)`): Active containers, healthy nodes, 200 OK responses.
- **Warning Yellow/Orange** (`hsl(30 80% 55%)`): Anomaly detection alerts, high CPU/memory usage.
- **Critical Red** (`hsl(0 84.2% 60.2%)`): Unreachable endpoints, container crashes, injection guard blocks.
- **AI Insight Purple** (`hsl(280 65% 60%)`): LLM summaries, predictive alerts, root cause explanations.

### Named Rules
**The 10% Accent Rule.** Vibrant status and AI colors are reserved for high-signal indicators, state badges, and charts; neutral surfaces carry 90% of the screen.

## Typography

**Display & Body Font:** Inter / System UI stack (`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`)
**Mono Font:** JetBrains Mono / Fira Code monospace stack

### Hierarchy
- **Display** (700, 2.5rem - 3.5rem, 1.1 line-height): Main dashboard hero numbers and KPI totals.
- **Headline** (600, 1.5rem - 2rem, 1.2 line-height): Section headers and bento block titles.
- **Body** (400, 0.875rem - 1rem, 1.5 line-height): Container labels, log output, narrative text.
- **Label** (500, 0.75rem, uppercase, 0.05em spacing): Status pill tags, table headers, KPI metadata.

## Layout

Bento-grid topology (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`). Containers and cards adjust density dynamically between comfortable and compact modes.

## Elevation & Depth

Surfaces use glassmorphic elevation: multi-layered semi-transparent backdrops (`bg-background/80 backdrop-blur-md`), subtle border highlights (`border border-border/40`), and soft ambient drop-shadows.

### Named Rules
**The Glass Blur Rule.** Depth is created through translucent backdrop blurs and subtle border contrast rather than opaque heavy drop shadows.

## Shapes

- **Radius Scale:** `sm` (12px), `md` (16px), `lg` (20px), `xl` (24px).
- **Form Language:** Rounded rectangle cards with smooth corners, subtle border stroke, and internal 16px padding.

## Components

### Cards
- **Shape:** `rounded-2xl` (16px - 20px radius).
- **Background:** Translucent glass surface (`bg-card/70 backdrop-blur-md`).
- **Border:** `border border-border/40`.

### Buttons
- **Shape:** `rounded-xl` (12px radius).
- **Primary:** `bg-primary text-primary-foreground hover:opacity-90 transition-all`.
- **Secondary:** `bg-secondary text-secondary-foreground hover:bg-secondary/80`.

### Status Badges
- **Shape:** Fully rounded pill (`rounded-full px-2.5 py-0.5 text-xs font-medium`).
- **Healthy:** `bg-emerald-500/10 text-emerald-500 border border-emerald-500/20`.
- **Critical:** `bg-rose-500/10 text-rose-500 border border-rose-500/20`.

## Do's and Don't's

### Do:
- **Do** maintain high contrast between text and glassmorphic card backdrops.
- **Do** use semantic status colors (green/yellow/red/purple) consistently across charts and badges.
- **Do** wrap heavy data sections in skeleton loaders (`SkeletonKpi`, `SkeletonTableRow`).

### Don't:
- **Don't** use raw un-themed colors (`#ff0000`, `blue`); always use HSL CSS tokens or tailwind theme classes.
- **Don't** add heavy drop shadows on dark glass surfaces.
- **Don't** create container-mutating action buttons without the Remediation Approval workflow gating.
