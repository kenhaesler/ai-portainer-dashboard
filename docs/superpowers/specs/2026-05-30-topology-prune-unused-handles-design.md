# Network Topology — Prune Unused Connection Points

**Date:** 2026-05-30
**Branch:** `feature/topology-prune-unused-handles`
**Status:** Approved design, pending implementation plan

## Problem

In the Network Topology view, `ContainerNode` and `NetworkNode` each render **all
four** React Flow handles (top / right / bottom / left) as small gray dots
(`!bg-gray-400`), unconditionally. Every edge, however, attaches to only **one**
handle per node — the direction is chosen by `getBestHandles()` from the angle
between the two node centers. The result is that most nodes display two or three
"dangling" connection dots that attach to nothing, cluttering the graph.

## Goal

Render only the connection points that an edge actually uses. A node keeps a gray
dot exactly where a line meets it; orphan dots disappear. Applies to **both**
container and network nodes.

## Constraint (load-bearing)

React Flow attaches an edge to a specific handle by matching the edge's
`sourceHandle` / `targetHandle` string to a `<Handle id=...>` rendered inside the
node. If that handle is not in the DOM, the edge silently falls back to the node
origin and renders wrong. Therefore handles cannot be removed blindly — we must
render exactly the set of handle ids that the edges reference for each node.

## Background: current implementation

In `frontend/src/features/containers/components/network/`:

- `container-node.tsx` — renders 4 `<Handle type="source" id="top|right|bottom|left">`.
- `network-node.tsx` — renders 4 `<Handle type="target" id="top|right|bottom|left">`.
- `topology-graph.tsx` Phase 4 builds the React Flow `nodes` first, then the
  `edges`. Each edge sets `sourceHandle` / `targetHandle` from
  `getBestHandles(sourcePos, targetPos)` (returns one of `top|right|bottom|left`).
  This covers both the structural container↔network edges and the RPC-overlay
  edges (`showObservedTraffic`).

Because the edges already know which handle each node uses, the used set is fully
derivable from the assembled edge list — no new geometry needed.

## Design

### 1. Derive the used-handle set from edges (pure helper)

Add to `topology-graph.tsx`, exported for testing:

```ts
export type HandleDirection = 'top' | 'right' | 'bottom' | 'left';

/**
 * Map each node id to the set of handle directions that at least one edge
 * attaches to (as source or target). Used to render only connected handles.
 */
export function collectUsedHandles(
  edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>,
): Map<string, Set<HandleDirection>> {
  const used = new Map<string, Set<HandleDirection>>();
  const add = (nodeId: string, handle?: string | null) => {
    if (!handle) return;
    if (!used.has(nodeId)) used.set(nodeId, new Set());
    used.get(nodeId)!.add(handle as HandleDirection);
  };
  for (const e of edges) {
    add(e.source, e.sourceHandle);
    add(e.target, e.targetHandle);
  }
  return used;
}
```

`HandleDirection` is currently a local `type` in `topology-graph.tsx`; it becomes
exported so the helper and tests can reference it. This naturally handles a
container that is both an edge source (structural / RPC-from) and an edge target
(RPC-to): both its handle ids are retained.

### 2. Inject `usedHandles` into node data (Phase 4 post-pass)

After both `nodes` and `edges` are built in the Phase 4 `useMemo` (edges are built
last today, so no reordering is needed), run one pass:

```ts
const usedHandles = collectUsedHandles(edges);
for (const node of nodes) {
  (node.data as Record<string, unknown>).usedHandles = [...(usedHandles.get(node.id) ?? [])];
}
```

`usedHandles` is a plain `HandleDirection[]` on `node.data`. A node with no edges
gets `[]` (renders zero handles — correct, nothing attaches).

### 3. Filter handles in the node components

`ContainerNode` and `NetworkNode` read `data.usedHandles` and render a `<Handle>`
only when its id is included. Kept dots are unchanged (`!bg-gray-400`). The
shape, label, selection/related rings, and all other markup stay identical.

```ts
// shared idea, applied in each component with its own handle `type`
const usedHandles = (data as any).usedHandles as HandleDirection[] | undefined;
const showHandle = (id: HandleDirection) => usedHandles === undefined || usedHandles.includes(id);
```

- **Container** handles are `type="source"`; **network** handles are
  `type="target"` — unchanged.
- **Fallback:** when `usedHandles` is `undefined`, render all four (preserves
  today's behavior for any caller that doesn't supply the field). Only an explicit
  array (including `[]`) filters.

The four `<Handle>` elements become conditional (`{showHandle('top') && <Handle .../>}`)
in their existing positions; nothing else in the components changes.

## What does NOT change

Edge routing, `getBestHandles` / `getHandleForAngle`, the RPC overlay, ELK layout,
viewport, and node positions are all untouched. This is purely a reduction in how
many handle dots each node renders.

## Testing

Per the project's mandatory-tests rule:

- **`topology-graph.test.ts`** — unit-test `collectUsedHandles` (pure):
  - a structural edge records `sourceHandle` on the source and `targetHandle` on
    the target;
  - a node referenced as both source and target keeps both handle ids;
  - RPC-style edges contribute their handles the same way;
  - a `null`/`undefined` handle is ignored;
  - a node with no edges has no entry (caller treats missing as `[]`).
- The existing `getBestHandles` / `getHandleForAngle` tests stay green
  (`HandleDirection` becoming exported is non-breaking).
- Node-component DOM render tests are intentionally out of scope: a bare
  `<Handle>` requires `ReactFlowProvider` context and the existing suite stubs
  `TopologyGraph` in the page test rather than mounting React Flow. Coverage rests
  on the pure helper plus manual visual verification in the running app.

Full frontend suite must stay green: `cd frontend && npx vitest run`.

## Documentation

`docs/architecture.md` already describes the topology view; no content there is
invalidated by this change (handles are an internal rendering detail). No
`.env.example` or `CLAUDE.md` changes. If the architecture note benefits from a
one-line mention that nodes render only connected handles, add it; otherwise no
doc change is required.

## Risks & mitigations

- **Missing-handle fallback to node origin** — mitigated by deriving the used set
  directly from the same edge objects React Flow consumes, so every referenced
  handle id is guaranteed to be rendered.
- **A future edge type that sets a handle not in the four directions** — the
  helper passes the string through as-is; the node component only knows four
  positions, so an unknown id simply wouldn't render. Acceptable: all current
  edges use `getBestHandles`, which only returns the four cardinal directions.
- **Visual regression** — verify in the running app that every line still meets a
  dot and no line snaps to a node center.
