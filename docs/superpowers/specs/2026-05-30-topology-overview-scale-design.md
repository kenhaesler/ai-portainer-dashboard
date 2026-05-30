# Network Topology — Zoomed-Out Static Overview at Scale

**Date:** 2026-05-30
**Branch:** `feature/topology-overview-scale`
**Status:** Approved design, pending implementation plan

## Problem

In production the fleet has ~200 containers grouped into dozens of Docker Compose
stacks. The Network Topology view does not read well at that scale:

- The top level uses an organic ELK `stress` layout, so stack boxes scatter into
  a cloud with no grid alignment — hard to scan, different every render.
- React Flow's default `minZoom` is `0.5`, so the whole fleet cannot be zoomed
  out to fit; the overview is always partial.
- A `d3-force` simulation makes stack boxes draggable, so users push them into
  messy positions ("too messy" per the report from prod).

The stack *grouping itself* is good and is kept. This change is about the
**overview**: a clean, compact, deterministic, zoom-to-fit map with more
breathing room between container nodes, and no dragging.

## Scope

This is **layout + zoom tuning only**, deliberately bounded:

- **Keep every container visible** — no collapsing stacks, no level-of-detail
  summary tiles. (Those are recommended as a future phase; see Non-Goals.)
- **Compact deterministic grid of stacks** at the top level.
- **More spacing** between container nodes inside each stack.
- **Fully static canvas** — pan / zoom / click-to-select only. Nothing is
  draggable. The `d3-force` simulation is removed entirely.

## Background: current implementation

Key files (paths relative to `frontend/src/features/containers/`):

- `components/network/topology-graph.tsx` — builds the compound ELK graph
  (Phase 1: group containers by `com.docker.compose.project`, classify
  inline vs external networks; Phase 2: build ELK nodes/edges; Phase 3: run
  layout; Phase 4: assemble React Flow nodes/edges), and wires the d3-force
  drag handlers.
- `hooks/use-elk-layout.ts` — runs `elkjs` on the compound graph. Root layout
  options are **hardcoded** here as `ROOT_LAYOUT_OPTIONS` (`stress` +
  `INCLUDE_CHILDREN`). Compound (group) nodes have width/height 0 and auto-size
  from children.
- `hooks/use-force-simulation.ts` (+ `.test.ts`) — the `d3-force` simulation
  that only runs during drag, repelling top-level nodes.
- `components/network/{container,network,stack-group}-node.tsx` — custom node
  renderers. Children use `parentId` + `extent: 'parent'`.

Important architecture fact that de-risks the layout change: the cross-hierarchy
edges fed to ELK exist **only so ELK can route/space them**. React Flow draws its
own edges in Phase 4 from `container.networks`. So changing the root algorithm
(and dropping root-level edges from the ELK input) does **not** affect which
edges the user sees.

The libraries are `@xyflow/react` 12.10.2, `elkjs` 0.11.1, `d3-force` 3.0.0.

## Design

### 1. Root layout: `stress` → `rectpacking`

ELK's `rectpacking` is purpose-built for "packing of unconnected boxes" — which
is exactly our top level, since stacks are mostly disconnected from each other.
It produces a compact, row-based, **deterministic, scannable grid** instead of a
scattered cloud. This is the largest "zoom out looks good" win and mirrors how
comparable products handle this scale (Datadog cluster/box map, Dockge, Komodo).

Root layout options become:

```
elk.algorithm                                       = rectpacking
elk.hierarchyHandling                               = SEPARATE_CHILDREN
elk.aspectRatio                                     = 1.6
elk.rectpacking.widthApproximation.optimizationGoal = ASPECT_RATIO_DRIVEN
elk.expandNodes                                     = true
elk.spacing.nodeNode                                = 60   # gap between stack boxes
elk.padding                                         = [top=24,left=24,bottom=24,right=24]
```

`SEPARATE_CHILDREN` makes ELK lay out each compound (stack) node in its own
independent run, so the root can pack boxes with `rectpacking` while each stack
keeps its own interior algorithm. `aspectRatio=1.6` biases the packed result
toward a widescreen rectangle so it fits the viewport when zoomed to fit.

Because `rectpacking` is for **edgeless** box packing, the root-level
cross-stack edges (`elkEdges` in `topology-graph.tsx` Phase 2) are no longer fed
into the ELK graph. They were only ever used for ELK layout; React Flow still
draws every `container ↔ network` edge in Phase 4, so nothing disappears
visually. Stacks are already sorted by `sortStacks` before layout, and
`rectpacking` preserves input order, so the grid is stable and reproducible.

#### Hook change

`ROOT_LAYOUT_OPTIONS` moves out of `use-elk-layout.ts`. The hook gains an
optional `rootLayoutOptions?: Record<string, string>` input (defaulting to the
current values for backward compatibility) so that `topology-graph.tsx` owns all
layout configuration in one place. The hook continues to wrap the input nodes in
a synthetic `root` node and apply these options to it.

### 2. Stack interiors: keep `stress`, add spacing

The grouping/look inside a stack is good and stays `stress`. We only increase the
breathing room between container nodes:

