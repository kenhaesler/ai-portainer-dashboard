# Architecture

This project's architecture documentation is maintained in [docs/ai-instructions/architecture.md](ai-instructions/architecture.md).

For detailed diagrams and data flow, see:
- [Architecture Overview](ai-instructions/architecture.md)
- [Security Checklist](ai-instructions/security-checklist.md)
- [UI Design System](ai-instructions/ui-design-system.md)

## UI notes

- Global themed scrollbar styling lives in `frontend/src/index.css` (see the comment block `GLOBAL THEMED SCROLLBAR`). It applies to `html`/`body` and any element with the `.scrollbar-themed` opt-in class, reading `--color-foreground` via `color-mix` so all 16 themes share one rule. The sidebar (`aside nav`) keeps its hover-reveal behavior via cascade order.
- `.spotlight-card` in `frontend/src/index.css` deliberately omits `transform`. A transformed ancestor creates a containing block for `position: fixed` descendants, which breaks the placement of Radix popover/select portals (the dropdown ended up at viewport `0, 0` — see #1310). Use `isolation: isolate` or `will-change: transform` if a future change needs a stacking context or GPU layer on this card, never `transform`.
- The Network Topology graph (`frontend/src/features/containers/components/network/`) renders containers grouped into Docker Compose stacks with `@xyflow/react`, laid out by `elkjs`: the root packs the (mostly disconnected) stack boxes into a compact, deterministic grid via `rectpacking` + `SEPARATE_CHILDREN`, while each stack lays out its interior with `stress`. The canvas is **static** — pan / zoom / click-to-select only, no node dragging and no force simulation — so the layout is fully reproducible from elkjs. The viewport uses a low `minZoom` (0.1) with a capped `fitView` and `onlyRenderVisibleElements` so a large fleet (~200 containers) stays readable in one zoomed-out overview. Layout/viewport constants live in `topology-graph.tsx` (`ROOT_LAYOUT_OPTIONS`, `GROUP_LAYOUT_OPTIONS`, `FIT_VIEW_OPTIONS`); see the design spec under `docs/superpowers/specs/2026-05-30-topology-overview-scale-design.md`.