```
elk.algorithm                  = stress          # unchanged
elk.stress.desiredEdgeLength   = 220             # was 200
elk.spacing.nodeNode           = 160             # was 100  (more space between containers)
elk.padding                    = [top=50,left=40,bottom=40,right=40]  # was bottom=30
```

(Considered switching interiors to `layered` for a cleaner, deterministic,
directional look — rejected for this PR to honor "the grouping is good"; it can
be revisited later as a low-risk tweak.)

### 3. Fully static — delete the force simulation

The `d3-force` machinery exists solely to make dragging feel good. With dragging
removed, all of it goes:

- `topology-graph.tsx`: set `nodesDraggable={false}`; remove the
  `onNodeDragStart` / `onNodeDrag` / `onNodeDragStop` props and their wrapper
  callbacks (`handleDragStart` / `handleDrag` / `handleDragStop`); remove
  `handleSimTick`, the `simNodes` / `simLinks` memos, the `childToGroupRef`
  effect, and the `useForceSimulation` call.
- Delete `hooks/use-force-simulation.ts` and `hooks/use-force-simulation.test.ts`.
- Remove the `d3-force` dependency from `frontend/package.json` (and
  `@types/d3-force` if present) after confirming no other module imports it.
  `npm install` is run from the repo root per project rules.

Layout is now 100% deterministic from ELK; there are no user-mutated positions to
become messy. `potatoMode` no longer needs to gate drag (there is none); it
continues to gate edge animation.

### 4. Zoom / viewport tuning

On the `<ReactFlow>` element:

```
nodesDraggable          = false
onlyRenderVisibleElements           # cull off-screen nodes/edges at ~200 nodes
minZoom                 = 0.1       # was React Flow default 0.5 — lets the fleet fit
maxZoom                 = 2         # explicit (React Flow default)
fitView                            # unchanged
fitViewOptions          = { padding: 0.1, maxZoom: 1 }   # don't over-zoom a sparse fit
```

`Background`, `Controls`, and `MiniMap` stay — all three are valuable on a large
static map.

## Components & data flow

Unchanged data flow: `network-topology.tsx` fetches containers / networks /
rates / service-map and passes them to `TopologyGraph`. The four-phase build in
`TopologyGraph` is unchanged except: Phase 2 stops adding root-level cross-stack
edges to the ELK input; Phase 3 passes the new `rootLayoutOptions` and the bumped
`GROUP_LAYOUT_OPTIONS`; the force-simulation wiring after Phase 4 is removed.

No backend changes. No API changes. No new dependencies (one removed).

## Testing

Per the project's mandatory-tests rule, all changes ship with tests:

- `use-elk-layout.test.ts`: update for the new optional `rootLayoutOptions`
  parameter — assert the default still applies when omitted, and that a passed-in
  options object is applied to the synthetic root node. Add a case that runs a
  `rectpacking` root through the real `elkjs` in jsdom and asserts positions come
  back for all nodes (guards against elkjs choking on the new algorithm).
- `topology-graph.test.ts`: existing pure-helper tests
  (`getEdgeStyle`, `sortStacks`, `sortContainers`, `getBestHandles`,
  `formatRate`) stay green. Add assertions that the exported root layout options
  request `rectpacking` and that `GROUP_LAYOUT_OPTIONS.spacing.nodeNode`
  increased (lightweight config guard).
- **Delete** `use-force-simulation.test.ts` along with the hook.
- `network-topology.test.tsx`: unchanged — it stubs `TopologyGraph`; drag was
  never asserted.

Full frontend suite must stay green: `cd frontend && npx vitest run`
(use `--pool=threads` if the sandboxed worktree fails to spawn fork workers).

## Documentation

Per `CLAUDE.md`, update docs alongside the change:

- `docs/architecture.md` — note the topology overview uses `rectpacking` root
  packing + static (non-draggable) canvas, and that `d3-force` was removed.
- `CLAUDE.md` — if it references the topology/force layout, update it.
- `.env.example` — no change (no new env vars).

## Non-Goals (deferred to a future phase)

The research strongly recommends these for 200-node readability, but they are
out of scope for this PR:

- Collapsible stacks (collapsed-by-default summary tiles, expand on demand).
- Semantic zoom / level-of-detail (hide labels / per-container detail and drop
  glass blur when zoomed out, via `useStore((s) => s.transform[2])`).
- Hiding or aggregating edges/labels at overview zoom (e.g. one stack→network
  edge instead of one per container).
- Filter-to-focus (search + click-to-isolate that dims unrelated nodes).

## Risks & mitigations

- **elkjs + rectpacking in jsdom** — mitigated by an explicit layout test
  (above) and by manual verification in the running app.
- **Compound nodes under rectpacking root** — `SEPARATE_CHILDREN` is the
  documented mechanism for mixing a packing root with per-group interior layout;
  verified against ELK docs. Manual check that stack boxes auto-size correctly.
- **Removing `d3-force`** — grep the whole repo for `d3-force` imports before
  removing the dependency; only `use-force-simulation.ts` should reference it.
- **Visual regression** — verify in the real app (Playwright/manual) that the
  grid fits, spacing reads well, and edges/RPC overlay still render.
